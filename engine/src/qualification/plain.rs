//! Each GPU replacement of plain Burn operations against the operations it replaced, at the
//! update's shapes: the fused head split with RoPE, the LayerNorm kernels, the gathered
//! resampling gradient and GELU with its bias.
use super::{Comparison, compare_values, read_values};
use crate::encoder::{HEAD_WIDTH, HEADS, PATCHES, PREFIX, Rope, TOKENS, WIDTH, plain_affine_free_norm, plain_gelu};
use crate::image::{Resample, SIZE, resize_coefficients, zoom_coefficients};
use burn::tensor::{Device, Distribution, Tensor};

/// `kernels::projected_attention` against `Rope::split` then `scaled_attention`, at the update's
/// shapes with the model's RoPE tables: the output, and the gradient of the qkv projection.
pub(super) async fn check_projected_attention(device: &Device, rope: &Rope) -> Result<Vec<Comparison>, String> {
    let width = 3 * HEADS * HEAD_WIDTH;
    let projected_BTO = Tensor::<3>::random([2, TOKENS, width], Distribution::Normal(0.0, 1.0), device);
    let bias_O = Tensor::<1>::random([width], Distribution::Normal(0.0, 0.5), device);
    let upstream_BHTE = Tensor::<4>::random([2, HEADS, TOKENS, HEAD_WIDTH], Distribution::Normal(0.0, 1.0), device);
    let fused_input = projected_BTO.clone().require_grad();
    let (sin_PE, cos_PE) = rope.tables_PE();
    let fused_BHTE = crate::kernels::projected_attention(fused_input.clone(), bias_O.clone(), sin_PE, cos_PE);
    let mut fused_gradients = (fused_BHTE.clone() * upstream_BHTE.clone()).sum().backward();
    let plain_input = projected_BTO.require_grad();
    let [queries_BHTE, keys_BHTE, values_BHTE] = rope.split(plain_input.clone() + bias_O.reshape([1, 1, width]));
    let plain_BHTE = crate::kernels::scaled_attention(queries_BHTE, keys_BHTE, values_BHTE);
    let mut plain_gradients = (plain_BHTE.clone() * upstream_BHTE).sum().backward();
    let name = format!("projected-attention-2x{TOKENS}x{width}");
    Ok(vec![
        compare_values(
            &format!("{name}-output"),
            &[2, HEADS, TOKENS, HEAD_WIDTH],
            &read_values(fused_BHTE).await?,
            &read_values(plain_BHTE).await?,
            1e-5,
        )?,
        compare_values(
            &format!("{name}-gradient"),
            &[2, TOKENS, width],
            &read_values(fused_input.grad_remove(&mut fused_gradients).unwrap()).await?,
            &read_values(plain_input.grad_remove(&mut plain_gradients).unwrap()).await?,
            1e-5,
        )?,
    ])
}

/// `kernels::layer_norm` and `kernels::affine_free_norm` against the plain Burn norm, at the
/// update's token shape (affine) and on the patch slice the appearance readouts use.
pub(super) async fn check_norms(device: &Device) -> Result<Vec<Comparison>, String> {
    let tokens_BTD = Tensor::<3>::random([2, TOKENS, WIDTH], Distribution::Normal(0.5, 3.0), device);
    let weight_D = Tensor::<1>::random([WIDTH], Distribution::Normal(1.0, 0.3), device);
    let bias_D = Tensor::<1>::random([WIDTH], Distribution::Normal(0.0, 0.3), device);
    let upstream_BTD = Tensor::<3>::random([2, TOKENS, WIDTH], Distribution::Normal(0.0, 1.0), device);
    let plain_affine = |tokens_BTD: Tensor<3>| {
        plain_affine_free_norm(tokens_BTD) * weight_D.clone().reshape([1, 1, WIDTH]) + bias_D.clone().reshape([1, 1, WIDTH])
    };
    let patches = |tokens_BTD: Tensor<3>| tokens_BTD.slice([0..2, PREFIX..TOKENS, 0..WIDTH]);
    let mut checks = Vec::new();
    for affine in [true, false] {
        let (kernel_input, plain_input) = (tokens_BTD.clone().require_grad(), tokens_BTD.clone().require_grad());
        let (kernel_output, plain_output, upstream) = if affine {
            let kernel = crate::kernels::layer_norm(kernel_input.clone(), weight_D.clone(), bias_D.clone());
            (kernel, plain_affine(plain_input.clone()), upstream_BTD.clone())
        } else {
            let kernel = crate::kernels::affine_free_norm(patches(kernel_input.clone()));
            (kernel, plain_affine_free_norm(patches(plain_input.clone())), patches(upstream_BTD.clone()))
        };
        let shape = kernel_output.dims();
        let mut kernel_gradients = (kernel_output.clone() * upstream.clone()).sum().backward();
        let mut plain_gradients = (plain_output.clone() * upstream).sum().backward();
        let name = if affine { format!("layer-norm-2x{TOKENS}x{WIDTH}") } else { format!("affine-free-norm-2x{PATCHES}x{WIDTH}-slice") };
        checks.push(compare_values(&format!("{name}-output"), &shape, &read_values(kernel_output).await?, &read_values(plain_output).await?, 1e-5)?);
        checks.push(compare_values(
            &format!("{name}-gradient"),
            &[2, TOKENS, WIDTH],
            &read_values(kernel_input.grad_remove(&mut kernel_gradients).unwrap()).await?,
            &read_values(plain_input.grad_remove(&mut plain_gradients).unwrap()).await?,
            1e-5,
        )?);
    }
    Ok(checks)
}

