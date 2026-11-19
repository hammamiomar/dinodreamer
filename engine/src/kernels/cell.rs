//! Differentiable cellular kernels shared by Grow and the carrier benchmark. C=16 state channels, P=64 perceptions, F=96 hidden
//! channels, N=B*H*W cells. The internal layout is [1,N,C], with channels last.
use crate::kernels::{FrozenLinearBackend, matmul::batched_product};
use crate::profiling::detail;
use burn::{
    backend::{
        Backend, Dispatch,
        autodiff::{
            Autodiff,
            checkpoint::{base::Checkpointer, strategy::CheckpointStrategy},
            grads::Gradients,
            ops::{Backward, Ops, OpsKind},
        },
        backend_extension,
        tensor::FloatTensor,
        wgpu::{CubeBackend, CubeTensor},
    },
    tensor::{DType, Shape, Tensor as BurnTensor},
};
use burn_cubecl::{kernel::into_contiguous, ops::numeric::empty_device_dtype};
use cubecl::{CubeCount, CubeDim, prelude::*};

pub const CHANNELS: usize = 16;
pub const PERCEPTIONS: usize = 64;
pub const HIDDEN: usize = 96;
pub const PARAMETERS: usize = 7776;
const THREADS: u32 = 256;

#[backend_extension(Autodiff, Cube)]
pub trait CellBackend: Backend {
    fn perceive(input: FloatTensor<Self>, side: usize, adjoint: bool) -> FloatTensor<Self>;
    fn rule_linear(
        input: FloatTensor<Self>,
        weight: FloatTensor<Self>,
        bias: FloatTensor<Self>,
        relu: bool,
    ) -> FloatTensor<Self>;
}

/// Forward 3×3 Sobel + Laplacian stencil on one toroidal `(cell, channel)`: returns
/// `[identity, sx, sy, lap]` in the exact `(dy, dx)` accumulation order.
#[cube]
pub(super) fn perceive_channel(
    input: &Tensor<f32>,
    cell: usize,
    channel: usize,
    #[comptime] side: usize,
) -> Vector<f32, Const<4>> {
    let grid = cell / (side * side);
    let row = (cell / side) % side;
    let column = cell % side;
    let mut sx = 0.0f32;
    let mut sy = 0.0f32;
    let mut lap = 0.0f32;
    #[unroll]
    for dy in 0..3 {
        #[unroll]
        for dx in 0..3 {
            let neighbor = (grid * side + (row + side + dy - 1) % side) * side
                + (column + side + dx - 1) % side;
            let wy = if dy == 1 { 2.0f32 } else { 1.0f32 };
            let wx = if dx == 1 { 2.0f32 } else { 1.0f32 };
            let kx = (dx as f32 - 1.0f32) * wy / 8.0f32;
            let ky = (dy as f32 - 1.0f32) * wx / 8.0f32;
            let mut kl = wx * wy / 16.0f32;
            if dx == 1 && dy == 1 {
                kl = -0.75f32;
            }
            let value = input[neighbor * CHANNELS + channel];
            sx += value * kx;
            sy += value * ky;
            lap += value * kl;
        }
    }
    let mut result = Vector::<f32, Const<4>>::empty();
    result.insert(0usize, input[cell * CHANNELS + channel]);
    result.insert(1usize, sx);
    result.insert(2usize, sy);
    result.insert(3usize, lap);
    result
}

