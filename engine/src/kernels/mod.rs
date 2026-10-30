//! GPU operations with explicit input gradients. No float atomics or CPU readbacks.
mod attention;
mod autodiff;
/// Exact counter draws; public for the native checks of the fused cell step.
pub mod draws;
mod gelu;
mod heads;
mod linear;
pub(crate) mod matmul;
mod norm;
mod resample;
pub(crate) use resample::transpose_taps;

use burn::{
    backend::{
        Dispatch, backend_extension,
        tensor::{FloatTensor, IntTensor},
    },
    tensor::{Int, Tensor},
};

#[backend_extension(Autodiff, Cube)]
pub trait FrozenLinearBackend: burn::backend::Backend {
    fn frozen_linear(
        input: FloatTensor<Self>,
        weight: FloatTensor<Self>,
        transpose: bool,
    ) -> FloatTensor<Self>;
}

#[backend_extension(Autodiff, Cube)]
pub trait AttentionBackend: burn::backend::Backend {
    fn scaled_attention(
        query: FloatTensor<Self>,
        key: FloatTensor<Self>,
        value: FloatTensor<Self>,
    ) -> FloatTensor<Self>;

    fn projected_attention(
        projected: FloatTensor<Self>,
        bias: FloatTensor<Self>,
        sin: FloatTensor<Self>,
        cos: FloatTensor<Self>,
    ) -> FloatTensor<Self>;
}

/// Noncausal self-attention; E is the head width. No mask, bias, or dropout.
pub fn scaled_attention(
    query_BHTE: Tensor<4>,
    key_BHTE: Tensor<4>,
    value_BHTE: Tensor<4>,
) -> Tensor<4> {
    assert_eq!(query_BHTE.dims(), key_BHTE.dims());
    assert_eq!(query_BHTE.dims(), value_BHTE.dims());
    for tensor in [&query_BHTE, &key_BHTE, &value_BHTE] {
        assert_eq!(tensor.dtype(), burn::tensor::DType::F32);
    }
    Tensor::from_dispatch(Dispatch::scaled_attention(
        query_BHTE.into_dispatch(),
        key_BHTE.into_dispatch(),
        value_BHTE.into_dispatch(),
    ))
}

#[backend_extension(Autodiff, Cube)]
pub trait ResampleBackend: burn::backend::Backend {
    fn resample_axis(
        input: FloatTensor<Self>,
        indices: IntTensor<Self>,
        weights: FloatTensor<Self>,
        transposed_indices: IntTensor<Self>,
        transposed_weights: FloatTensor<Self>,
        axis: usize,
    ) -> FloatTensor<Self>;
}

/// One axis (2 or 3) of a separable resampling of [B, C, X, Y] (`kernels/resample.rs`):
/// `indices` [O·K] and `weights_OK` the taps of A; the transposed tables those of Aᵀ, which
/// the gradient gathers with. Only `images_BCXY` has a gradient.
pub fn resample_axis(
    images_BCXY: Tensor<4>,
    indices: Tensor<1, Int>,
    weights_OK: Tensor<2>,
    transposed_indices: Tensor<1, Int>,
    transposed_weights_IK: Tensor<2>,
    axis: usize,
) -> Tensor<4> {
    Tensor::from_dispatch(Dispatch::resample_axis(
        images_BCXY.into_dispatch(),
        indices.into_dispatch(),
        weights_OK.into_dispatch(),
        transposed_indices.into_dispatch(),
        transposed_weights_IK.into_dispatch(),
        axis,
    ))
}

#[backend_extension(Autodiff, Cube)]
pub trait PixelResampleBackend: burn::backend::Backend {
    fn resample_pixels(
        input: FloatTensor<Self>,
        indices: IntTensor<Self>,
        weights: FloatTensor<Self>,
        transposed_indices: IntTensor<Self>,
        transposed_weights: FloatTensor<Self>,
    ) -> FloatTensor<Self>;
}

