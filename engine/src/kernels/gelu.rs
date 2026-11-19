//! GELU in the erf form, with the preceding linear layer's bias: y = ½ h (1 + erf(h / √2)),
//! h = x + b, as PyTorch's nn.GELU. Gradient: ∂y/∂h = ½ (1 + erf(h / √2)) + h φ(h), with
//! φ(h) = exp(−h² / 2) / √(2π). One thread per value; erf is CubeCL's, the same
//! approximation as Burn's `erf`. The bias is frozen; no bias gradient.

use burn::backend::wgpu::CubeTensor;
use burn::tensor::DType;
use burn_cubecl::{kernel::into_contiguous, ops::numeric::empty_device_dtype};
use cubecl::{
    CubeCount, CubeDim,
    frontend::{Erf, Exp},
    prelude::*,
};

const THREADS: u32 = 256;
const SQRT_2: f32 = std::f32::consts::SQRT_2;
/// 1 / √(2π).
const INVERSE_SQRT_TAU: f32 = 0.398_942_3;

#[cube(launch)]
fn bias_gelu_forward(input: &Tensor<f32>, bias: &Tensor<f32>, output: &mut Tensor<f32>, #[comptime] width: usize) {
    let index = ABSOLUTE_POS;
    if index >= output.len() {
        terminate!();
    }
    let hidden: f32 = input[index] + bias[index % width];
    output[index] = hidden * 0.5 * (Erf::erf(hidden / SQRT_2) + 1.0);
}

#[cube(launch)]
fn bias_gelu_backward(
    input: &Tensor<f32>,
    bias: &Tensor<f32>,
    upstream: &Tensor<f32>,
    gradient: &mut Tensor<f32>,
    #[comptime] width: usize,
) {
    let index = ABSOLUTE_POS;
    if index >= gradient.len() {
        terminate!();
    }
    let hidden: f32 = input[index] + bias[index % width];
    let cumulative: f32 = (Erf::erf(hidden / SQRT_2) + 1.0f32) * 0.5f32;
    let density: f32 = Exp::exp(hidden * hidden * -0.5f32) * INVERSE_SQRT_TAU;
    gradient[index] = upstream[index] * (cumulative + hidden * density);
}

fn launch_shape(input: &CubeTensor) -> (CubeCount, usize) {
    let shape = input.meta.shape();
    let count = shape.num_elements();
    (CubeCount::Static(count.div_ceil(THREADS as usize) as u32, 1, 1), shape[shape.num_dims() - 1])
}

/// `input` [..., F] without its bias; `bias` [F].
pub(super) fn forward(input: CubeTensor, bias: CubeTensor) -> CubeTensor {
    let (input, bias) = (into_contiguous(input), into_contiguous(bias));
    let (groups, width) = launch_shape(&input);
    let output = empty_device_dtype(input.client.clone(), input.device.clone(), input.meta.shape().clone(), DType::F32);
    bias_gelu_forward::launch(
        &output.client,
        groups,
        CubeDim::new_1d(THREADS),
        input.into_tensor_arg(),
        bias.into_tensor_arg(),
        output.clone().into_tensor_arg(),
        width,
    );
    output
}

pub(super) fn backward(input: CubeTensor, bias: CubeTensor, upstream: CubeTensor) -> CubeTensor {
    let (input, bias, upstream) = (into_contiguous(input), into_contiguous(bias), into_contiguous(upstream));
    let (groups, width) = launch_shape(&input);
    let gradient = empty_device_dtype(input.client.clone(), input.device.clone(), input.meta.shape().clone(), DType::F32);
    bias_gelu_backward::launch(
        &gradient.client,
        groups,
        CubeDim::new_1d(THREADS),
        input.into_tensor_arg(),
        bias.into_tensor_arg(),
        upstream.into_tensor_arg(),
        gradient.clone().into_tensor_arg(),
        width,
    );
    gradient
}
