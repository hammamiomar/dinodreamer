//! One axis of a separable resampling, y = A x, as a gather, a product and a sum over taps;
//! its gradient is Aᵀ ȳ, the same gather over the transposed tap tables. Burn's gradient of
//! `select` is a scatter-add (`select_assign`) instead, about 5 ms per update on WebGPU for
//! the pyramid's four upsamplings. Wrapped views additionally preserve the original
//! scatter's sequential addition order in their transposed sum.

use super::{PixelResampleBackend, ResampleBackend};
use burn::backend::{
    Backend, TensorMetadata,
    ops::FloatTensorOps,
    tensor::{FloatTensor, IntTensor},
    wgpu::{CubeBackend, CubeTensor},
};
use burn::tensor::{DType, Shape};
use burn_cubecl::{kernel::into_contiguous, ops::numeric::empty_device_dtype};
use cubecl::{CubeCount, CubeDim, prelude::*};

/// `input` [B, C, X, Y]; `indices` [O·K] along `axis` (2 or 3), in (output, tap) order;
/// `weights` [O, K]. Returns [B, C, O, Y] or [B, C, X, O].
pub(super) fn gather_axis<B: Backend>(
    input: FloatTensor<B>,
    indices: IntTensor<B>,
    weights: FloatTensor<B>,
    axis: usize,
) -> FloatTensor<B> {
    let [batch, channels, rows, columns] = input.shape().dims::<4>();
    let [output, taps] = weights.shape().dims::<2>();
    let (gathered, weights_shape, sum_axis, result) = match axis {
        2 => (
            [batch, channels, output, taps, columns],
            [1, 1, output, taps, 1],
            3,
            [batch, channels, output, columns],
        ),
        3 => (
            [batch, channels, rows, output, taps],
            [1, 1, 1, output, taps],
            4,
            [batch, channels, rows, output],
        ),
        _ => panic!("resampling runs along axis 2 or 3"),
    };
    let gathered = B::float_reshape(B::float_select(input, axis, indices), Shape::new(gathered));
    let products = B::float_mul(
        gathered,
        B::float_reshape(weights, Shape::new(weights_shape)),
    );
    B::float_reshape(B::float_sum_dim(products, sum_axis), Shape::new(result))
}

impl ResampleBackend for CubeBackend {
    fn resample_axis(
        input: FloatTensor<Self>,
        indices: IntTensor<Self>,
        weights: FloatTensor<Self>,
        _transposed_indices: IntTensor<Self>,
        _transposed_weights: FloatTensor<Self>,
        axis: usize,
    ) -> FloatTensor<Self> {
        gather_axis::<Self>(input, indices, weights, axis)
    }
}

impl PixelResampleBackend for CubeBackend {
    fn resample_pixels(
        input: CubeTensor,
        indices: CubeTensor,
        weights: CubeTensor,
        _transposed_indices: CubeTensor,
        _transposed_weights: CubeTensor,
    ) -> CubeTensor {
        gather_axis::<Self>(input, indices, weights, 3)
    }
}

#[cube(launch)]
fn sum_taps_in_order(
    products_BCPK: &Tensor<f32>,
    output_BC1P: &mut Tensor<f32>,
    #[comptime] taps: usize,
) {
    let index = ABSOLUTE_POS;
    if index >= output_BC1P.len() {
        terminate!();
    }
    let mut total = 0.0f32;
    for tap in 0..taps {
        total += products_BCPK[index * taps + tap];
    }
    output_BC1P[index] = total;
}

/// Aᵀg with one thread per input pixel/channel. Products are materialized first:
/// the original scatter adds rounded FP32 products, without fused multiply-add.
pub(super) fn transpose_pixels(
    upstream_BC1O: CubeTensor,
    indices: CubeTensor,
    weights_PK: CubeTensor,
) -> CubeTensor {
    // O forward output pixels, P input pixels, K transposed taps.
    let [batch, channels, rows, _] = upstream_BC1O.meta.shape().dims::<4>();
    assert_eq!(rows, 1);
    let [pixels, taps] = weights_PK.meta.shape().dims::<2>();
    let gathered_BCPK = CubeBackend::float_reshape(
        CubeBackend::float_select(upstream_BC1O, 3, indices),
        Shape::new([batch, channels, pixels, taps]),
    );
    let products_BCPK = into_contiguous(CubeBackend::float_mul(
        gathered_BCPK,
        CubeBackend::float_reshape(weights_PK, Shape::new([1, 1, pixels, taps])),
    ));
    let output_BC1P = empty_device_dtype(
        products_BCPK.client.clone(),
        products_BCPK.device.clone(),
        Shape::new([batch, channels, 1, pixels]),
        DType::F32,
    );
    sum_taps_in_order::launch(
        &output_BC1P.client,
        CubeCount::Static((batch * channels * pixels).div_ceil(256) as u32, 1, 1),
        CubeDim::new_1d(256),
        products_BCPK.into_tensor_arg(),
        output_BC1P.clone().into_tensor_arg(),
        taps,
    );
    output_BC1P
}

/// Transpose sparse row taps without constructing a dense image-size matrix.
/// Entries retain ascending source-row order. Duplicate taps are separate terms.
pub(crate) fn transpose_taps(
    indices: &[i32],
    weights: &[f32],
    inputs: usize,
    taps: usize,
) -> (Vec<i32>, Vec<f32>, usize) {
    assert_eq!(indices.len(), weights.len());
    assert_eq!(indices.len() % taps, 0);
    let mut counts = vec![0usize; inputs];
    for (&input, &weight) in indices.iter().zip(weights) {
        if weight != 0.0 {
            counts[input as usize] += 1;
        }
    }
    let transpose_taps = counts.iter().copied().max().unwrap_or(0).max(1);
    let mut transposed_indices = vec![0; inputs * transpose_taps];
    let mut transposed_weights = vec![0.0; inputs * transpose_taps];
    counts.fill(0);
    for (entry, (&input, &weight)) in indices.iter().zip(weights).enumerate() {
        if weight != 0.0 {
            let input = input as usize;
            let destination = input * transpose_taps + counts[input];
            transposed_indices[destination] = (entry / taps) as i32;
            transposed_weights[destination] = weight;
            counts[input] += 1;
        }
    }
    (transposed_indices, transposed_weights, transpose_taps)
}

#[cfg(test)]
mod tests {
    use super::transpose_taps;

    #[test]
    fn sparse_transpose_keeps_duplicate_taps_and_empty_input_rows() {
        // Three outputs, four inputs, two taps. Input 2 has no contribution.
        let indices = [1, 1, 0, 3, 1, 2];
        let weights = [0.25, 0.75, 0.6, 0.4, 1.0, 0.0];
        let (transposed_indices, transposed_weights, taps) =
            transpose_taps(&indices, &weights, 4, 2);
        assert_eq!(taps, 3);
        let upstream = [2.0, 3.0, 5.0];
        let actual: Vec<f32> = transposed_indices
            .chunks(taps)
            .zip(transposed_weights.chunks(taps))
            .map(|(row, weights)| {
                row.iter()
                    .zip(weights)
                    .map(|(&index, weight)| upstream[index as usize] * weight)
                    .sum()
            })
            .collect();
        let expected = [1.8, 7.0, 0.0, 1.2];
        assert!(
            actual
                .iter()
                .zip(expected)
                .all(|(actual, expected)| (actual - expected).abs() < 1e-6)
        );
    }
}