/// Wrapped views on flattened pixels [B, C, 1, P]. The backward preserves the
/// original scatter's ascending source-pixel addition order.
pub(crate) fn resample_pixels(
    images_BC1P: Tensor<4>,
    indices: Tensor<1, Int>,
    weights_PK: Tensor<2>,
    transposed_indices: Tensor<1, Int>,
    transposed_weights_PK: Tensor<2>,
) -> Tensor<4> {
    Tensor::from_dispatch(Dispatch::resample_pixels(
        images_BC1P.into_dispatch(),
        indices.into_dispatch(),
        weights_PK.into_dispatch(),
        transposed_indices.into_dispatch(),
        transposed_weights_PK.into_dispatch(),
    ))
}

#[backend_extension(Autodiff, Cube)]
pub trait GeluBackend: burn::backend::Backend {
    fn bias_gelu(input: FloatTensor<Self>, bias: FloatTensor<Self>) -> FloatTensor<Self>;
}

/// GELU (erf form) of a linear layer's output plus its frozen bias, one kernel each way
/// (`kernels/gelu.rs`). `projected_BTF` is X Wᵀ without the bias.
pub fn bias_gelu(projected_BTF: Tensor<3>, bias_F: Tensor<1>) -> Tensor<3> {
    assert!(!bias_F.is_require_grad(), "The linear bias must be frozen");
    Tensor::from_dispatch(Dispatch::bias_gelu(projected_BTF.into_dispatch(), bias_F.into_dispatch()))
}

#[backend_extension(Autodiff, Cube)]
pub trait NormBackend: burn::backend::Backend {
    fn layer_norm(input: FloatTensor<Self>, weight: FloatTensor<Self>, bias: FloatTensor<Self>) -> FloatTensor<Self>;
    fn affine_free_norm(input: FloatTensor<Self>) -> FloatTensor<Self>;
}

/// LayerNorm over the last axis with a frozen weight and bias, in one kernel each way
/// (`kernels/norm.rs`). Only `tokens_BTD` has a gradient.
pub fn layer_norm(tokens_BTD: Tensor<3>, weight_D: Tensor<1>, bias_D: Tensor<1>) -> Tensor<3> {
    assert!(!weight_D.is_require_grad() && !bias_D.is_require_grad(), "LayerNorm weights must be frozen");
    Tensor::from_dispatch(Dispatch::layer_norm(
        tokens_BTD.into_dispatch(),
        weight_D.into_dispatch(),
        bias_D.into_dispatch(),
    ))
}

/// LayerNorm over the last axis without a weight or bias (`kernels/norm.rs`).
pub fn affine_free_norm(tokens_BTD: Tensor<3>) -> Tensor<3> {
    Tensor::from_dispatch(Dispatch::affine_free_norm(tokens_BTD.into_dispatch()))
}

/// Self-attention from the qkv projection X W^T, [B, T, 3D] without its bias. One kernel adds
/// the bias, splits the heads and applies RoPE to the queries' and keys' patch tokens
/// (`kernels/heads.rs`; `sin_PE`, `cos_PE`: P patches × E); then `scaled_attention`.
/// Returns [B, H, T, E]. Only `projected_BTO` has a gradient.
pub fn projected_attention(
    projected_BTO: Tensor<3>,
    bias_O: Tensor<1>,
    sin_PE: Tensor<2>,
    cos_PE: Tensor<2>,
) -> Tensor<4> {
    for frozen in [&bias_O.clone().unsqueeze::<2>(), &sin_PE, &cos_PE] {
        assert!(!frozen.is_require_grad(), "The qkv bias and RoPE tables must be frozen");
    }
    Tensor::from_dispatch(Dispatch::projected_attention(
        projected_BTO.into_dispatch(),
        bias_O.into_dispatch(),
        sin_PE.into_dispatch(),
        cos_PE.into_dispatch(),
    ))
}

/// X_BTI @ W_OI^T. Only X has a gradient; W is a frozen encoder weight.
pub fn frozen_linear(tokens_BTI: Tensor<3>, weight_OI: Tensor<2>) -> Tensor<3> {
    assert!(
        !weight_OI.is_require_grad(),
        "Linear weights must be frozen"
    );
    Tensor::from_dispatch(Dispatch::frozen_linear(
        tokens_BTI.into_dispatch(),
        weight_OI.into_dispatch(),
        false,
    ))
}

pub mod cell;
mod cell_linear;
pub mod cell_step;
pub mod pyramid;