/// The GPU resampling, whose gradient gathers with Aᵀ, against the plain one, whose gradient
/// scatters: the pyramid's coarsest and finest upsampling and a zoom, output and gradient.
pub(super) async fn check_resample(device: &Device) -> Result<Vec<Comparison>, String> {
    let mut checks = Vec::new();
    for (name, side, coefficients) in [
        ("upsample-16", 16, resize_coefficients(16, SIZE)),
        ("upsample-128", 128, resize_coefficients(128, SIZE)),
        ("zoom-256", SIZE, zoom_coefficients(SIZE, 1.01)),
    ] {
        let resample = Resample::new(&coefficients, side, device);
        let images = Tensor::<4>::random([1, 3, side, side], Distribution::Normal(0.0, 1.0), device);
        let upstream = Tensor::<4>::random([1, 3, SIZE, SIZE], Distribution::Normal(0.0, 1.0), device);
        let (gathered, plain) = (images.clone().require_grad(), images.require_grad());
        let gathered_output = resample.apply(gathered.clone());
        let plain_output = resample.plain_apply(plain.clone());
        let mut gathered_gradients = (gathered_output.clone() * upstream.clone()).sum().backward();
        let mut plain_gradients = (plain_output.clone() * upstream).sum().backward();
        checks.push(compare_values(&format!("resample-{name}-output"), &[1, 3, SIZE, SIZE], &read_values(gathered_output).await?, &read_values(plain_output).await?, 1e-5)?);
        checks.push(compare_values(
            &format!("resample-{name}-gradient"),
            &[1, 3, side, side],
            &read_values(gathered.grad_remove(&mut gathered_gradients).unwrap()).await?,
            &read_values(plain.grad_remove(&mut plain_gradients).unwrap()).await?,
            1e-5,
        )?);
    }
    Ok(checks)
}

/// `kernels::bias_gelu` against the plain GELU of the projection plus its bias, at the MLP's
/// shape: output and gradient.
pub(super) async fn check_gelu(device: &Device) -> Result<Vec<Comparison>, String> {
    let width = 4 * WIDTH;
    let projected_BTF = Tensor::<3>::random([2, TOKENS, width], Distribution::Normal(0.0, 2.0), device);
    let bias_F = Tensor::<1>::random([width], Distribution::Normal(0.0, 0.5), device);
    let upstream_BTF = Tensor::<3>::random([2, TOKENS, width], Distribution::Normal(0.0, 1.0), device);
    let (kernel_input, plain_input) = (projected_BTF.clone().require_grad(), projected_BTF.require_grad());
    let kernel_output = crate::kernels::bias_gelu(kernel_input.clone(), bias_F.clone());
    let plain_output = plain_gelu(plain_input.clone() + bias_F.reshape([1, 1, width]));
    let mut kernel_gradients = (kernel_output.clone() * upstream_BTF.clone()).sum().backward();
    let mut plain_gradients = (plain_output.clone() * upstream_BTF).sum().backward();
    let name = format!("bias-gelu-2x{TOKENS}x{width}");
    Ok(vec![
        compare_values(&format!("{name}-output"), &[2, TOKENS, width], &read_values(kernel_output).await?, &read_values(plain_output).await?, 1e-5)?,
        compare_values(
            &format!("{name}-gradient"),
            &[2, TOKENS, width],
            &read_values(kernel_input.grad_remove(&mut kernel_gradients).unwrap()).await?,
            &read_values(plain_input.grad_remove(&mut plain_gradients).unwrap()).await?,
            1e-5,
        )?,
    ])
}
