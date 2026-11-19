//! The pyramid's fine input in one kernel each way: the fine grid's 64 perceptions and the
//! coarse grid's 16 channels upsampled on the torus, as the fc1 input [1, N, 80]. The Burn
//! chain it replaces (`grow::figure::upsample_torus`: per axis two narrows, two cats, four
//! scalar products, two sums, a stack and a reshape, then a cat with the perceptions) is about
//! two dozen dispatches and two 21 MB buffers per tick, forward and backward.
//!
//! The forward repeats that chain's arithmetic exactly: along the width, an even fine column
//! 2c is round(round(0.25 · x[c − 1]) + round(0.75 · x[c])) and an odd column 2c + 1 is
//! round(round(0.75 · x[c]) + round(0.25 · x[c + 1])), wrapping; then the same along the
//! height on the widened rows. The products are separate statements so they round before the
//! sum, as the separate kernels did. The perceptions repeat `cell.rs::perception`. The replay
//! page compares picture bytes, so this forward order is the contract.
//!
//! The adjoint is the transpose of that linear map: each coarse cell gathers its sixteen fine
//! taps (weights 0.25 and 0.75 per axis) from the gradient's upsampled columns, the height
//! pass first and then the width pass, each in the tape's own accumulation order, so the
//! coarse gradient is bit-identical to the chain's. The fine gradient is the perception
//! adjoint on the gradient's first 64 columns, bit for bit.
use super::{
    cell::{self, CHANNELS, CellBackend, HIDDEN, PERCEPTIONS, perceive_channel},
    cell_step,
};
use crate::profiling::detail;
use burn::backend::ops::FloatTensorOps;
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

/// The fine input's width: 64 perceptions, then the 16 upsampled coarse channels.
pub const INPUTS: usize = PERCEPTIONS + CHANNELS;
const THREADS: u32 = 256;

#[backend_extension(Autodiff, Cube)]
pub trait PyramidInputBackend: Backend {
    fn pyramid_fine_input(fine: FloatTensor<Self>, coarse: FloatTensor<Self>, side: usize) -> FloatTensor<Self>;
}

/// `grow::figure::upsample_axis` for one output index: the two weighted neighbours of x along
/// an axis, with the products rounded before the sum. 0.75 · x is written as x − 0.25 · x: the
/// same rounded value (0.25 · x is exact), but a sum, so the compiler cannot contract the product
/// into the following addition, which would round once where the separate kernels round twice.
#[cube]
fn upsampled(previous: f32, current: f32, next: f32, odd: bool) -> f32 {
    if odd {
        let first = current - current * 0.25f32;
        let second = next * 0.25f32;
        first + second
    } else {
        let first = previous * 0.25f32;
        let second = current - current * 0.25f32;
        first + second
    }
}

/// One thread per (fine cell, channel): the channel's four perceptions and its upsampled
/// coarse value. `fine` [1, N, 16], `coarse` [1, N / 4, 16], `output` [1, N, 80].
#[cube(launch)]
fn fine_input_kernel(
    fine: &Tensor<f32>,
    coarse: &Tensor<f32>,
    output: &mut Tensor<f32>,
    #[comptime] side: usize,
    #[comptime] cells: usize,
) {
    let index = ABSOLUTE_POS;
    if index >= cells * CHANNELS {
        terminate!();
    }
    let cell = index / CHANNELS;
    let channel = index % CHANNELS;
    let grid = cell / (side * side);
    let row = (cell / side) % side;
    let column = cell % side;
    let values = perceive_channel(fine, cell, channel, side);
    let base = cell * INPUTS + channel * 4;
    output[base] = values.extract(0usize);
    output[base + 1] = values.extract(1usize);
    output[base + 2] = values.extract(2usize);
    output[base + 3] = values.extract(3usize);
    // The upsampled coarse value: the width pass on the two coarse rows this fine row reads,
    // then the height pass on those two widened values.
    let coarse_side = side / 2;
    let coarse_grid = grid * coarse_side * coarse_side;
    let coarse_row = row / 2;
    let coarse_column = column / 2;
    let row_odd = row % 2 == 1;
    let column_odd = column % 2 == 1;
    // The two coarse rows: (r − 1, r) for an even fine row, (r, r + 1) for an odd one.
    let first_row = if row_odd { coarse_row } else { (coarse_row + coarse_side - 1) % coarse_side };
    let second_row = if row_odd { (coarse_row + 1) % coarse_side } else { coarse_row };
    let previous_column = (coarse_column + coarse_side - 1) % coarse_side;
    let next_column = (coarse_column + 1) % coarse_side;
    let first_base = (coarse_grid + first_row * coarse_side) * CHANNELS + channel;
    let second_base = (coarse_grid + second_row * coarse_side) * CHANNELS + channel;
    let first_wide = upsampled(
        coarse[first_base + previous_column * CHANNELS],
        coarse[first_base + coarse_column * CHANNELS],
        coarse[first_base + next_column * CHANNELS],
        column_odd,
    );
    let second_wide = upsampled(
        coarse[second_base + previous_column * CHANNELS],
        coarse[second_base + coarse_column * CHANNELS],
        coarse[second_base + next_column * CHANNELS],
        column_odd,
    );
    // Along the height the roles are (previous, current) for an even row and (current, next) for an odd one.
    let value = if row_odd {
        upsampled(0.0f32, first_wide, second_wide, true)
    } else {
        upsampled(first_wide, second_wide, 0.0f32, false)
    };
    output[cell * INPUTS + PERCEPTIONS + channel] = value;
}