#[cube(launch)]
fn perception(
    input: &Tensor<f32>,
    extra: &Tensor<f32>,
    output: &mut Tensor<f32>,
    #[comptime] side: usize,
    #[comptime] cells: usize,
    #[comptime] adjoint: bool,
    #[comptime] add_extra: bool,
    #[comptime] row_stride: usize,
) {
    let index = ABSOLUTE_POS;
    if index >= cells * CHANNELS {
        terminate!();
    }
    let cell = index / CHANNELS;
    let channel = index % CHANNELS;
    if adjoint {
        let grid = cell / (side * side);
        let row = (cell / side) % side;
        let column = cell % side;
        let mut sx = 0.0f32;
        let mut sy = 0.0f32;
        let mut lap = 0.0f32;
        #[unroll]
        for dy in 0..3 {
            #[unroll]
            for dx in 0..3 {
                let neighbor = (grid * side + (row + side + dy - 1) % side) * side
                    + (column + side + dx - 1) % side;
                let wy = if dy == 1 { 2.0f32 } else { 1.0f32 };
                let wx = if dx == 1 { 2.0f32 } else { 1.0f32 };
                let kx = (dx as f32 - 1.0f32) * wy / 8.0f32;
                let ky = (dy as f32 - 1.0f32) * wx / 8.0f32;
                let mut kl = wx * wy / 16.0f32;
                if dx == 1 && dy == 1 {
                    kl = -0.75f32;
                }
                let base = neighbor * row_stride + channel * 4;
                sx += input[base + 1] * -kx;
                sy += input[base + 2] * -ky;
                lap += input[base + 3] * kl;
            }
        }
        // The autodiff path adds the residual's own gradient afterwards: the same two
        // operands, so the sum is the same in either order.
        let mut total = input[cell * row_stride + channel * 4] + sx + sy + lap;
        if add_extra {
            total += extra[index];
        }
        output[index] = total;
    } else {
        let values = perceive_channel(input, cell, channel, side);
        let base = cell * PERCEPTIONS + channel * 4;
        output[base] = values.extract(0usize);
        output[base + 1] = values.extract(1usize);
        output[base + 2] = values.extract(2usize);
        output[base + 3] = values.extract(3usize);
    }
}

#[cube(launch)]
fn activation(
    input: &Tensor<f32>,
    bias_or_upstream: &Tensor<f32>,
    output: &mut Tensor<f32>,
    #[comptime] width: usize,
    #[comptime] relu: bool,
    #[comptime] backward: bool,
) {
    let index = ABSOLUTE_POS;
    if index >= output.len() {
        terminate!();
    }
    if backward {
        output[index] = if relu && input[index] <= 0.0f32 {
            0.0f32
        } else {
            bias_or_upstream[index]
        };
    } else {
        let value = input[index] + bias_or_upstream[index % width];
        output[index] = if relu && value < 0.0f32 {
            0.0f32
        } else {
            value
        };
    }
}

fn activated(input: CubeTensor, other: CubeTensor, relu: bool, backward: bool) -> CubeTensor {
    let input = into_contiguous(input);
    let other = into_contiguous(other);
    let [_, rows, width] = input.meta.shape().dims::<3>();
    let output = empty_device_dtype(
        input.client.clone(),
        input.device.clone(),
        input.meta.shape().clone(),
        DType::F32,
    );
    activation::launch(
        &output.client,
        CubeCount::Static((rows * width).div_ceil(THREADS as usize) as u32, 1, 1),
        CubeDim::new_1d(THREADS),
        input.into_tensor_arg(),
        other.into_tensor_arg(),
        output.clone().into_tensor_arg(),
        width,
        relu,
        backward,
    );
    output
}

// Express reshaping/reduction through the backend trait, as the existing resampler does.
fn reshape<B: Backend>(tensor: FloatTensor<B>, shape: impl Into<Shape>) -> FloatTensor<B> {
    B::float_reshape(tensor, shape.into())
}
fn sum_axis<B: Backend>(tensor: FloatTensor<B>, axis: usize) -> FloatTensor<B> {
    B::float_sum_dim(tensor, axis)
}

/// The perception [1, N, 64] of a state, or its adjoint [1, N, 16] of a perception gradient;
/// with `extra` (a state gradient [1, N, 16]), the adjoint plus that gradient in one pass.
fn perception_pass(input: CubeTensor, extra: Option<CubeTensor>, side: usize, adjoint: bool) -> CubeTensor {
    let input = into_contiguous(input);
    let [_, cells, row_stride] = input.meta.shape().dims::<3>();
    if !adjoint {
        assert_eq!(row_stride, CHANNELS);
    }
    let width = if adjoint { CHANNELS } else { PERCEPTIONS };
    let add_extra = extra.is_some();
    // An unread placeholder when there is nothing to add.
    let extra = extra.map(into_contiguous).unwrap_or_else(|| input.clone());
    let output = empty_device_dtype(
        input.client.clone(),
        input.device.clone(),
        Shape::new([1, cells, width]),
        DType::F32,
    );
    perception::launch(
        &output.client,
        CubeCount::Static((cells * CHANNELS).div_ceil(THREADS as usize) as u32, 1, 1),
        CubeDim::new_1d(THREADS),
        input.into_tensor_arg(),
        extra.into_tensor_arg(),
        output.clone().into_tensor_arg(),
        side,
        cells,
        adjoint,
        add_extra,
        row_stride,
    );
    output
}

