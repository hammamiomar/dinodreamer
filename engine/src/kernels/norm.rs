//! LayerNorm over the last axis, forward and input gradient, one workgroup per row.
//!
//! For a row x of D values: μ = (1/D) Σ x, σ = √((1/D) Σ (x − μ)² + ε), x̂ = (x − μ) / σ and
//! y = x̂ w + c (w = 1, c = 0 affine-free). With g = ∂L/∂y · w, the input gradient is
//! ∂L/∂x = (g − mean(g) − x̂ mean(g x̂)) / σ. The weights are frozen; no weight gradient.
//! Each thread sums its own D / THREADS values in index order, then a shared-memory tree
//! adds the threads in a fixed order: no atomics, the same result at every run.

use burn::backend::wgpu::CubeTensor;
use burn::tensor::{DType, Shape};
use burn_cubecl::{kernel::into_contiguous, ops::numeric::empty_device_dtype};
use cubecl::{CubeCount, CubeDim, prelude::*};

const THREADS: usize = 256;
const EPSILON: f32 = crate::encoder::NORM_EPS as f32;

/// The sum over the workgroup of each thread's `value`, by a fixed tree. Every thread gets it.
#[cube]
fn workgroup_sum(shared: &mut Shared<[f32]>, value: f32) -> f32 {
    let thread = UNIT_POS as usize;
    shared[thread] = value;
    sync_cube();
    let mut offset = comptime!(THREADS / 2).runtime();
    while offset > 0 {
        if thread < offset {
            shared[thread] = shared[thread] + shared[thread + offset];
        }
        sync_cube();
        offset /= 2;
    }
    let total = shared[0];
    // Every thread reads the total before the buffer is reused.
    sync_cube();
    total
}

#[cube(launch)]
fn norm_forward(
    input: &Tensor<f32>,
    weight: &Tensor<f32>,
    bias: &Tensor<f32>,
    output: &mut Tensor<f32>,
    means: &mut Tensor<f32>,
    deviations: &mut Tensor<f32>,
    #[comptime] width: usize,
    #[comptime] affine: bool,
) {
    let row = CUBE_POS as usize;
    let thread = UNIT_POS as usize;
    let base = row * width;
    let per_thread = comptime!(width.div_ceil(THREADS));
    let mut shared = Shared::<[f32]>::new_slice(THREADS);
    let mut partial = 0.0;
    for index in 0..per_thread {
        let column = thread + index * THREADS;
        if column < width {
            partial += input[base + column];
        }
    }
    let mean = workgroup_sum(&mut shared, partial) / comptime!(width as f32);
    let mut squares = 0.0;
    for index in 0..per_thread {
        let column = thread + index * THREADS;
        if column < width {
            let centered = input[base + column] - mean;
            squares += centered * centered;
        }
    }
    let deviation = f32::sqrt(workgroup_sum(&mut shared, squares) / comptime!(width as f32) + EPSILON);
    for index in 0..per_thread {
        let column = thread + index * THREADS;
        if column < width {
            let mut value = (input[base + column] - mean) / deviation;
            if affine {
                value = value * weight[column] + bias[column];
            }
            output[base + column] = value;
        }
    }
    if thread == 0 {
        means[row] = mean;
        deviations[row] = deviation;
    }
}

#[cube(launch)]
fn norm_backward(
    input: &Tensor<f32>,
    weight: &Tensor<f32>,
    means: &Tensor<f32>,
    deviations: &Tensor<f32>,
    upstream: &Tensor<f32>,
    gradient: &mut Tensor<f32>,
    #[comptime] width: usize,
    #[comptime] affine: bool,
) {
    let row = CUBE_POS as usize;
    let thread = UNIT_POS as usize;
    let base = row * width;
    let per_thread = comptime!(width.div_ceil(THREADS));
    let mut shared = Shared::<[f32]>::new_slice(THREADS);
    let (mean, deviation) = (means[row], deviations[row]);
    let mut sum_g = 0.0;
    let mut sum_gx = 0.0;
    for index in 0..per_thread {
        let column = thread + index * THREADS;
        if column < width {
            let mut g = upstream[base + column];
            if affine {
                g = g * weight[column];
            }
            sum_g += g;
            sum_gx += g * ((input[base + column] - mean) / deviation);
        }
    }
    let mean_g = workgroup_sum(&mut shared, sum_g) / comptime!(width as f32);
    let mean_gx = workgroup_sum(&mut shared, sum_gx) / comptime!(width as f32);
    for index in 0..per_thread {
        let column = thread + index * THREADS;
        if column < width {
            let mut g = upstream[base + column];
            if affine {
                g = g * weight[column];
            }
            let normalized = (input[base + column] - mean) / deviation;
            gradient[base + column] = (g - mean_g - normalized * mean_gx) / deviation;
        }
    }
}

/// The forward output and, for the backward, each row's mean and standard deviation σ.
pub(super) struct Normalized {
    pub output: CubeTensor,
    pub means: CubeTensor,
    pub deviations: CubeTensor,
}

fn rows_and_width(input: &CubeTensor) -> (usize, usize) {
    let shape = input.meta.shape();
    let width = shape[shape.num_dims() - 1];
    (shape.num_elements() / width, width)
}

/// `weight_and_bias` None is the affine-free norm.
pub(super) fn forward(input: CubeTensor, weight_and_bias: Option<(CubeTensor, CubeTensor)>) -> Normalized {
    let input = into_contiguous(input);
    let (rows, width) = rows_and_width(&input);
    let affine = weight_and_bias.is_some();
    // Unread placeholders for the affine-free norm.
    let (weight, bias) = weight_and_bias
        .map(|(weight, bias)| (into_contiguous(weight), into_contiguous(bias)))
        .unwrap_or_else(|| (input.clone(), input.clone()));
    let empty = |shape: Shape| empty_device_dtype(input.client.clone(), input.device.clone(), shape, DType::F32);
    let output = empty(input.meta.shape().clone());
    let means = empty(Shape::new([rows]));
    let deviations = empty(Shape::new([rows]));
    norm_forward::launch(
        &input.client,
        CubeCount::Static(rows as u32, 1, 1),
        CubeDim::new_1d(THREADS as u32),
        input.clone().into_tensor_arg(),
        weight.into_tensor_arg(),
        bias.into_tensor_arg(),
        output.clone().into_tensor_arg(),
        means.clone().into_tensor_arg(),
        deviations.clone().into_tensor_arg(),
        width,
        affine,
    );
    Normalized { output, means, deviations }
}

pub(super) fn backward(
    input: CubeTensor,
    weight: Option<CubeTensor>,
    means: CubeTensor,
    deviations: CubeTensor,
    upstream: CubeTensor,
) -> CubeTensor {
    let (input, upstream) = (into_contiguous(input), into_contiguous(upstream));
    let (rows, width) = rows_and_width(&input);
    let affine = weight.is_some();
    let weight = weight.map(into_contiguous).unwrap_or_else(|| input.clone());
    let gradient = empty_device_dtype(input.client.clone(), input.device.clone(), input.meta.shape().clone(), DType::F32);
    norm_backward::launch(
        &gradient.client,
        CubeCount::Static(rows as u32, 1, 1),
        CubeDim::new_1d(THREADS as u32),
        input.into_tensor_arg(),
        weight.into_tensor_arg(),
        means.into_tensor_arg(),
        deviations.into_tensor_arg(),
        upstream.into_tensor_arg(),
        gradient.clone().into_tensor_arg(),
        width,
        affine,
    );
    gradient
}