/// The adjoint of `upsample_axis` for one coarse index k: the four fine gradients that read it,
/// summed as Burn's tape sums them. The order was found by matching the tape bit for bit over
/// every accumulation order (`examples/cell_step_check.rs order`): the odd fine position 2k + 1
/// (weight 0.75) plus the wrap from 2k − 1 (0.25), then the even position 2k (0.75), then
/// 2k + 2 (0.25). Each 0.75 product is written as g − 0.25 · g, the same rounded value, so no
/// contraction can fold a product into the following sum.
#[cube]
fn gathered(before: f32, even: f32, odd: f32, after: f32) -> f32 {
    let odd_term = odd - odd * 0.25f32;
    let next_term = before * 0.25f32;
    let even_term = even - even * 0.25f32;
    let previous_term = after * 0.25f32;
    ((odd_term + next_term) + even_term) + previous_term
}

/// One thread per (coarse cell, channel): the sixteen fine taps that read this coarse cell,
/// summed as the tape's chain does: the height pass first (the gradient of the widened rows),
/// then the width pass on those four widened values. `gradient` [1, N, 80], `output` [1, N / 4, 16].
#[cube(launch)]
fn upsample_adjoint(
    gradient: &Tensor<f32>,
    output: &mut Tensor<f32>,
    #[comptime] side: usize,
    #[comptime] coarse_cells: usize,
) {
    let index = ABSOLUTE_POS;
    if index >= coarse_cells * CHANNELS {
        terminate!();
    }
    let coarse_side = side / 2;
    let cell = index / CHANNELS;
    let channel = index % CHANNELS;
    let grid = cell / (coarse_side * coarse_side);
    let row = (cell / coarse_side) % coarse_side;
    let column = cell % coarse_side;
    // The widened rows' gradient at coarse row `row`, for the four fine columns that read
    // coarse column `column`: 2c − 1, 2c, 2c + 1, 2c + 2.
    let mut widened = Array::<f32>::new(WIDTH_TAPS);
    #[unroll]
    for tap in 0..WIDTH_TAPS {
        let fine_column = (column * 2 + side + tap - 1) % side;
        let mut values = Array::<f32>::new(WIDTH_TAPS);
        #[unroll]
        for row_tap in 0..WIDTH_TAPS {
            let fine_row = (row * 2 + side + row_tap - 1) % side;
            values[row_tap] = gradient[((grid * side + fine_row) * side + fine_column) * INPUTS + PERCEPTIONS + channel];
        }
        widened[tap] = gathered(values[0], values[1], values[2], values[3]);
    }
    output[cell * CHANNELS + channel] = gathered(widened[0], widened[1], widened[2], widened[3]);
}

/// Fine positions along one axis that read a coarse position: 2k − 1, 2k, 2k + 1, 2k + 2.
const WIDTH_TAPS: usize = 4;

fn launch_count(items: usize) -> CubeCount {
    CubeCount::Static(items.div_ceil(THREADS as usize) as u32, 1, 1)
}