/// The perception adjoint of the first 64 columns of a wider gradient [1, N, stride] (the
/// pyramid's fine input gradient), [1, N, 16].
pub(crate) fn perceive_adjoint_strided(gradient: CubeTensor, stride: usize, side: usize) -> CubeTensor {
    assert_eq!(gradient.meta.shape().dims::<3>()[2], stride);
    perception_pass(gradient, None, side, true)
}

/// g_x = perceiveᵀ(g_p) + g_y: the adjoint of the perception plus the residual's gradient.
pub(crate) fn perceive_adjoint_plus(perception_gradient_1NP: CubeTensor, state_gradient_1NC: CubeTensor, side: usize) -> CubeTensor {
    detail("cell perception backward", || perception_pass(perception_gradient_1NP, Some(state_gradient_1NC), side, true))
}

/// The generic path of `rule_linear` (the tiled kernel, then the bias and ReLU pass), for the
/// native checks of the band kernels.
pub(crate) fn generic_rule_linear(input: CubeTensor, weight: CubeTensor, bias: CubeTensor, relu: bool) -> CubeTensor {
    activated(CubeBackend::frozen_linear(input, weight, false), bias, relu, false)
}

impl CellBackend for CubeBackend {
    fn perceive(input: CubeTensor, side: usize, adjoint: bool) -> CubeTensor {
        detail(if adjoint { "cell perception backward" } else { "cell perception forward" }, || {
            perception_pass(input, None, side, adjoint)
        })
    }

    fn rule_linear(
        input: CubeTensor,
        weight: CubeTensor,
        bias: CubeTensor,
        relu: bool,
    ) -> CubeTensor {
        detail("cell linear forward", || {
            let [_, cells, inputs] = input.meta.shape().dims::<3>();
            let outputs = weight.meta.shape().dims::<2>()[0];
            if super::cell_linear::serves(cells, inputs, outputs) {
                super::cell_linear::projection(input, weight, bias, relu)
            } else {
                activated(Self::frozen_linear(input, weight, false), bias, relu, false)
            }
        })
    }
}

impl<C: CheckpointStrategy> CellBackend for Autodiff<CubeBackend, C> {
    fn perceive(input: FloatTensor<Self>, side: usize, adjoint: bool) -> FloatTensor<Self> {
        #[derive(Debug)]
        struct PerceptionBackward;
        impl Backward<CubeBackend, 1> for PerceptionBackward {
            type State = (usize, bool);
            fn backward(
                self,
                ops: Ops<Self::State, 1>,
                grads: &mut Gradients,
                _: &mut Checkpointer,
            ) {
                let upstream = grads.consume::<CubeBackend>(&ops.node);
                if let Some(parent) = &ops.parents[0] {
                    grads.register::<CubeBackend>(
                        parent.id,
                        CubeBackend::perceive(upstream, ops.state.0, !ops.state.1),
                    );
                }
            }
        }
        match PerceptionBackward
            .prepare::<C>([input.node()])
            .compute_bound()
            .stateful()
        {
            OpsKind::Tracked(prepared) => prepared.finish(
                (side, adjoint),
                CubeBackend::perceive(input.into_primitive(), side, adjoint),
            ),
            OpsKind::UnTracked(prepared) => {
                prepared.finish(CubeBackend::perceive(input.into_primitive(), side, adjoint))
            }
        }
    }