fn forward(fine: CubeTensor, coarse: CubeTensor, side: usize) -> CubeTensor {
    let (fine, coarse) = (into_contiguous(fine), into_contiguous(coarse));
    let [_, cells, channels] = fine.meta.shape().dims::<3>();
    assert_eq!(channels, CHANNELS);
    assert_eq!(coarse.meta.shape().dims::<3>(), [1, cells / 4, CHANNELS]);
    assert_eq!(cells % (side * side), 0);
    let output = empty_device_dtype(fine.client.clone(), fine.device.clone(), Shape::new([1, cells, INPUTS]), DType::F32);
    fine_input_kernel::launch(
        &output.client,
        launch_count(cells * CHANNELS),
        CubeDim::new_1d(THREADS),
        fine.into_tensor_arg(),
        coarse.into_tensor_arg(),
        output.clone().into_tensor_arg(),
        side,
        cells,
    );
    output
}

/// The coarse gradient [1, N / 4, 16] of the fine input's gradient [1, N, 80].
fn coarse_gradient(gradient: &CubeTensor, side: usize) -> CubeTensor {
    let [_, cells, _] = gradient.meta.shape().dims::<3>();
    let coarse_cells = cells / 4;
    let output = empty_device_dtype(gradient.client.clone(), gradient.device.clone(), Shape::new([1, coarse_cells, CHANNELS]), DType::F32);
    upsample_adjoint::launch(
        &output.client,
        launch_count(coarse_cells * CHANNELS),
        CubeDim::new_1d(THREADS),
        gradient.clone().into_tensor_arg(),
        output.clone().into_tensor_arg(),
        side,
        coarse_cells,
    );
    output
}

/// The coarse gradient of a frozen fine-input gradient [1, N, 80], for the native check.
#[cfg(feature = "harness")]
pub fn coarse_gradient_check(gradient_1NI: BurnTensor<3>, side: usize) -> BurnTensor<3> {
    let gradient = cell_step::cube(gradient_1NI.into_dispatch());
    let output = coarse_gradient(&gradient, side);
    BurnTensor::from_dispatch(cell_step::dispatch(output))
}

impl PyramidInputBackend for CubeBackend {
    fn pyramid_fine_input(fine: CubeTensor, coarse: CubeTensor, side: usize) -> CubeTensor {
        detail("pyramid fine input forward", || forward(fine, coarse, side))
    }
}

impl<C: CheckpointStrategy> PyramidInputBackend for Autodiff<CubeBackend, C> {
    fn pyramid_fine_input(fine: FloatTensor<Self>, coarse: FloatTensor<Self>, side: usize) -> FloatTensor<Self> {
        #[derive(Debug)]
        struct FineInputBackward;
        impl Backward<CubeBackend, 2> for FineInputBackward {
            type State = usize;
            fn backward(self, ops: Ops<Self::State, 2>, grads: &mut Gradients, _: &mut Checkpointer) {
                let side = ops.state;
                let upstream = into_contiguous(grads.consume::<CubeBackend>(&ops.node));
                if let Some(parent) = &ops.parents[0] {
                    let gradient = detail("cell perception backward", || cell::perceive_adjoint_strided(upstream.clone(), INPUTS, side));
                    grads.register::<CubeBackend>(parent.id, gradient);
                }
                if let Some(parent) = &ops.parents[1] {
                    let gradient = detail("pyramid upsample backward", || coarse_gradient(&upstream, side));
                    grads.register::<CubeBackend>(parent.id, gradient);
                }
            }
        }
        let prepared = FineInputBackward.prepare::<C>([fine.node(), coarse.node()]).compute_bound().stateful();
        let (fine, coarse) = (fine.into_primitive(), coarse.into_primitive());
        match prepared {
            OpsKind::Tracked(prepared) => prepared.finish(side, CubeBackend::pyramid_fine_input(fine, coarse, side)),
            OpsKind::UnTracked(prepared) => prepared.finish(CubeBackend::pyramid_fine_input(fine, coarse, side)),
        }
    }
}

/// cat(perceive(fine), upsample_torus(coarse)) [1, N, 80] in one dispatch; both inputs may
/// carry gradients. `fine_1NC` [1, N, 16] on a torus of `side`, `coarse_1MC` [1, N / 4, 16].
pub fn fine_input(fine_1NC: BurnTensor<3>, coarse_1MC: BurnTensor<3>, side: usize) -> BurnTensor<3> {
    BurnTensor::from_dispatch(Dispatch::pyramid_fine_input(fine_1NC.into_dispatch(), coarse_1MC.into_dispatch(), side))
}

/// Fine and coarse state tensors (or their upstream gradients) of a two-level pyramid grid.
pub struct PyramidStates {
    pub fine_1NC: BurnTensor<3>,
    pub coarse_1MC: BurnTensor<3>,
}

/// Inputs to `chunk_gradient` for one rollout chunk of a pyramid rule.
pub struct PyramidChunkInput<'a> {
    pub start: PyramidStates,
    pub parameters: [BurnTensor<2>; 6],
    pub fine_keys: &'a [u32],
    pub coarse_keys: &'a [u32],
    pub rate: f32,
    pub side: usize,
    pub upstream: PyramidStates,
}

/// The gradients of one chunk of pyramid steps: the state gradients at the chunk's start (fine
/// and coarse) and the six parameter gradients in the material layout's order (the coarse
/// rule's fc1, bias and fc2, then the fine rule's).
pub struct PyramidChunkGradient {
    pub fine_1NC: BurnTensor<3>,
    pub coarse_1MC: BurnTensor<3>,
    pub parameters: [BurnTensor<2>; 6],
}