    fn rule_linear(
        input: FloatTensor<Self>,
        weight: FloatTensor<Self>,
        bias: FloatTensor<Self>,
        relu: bool,
    ) -> FloatTensor<Self> {
        #[derive(Debug)]
        struct LinearBackward;
        impl Backward<CubeBackend, 3> for LinearBackward {
            type State = (CubeTensor, CubeTensor, CubeTensor, bool);
            fn backward(
                self,
                ops: Ops<Self::State, 3>,
                grads: &mut Gradients,
                _: &mut Checkpointer,
            ) {
                let (input, weight, output, relu) = ops.state;
                let upstream = grads.consume::<CubeBackend>(&ops.node);
                let gradient = if relu {
                    detail("cell ReLU backward", || {
                        activated(output, upstream, true, true)
                    })
                } else {
                    upstream
                };
                let [_, cells, inputs] = input.meta.shape().dims::<3>();
                let [outputs, _] = weight.meta.shape().dims::<2>();
                if let Some(parent) = &ops.parents[0] {
                    grads.register::<CubeBackend>(
                        parent.id,
                        detail("cell input gradient", || {
                            CubeBackend::frozen_linear(gradient.clone(), weight, true)
                        }),
                    );
                }
                // Split the large cell reduction into <=256-cell matrix products. This
                // gives dW enough workgroups; a single 96x64 product would be serial in N.
                let chunk = cells.min(256);
                assert_eq!(cells % chunk, 0);
                let chunks = cells / chunk;
                if let Some(parent) = &ops.parents[1] {
                    let left = reshape::<CubeBackend>(
                        gradient.clone(),
                        Shape::new([chunks, 1, chunk, outputs]),
                    );
                    let right =
                        reshape::<CubeBackend>(input, Shape::new([chunks, 1, chunk, inputs]));
                    let derivative = detail("cell weight gradient", || {
                        let partial = batched_product(left, right, true, false, 1.0);
                        reshape::<CubeBackend>(
                            sum_axis::<CubeBackend>(partial, 0),
                            Shape::new([outputs, inputs]),
                        )
                    });
                    grads.register::<CubeBackend>(parent.id, derivative);
                }
                if let Some(parent) = &ops.parents[2] {
                    let rows =
                        reshape::<CubeBackend>(gradient, Shape::new([chunks, chunk, outputs]));
                    let derivative = detail("cell bias gradient", || {
                        let partial = sum_axis::<CubeBackend>(rows, 1);
                        reshape::<CubeBackend>(
                            sum_axis::<CubeBackend>(partial, 0),
                            Shape::new([outputs]),
                        )
                    });
                    grads.register::<CubeBackend>(parent.id, derivative);
                }
            }
        }
        let prepared = LinearBackward
            .prepare::<C>([input.node(), weight.node(), bias.node()])
            .compute_bound()
            .stateful();
        let (input, weight, bias) = (
            input.into_primitive(),
            weight.into_primitive(),
            bias.into_primitive(),
        );
        match prepared {
            OpsKind::Tracked(prepared) => {
                let output = CubeBackend::rule_linear(input.clone(), weight.clone(), bias, relu);
                prepared.finish((input, weight, output.clone(), relu), output)
            }
            OpsKind::UnTracked(prepared) => {
                prepared.finish(CubeBackend::rule_linear(input, weight, bias, relu))
            }
        }
    }
}

pub fn perceive(state_1NC: BurnTensor<3>, side: usize) -> BurnTensor<3> {
    BurnTensor::from_dispatch(Dispatch::perceive(state_1NC.into_dispatch(), side, false))
}

/// The generic tiled projection with the separate bias and ReLU pass, on frozen tensors, for
/// the native checks of the band kernels.
pub fn generic_linear(input_1NI: BurnTensor<3>, weight_OI: BurnTensor<2>, bias_O: BurnTensor<1>, relu: bool) -> BurnTensor<3> {
    use burn::backend::{BackendTensor, DispatchAutodiffContext, DispatchTensor, DispatchTensorKind};
    let cube = |tensor: DispatchTensor| match tensor.kind {
        DispatchTensorKind::Cube(BackendTensor::Float(inner)) => inner,
        _ => panic!("generic_linear takes frozen float tensors on the Cube backend"),
    };
    let output = generic_rule_linear(
        cube(input_1NI.into_dispatch()),
        cube(weight_OI.into_dispatch()),
        cube(bias_O.into_dispatch()),
        relu,
    );
    BurnTensor::from_dispatch(DispatchTensor { kind: DispatchTensorKind::Cube(BackendTensor::Float(output)), autodiff: DispatchAutodiffContext::Disabled })
}

pub fn linear(
    input_1NI: BurnTensor<3>,
    weight_OI: BurnTensor<2>,
    bias_O: BurnTensor<1>,
    relu: bool,
) -> BurnTensor<3> {
    BurnTensor::from_dispatch(Dispatch::rule_linear(
        input_1NI.into_dispatch(),
        weight_OI.into_dispatch(),
        bias_O.into_dispatch(),
        relu,
    ))
}