/// The backward of `fine_keys.len()` pyramid steps from the chunk's start states with the
/// firing masks of `fine_keys` and `coarse_keys` (one per step), given the gradients of the
/// chunk's last states. The chunk is recomputed forward: the coarse step as the fused cell step
/// saving its hidden values, the fine input through `fine_input`, the fine step through the
/// band projections; each step saves what its backward reads. Backward, last step first: the
/// fine rule's band adjoints and products, the fine input's adjoint (the perception adjoint
/// plus the fine residual's gradient; the upsample adjoint added to the coarse upstream as the
/// tape adds it), then the coarse rule's. Every reduction keeps the tape's order, so the result
/// equals the tape bit for bit. `parameters` are the six frozen tensors, [96, 64], [96],
/// [16, 96], [96, 80], [96], [16, 96]; the gradients come back in the same shapes.
pub fn chunk_gradient(input: PyramidChunkInput<'_>) -> PyramidChunkGradient {
    use cell_step::{
        BackwardStepConfig, CHUNK, ForwardOptions, ForwardParameters, RuleWeights, Skip,
        cell_rule_backward_step, cube, dispatch, forward,
    };
    let PyramidChunkInput {
        start,
        parameters,
        fine_keys,
        coarse_keys,
        rate,
        side,
        upstream,
    } = input;
    assert_eq!(fine_keys.len(), coarse_keys.len());
    let device = start.fine_1NC.device();
    let cells = start.fine_1NC.dims()[1];
    let coarse_cells = cells / 4;
    let coarse_side = side / 2;
    assert!(cells % CHUNK == 0 && coarse_cells % CHUNK == 0);
    let (chunks, coarse_chunks) = (cells / CHUNK, coarse_cells / CHUNK);
    let [fc1_c, bias_c, fc2_c, fc1_f, bias_f, fc2_f] =
        parameters.map(|tensor| cube(tensor.into_dispatch()));
    let bias_c_1 = CubeBackend::float_reshape(bias_c.clone(), Shape::new([HIDDEN]));
    let bias_f_1 = CubeBackend::float_reshape(bias_f.clone(), Shape::new([HIDDEN]));
    let zero_bias = CubeBackend::float_zeros(
        Shape::new([CHANNELS]),
        &fc1_c.device,
        burn::tensor::FloatDType::F32,
    );

    // Forward through the chunk, keeping every state and the activations each backward reads.
    let mut fines = vec![cube(start.fine_1NC.into_dispatch())];
    let mut coarses = vec![cube(start.coarse_1MC.into_dispatch())];
    let mut coarse_hiddens = Vec::with_capacity(fine_keys.len());
    let mut inputs = Vec::with_capacity(fine_keys.len());
    let mut fine_hiddens = Vec::with_capacity(fine_keys.len());
    for (&fine_key, &coarse_key) in fine_keys.iter().zip(coarse_keys) {
        let (coarse_next, coarse_hidden) = detail("cell step forward", || {
            forward(
                coarses.last().unwrap().clone(),
                ForwardParameters {
                    fc1: fc1_c.clone(),
                    bias: bias_c_1.clone(),
                    fc2: fc2_c.clone(),
                },
                ForwardOptions {
                    key: coarse_key,
                    rate,
                    side: coarse_side,
                    save: true,
                    skip: Skip::default(),
                },
            )
        });
        let input = detail("pyramid fine input forward", || {
            super::pyramid::forward(fines.last().unwrap().clone(), coarse_next.clone(), side)
        });
        let fine_hidden =
            CubeBackend::rule_linear(input.clone(), fc1_f.clone(), bias_f_1.clone(), true);
        let delta =
            CubeBackend::rule_linear(fine_hidden.clone(), fc2_f.clone(), zero_bias.clone(), false);
        // fine + delta · mask, matching the tape's exact operations.
        let mask = cube(super::draws::fire_mask(fine_key, cells, rate, &device).into_dispatch());
        let fine_next =
            CubeBackend::float_add(fines.last().unwrap().clone(), CubeBackend::float_mul(delta, mask));
        fines.push(fine_next);
        coarses.push(coarse_next);
        coarse_hiddens.push(coarse_hidden.unwrap());
        inputs.push(input);
        fine_hiddens.push(fine_hidden);
    }

    let mut fine_gradient = cube(upstream.fine_1NC.into_dispatch());
    let mut coarse_upstream = cube(upstream.coarse_1MC.into_dispatch());
    let mut totals: Option<[CubeTensor; 6]> = None;
    for index in (0..fine_keys.len()).rev() {
        let fine_step = cell_rule_backward_step(
            &fine_gradient,
            || inputs[index].clone(),
            fine_hiddens[index].clone(),
            RuleWeights { fc1: &fc1_f, fc2: &fc2_f },
            BackwardStepConfig {
                key: fine_keys[index],
                rate,
                chunks,
            },
        );
        // The fine input's adjoint: the perception part plus the fine residual's gradient, and
        // the upsample part added to the coarse upstream, as the tape registers them.
        let coarse_total = CubeBackend::float_add(
            detail("pyramid upsample backward", || coarse_gradient(&fine_step.input_gradient, side)),
            coarse_upstream,
        );
        fine_gradient = cell::perceive_adjoint_plus(fine_step.input_gradient, fine_gradient, side);
        let coarse_step = cell_rule_backward_step(
            &coarse_total,
            || CubeBackend::perceive(coarses[index].clone(), coarse_side, false),
            coarse_hiddens[index].clone(),
            RuleWeights { fc1: &fc1_c, fc2: &fc2_c },
            BackwardStepConfig {
                key: coarse_keys[index],
                rate,
                chunks: coarse_chunks,
            },
        );
        coarse_upstream =
            cell::perceive_adjoint_plus(coarse_step.input_gradient, coarse_total, coarse_side);
        let steps = [
            coarse_step.fc1,
            coarse_step.bias,
            coarse_step.fc2,
            fine_step.fc1,
            fine_step.bias,
            fine_step.fc2,
        ];
        totals = Some(match totals {
            // Burn's gradient container adds a new gradient as new + old.
            Some(old) => {
                let mut pairs = steps.into_iter().zip(old);
                std::array::from_fn(|_| {
                    let (new, old) = pairs.next().unwrap();
                    CubeBackend::float_add(new, old)
                })
            }
            None => steps,
        });
    }
    let totals = totals.expect("at least one step");
    let shapes = [
        [HIDDEN, PERCEPTIONS],
        [1, HIDDEN],
        [CHANNELS, HIDDEN],
        [HIDDEN, INPUTS],
        [1, HIDDEN],
        [CHANNELS, HIDDEN],
    ];
    let mut totals = totals.into_iter().zip(shapes);
    PyramidChunkGradient {
        fine_1NC: BurnTensor::from_dispatch(dispatch(fine_gradient)),
        coarse_1MC: BurnTensor::from_dispatch(dispatch(coarse_upstream)),
        parameters: std::array::from_fn(|_| {
            let (total, shape) = totals.next().unwrap();
            BurnTensor::from_dispatch(dispatch(CubeBackend::float_reshape(total, Shape::new(shape))))
        }),
    }
}
