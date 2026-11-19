//! The cell rule's step as one dispatch each way: perception, fc1, bias and ReLU, fc2, the
//! firing mask and the residual for a tile of cells, with the perceptions and the hidden values
//! kept on chip. The unfused path (`cell.rs` through Burn's autodiff) writes the N × 64
//! perceptions and the N × 96 hidden values to global memory and reads them back several times
//! per step, about 170 MB per step forward and more backward at batch 4; the fused forward reads
//! the state and writes the new state, about 9 MB.
//!
//! Every arithmetic statement repeats the unfused kernels' statement, in their order, so the
//! results are bit-identical: the perception taps in (dy, dx) order; each product as one
//! accumulator per output with the reduction index ascending and one fused multiply-add per
//! term (`linear.rs`, `matmul.rs`); the bias added to the rounded sum, then ReLU
//! (`cell.rs::activation`); the firing draw as `draws.rs::counter_draws`; the residual as
//! x + mask · d; the ReLU gradient as `activation`'s backward; the weight-gradient partials
//! over the same 256-cell chunks as `cell.rs`, cells ascending. `examples/cell_step_check.rs`
//! checks both kernels against the unfused operations bit for bit.
//!
//! Forward layout: a workgroup owns 32 cells and 8 × 24 threads. Thread (cell quad, hidden
//! quad) accumulates fc1 for 4 cells × 4 hidden values, as the tiled linear kernel's threads do:
//! the perceptions of four channels at a time from a k-major shared tile, the weights from the
//! k-major copy of fc1 in global memory (24 KiB, cache-resident). The hidden tile is k-major
//! with a padded row, so fc2's 32 cells of one index are 32 consecutive words. Shared memory is
//! 15,744 bytes (15.375 KiB): the perception tile 2,048, the hidden tile 12,672, the weight slab 1,024.
//!
//! Backward layout: a workgroup owns one 256-cell chunk as 16 sub-tiles and keeps the chunk's
//! partial weight gradients in registers (32 fc1 and 8 fc2 values per thread) across the
//! sub-tiles. Per sub-tile it loads the saved hidden values, forms the masked upstream, recomputes
//! the perceptions, then: the fc2 weight partial, the hidden gradient (written out for the exact
//! bias reduction), the fc1 weight partial, and the perception gradient through fc1. The
//! perception adjoint and the residual's gradient follow as one pass (`cell::perceive_adjoint_plus`).
use super::{
    cell::{self, CHANNELS, CellBackend, HIDDEN, PERCEPTIONS, perceive_channel},
    cell_linear,
    draws::fired,
    matmul::batched_product,
};
use crate::profiling::detail;
use burn::{
    backend::{
        AutodiffBackend, Backend, BackendTensor, Dispatch, DispatchAutodiffContext, DispatchTensor, DispatchTensorKind,
        autodiff::{Autodiff, checkpoint::strategy::CheckpointStrategy},
        backend_extension,
        ops::FloatTensorOps,
        tensor::FloatTensor,
        wgpu::{CubeBackend, CubeTensor},
    },
    tensor::{DType, Shape, Tensor as BurnTensor},
};
use burn_cubecl::{kernel::into_contiguous, ops::numeric::empty_device_dtype};
use cubecl::{CubeCount, CubeDim, prelude::*};

/// Cells per forward workgroup: 8 quads of cells × 24 quads of hidden values, one 4 × 4 tile per thread.
const FORWARD_TILE: usize = 32;
const CELL_QUADS: usize = FORWARD_TILE / 4;
const HIDDEN_QUADS: usize = HIDDEN / 4;
/// Perception indices (four channels) staged in shared memory at once (forward).
const QUARTER: usize = PERCEPTIONS / 4;
/// Row stride of the forward's k-major hidden tile, padded against bank conflicts.
const FORWARD_HIDDEN_STRIDE: usize = FORWARD_TILE + 1;
/// Reduction indices per inner iteration, as in the linear kernel.
const UNROLL: usize = 4;
/// Cells per thread in the forward: a quad.
const ROWS: usize = 4;

/// The weight-gradient chunk of `cell.rs`: partial sums over 256 cells, then over the chunks.
const CHUNK_CELLS: usize = 256;
/// Hidden indices of fc2 staged in shared memory at once (forward).
const FC2_SLAB: usize = 16;
const CHANNEL_QUADS: usize = CHANNELS / 4;

/// Four hidden values, four cells or four channels at one reduction index.
type Quad = Vector<f32, Const<4>>;

#[backend_extension(Autodiff, Cube)]
pub trait CellStepBackend: Backend {
    fn cell_step(
        state: FloatTensor<Self>,
        fc1: FloatTensor<Self>,
        bias: FloatTensor<Self>,
        fc2: FloatTensor<Self>,
        key: u32,
        rate: f32,
        side: usize,
    ) -> FloatTensor<Self>;
}

/// Phases left out of the forward kernel, for the native ablation (`examples/cell_step_check.rs
/// ablate`). Every field is false in the engine, so the shipped kernel compiles without the branches.
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq, Hash)]
pub struct Skip {
    pub perception: bool,
    pub fc1: bool,
    pub fc2: bool,
}

#[cube(launch)]
fn fused_step(
    state: &Tensor<f32>,
    fc1_transposed: &Tensor<f32>,
    bias: &Tensor<f32>,
    fc2_transposed: &Tensor<f32>,
    output: &mut Tensor<f32>,
    hidden_out: &mut Tensor<f32>,
    key: u32,
    rate: f32,
    #[comptime] side: usize,
    #[comptime] save: bool,
    #[comptime] skip: Skip,
) {
    let hidden_quad = UNIT_POS_X as usize;
    let cell_quad = UNIT_POS_Y as usize;
    let thread = UNIT_POS as usize;
    let first_cell = CUBE_POS * FORWARD_TILE;
    // Four channels of perceptions, k-major: entry k · FORWARD_TILE + cell.
    let mut perceptions = Shared::<[f32]>::new_slice(QUARTER * FORWARD_TILE);
    // ReLU(fc1) of the tile, k-major with a padded row: entry k · stride + cell.
    let mut hidden = Shared::<[f32]>::new_slice(HIDDEN * FORWARD_HIDDEN_STRIDE);
    // One slab of fc2, k-major: entry k · CHANNEL_QUADS + quad holds four channels' weights at index k.
    let mut weights = Shared::<[Quad]>::new_slice(FC2_SLAB * CHANNEL_QUADS);

    // fc1: four cells × four hidden values per thread, k ascending, one multiply-add per term.
    let mut accumulators = Array::<Quad>::new(ROWS);
    #[unroll]
    for row in 0..ROWS {
        accumulators[row] = Quad::new(0.0);
    }
    for quarter in 0..PERCEPTIONS / QUARTER {
        // Perception of this quarter's four channels: one thread per (cell, channel),
        // sharing `cell::perceive_channel`, into the k-major tile.
        #[allow(clippy::collapsible_if)] // comptime skip guard must stay outside the runtime condition
        if !skip.perception {
            if thread < FORWARD_TILE * 4 {
                let cell = thread % FORWARD_TILE;
                let channel_in_quarter = thread / FORWARD_TILE;
                let channel = quarter * 4 + channel_in_quarter;
                let global_cell = first_cell + cell;
                let values = perceive_channel(state, global_cell, channel, side);
                let base = channel_in_quarter * 4;
                perceptions[base * FORWARD_TILE + cell] = values.extract(0usize);
                perceptions[(base + 1) * FORWARD_TILE + cell] = values.extract(1usize);
                perceptions[(base + 2) * FORWARD_TILE + cell] = values.extract(2usize);
                perceptions[(base + 3) * FORWARD_TILE + cell] = values.extract(3usize);
            }
        }
        sync_cube();
        let k_base = quarter * QUARTER;
        for step in 0..(if skip.fc1 { 0 } else { QUARTER / UNROLL }) {
            #[unroll]
            for offset in 0..UNROLL {
                let k = step * UNROLL + offset;
                let mut input_values = Quad::empty();
                #[unroll]
                for lane in 0..4 {
                    input_values.insert(lane, perceptions[k * FORWARD_TILE + cell_quad * 4 + lane]);
                }
                // The thread's four hidden values at this index, from the k-major copy of fc1.
                let mut weight_values = Quad::empty();
                #[unroll]
                for lane in 0..4 {
                    weight_values.insert(lane, fc1_transposed[(k_base + k) * HIDDEN + hidden_quad * 4 + lane]);
                }
                #[unroll]
                for row in 0..ROWS {
                    accumulators[row] += Quad::new(input_values.extract(row)) * weight_values;
                }
            }
        }
        // No thread may overwrite the perception tile until every thread has finished reading it.
        sync_cube();
    }
    // Bias and ReLU on the rounded sums, as `activation` applies them to the stored product.
    #[unroll]
    for row in 0..ROWS {
        let cell = cell_quad * 4 + row;
        let values = accumulators[row];
        #[unroll]
        for lane in 0..4 {
            let column = hidden_quad * 4 + lane;
            let value = values.extract(lane) + bias[column];
            let activated = if value < 0.0f32 { 0.0f32 } else { value };
            hidden[column * FORWARD_HIDDEN_STRIDE + cell] = activated;
            if save {
                hidden_out[(first_cell + cell) * HIDDEN + column] = activated;
            }
        }
    }
    sync_cube();

    // fc2, the firing draw and the residual: 128 threads own one cell × four channels each,
    // hidden index ascending with one multiply-add per term, the weights from 16-deep slabs.
    let fc2_active = thread < FORWARD_TILE * 4;
    let cell = thread % FORWARD_TILE;
    let channel_quad = thread / FORWARD_TILE;
    let mut totals = Quad::new(0.0);
    for slab in 0..(if skip.fc2 { 0 } else { HIDDEN / FC2_SLAB }) {
        let k_base = slab * FC2_SLAB;
        if thread < FC2_SLAB * CHANNEL_QUADS {
            let k = thread / CHANNEL_QUADS;
            let quad = thread % CHANNEL_QUADS;
            let mut values = Quad::empty();
            #[unroll]
            for lane in 0..4 {
                values.insert(lane, fc2_transposed[(k_base + k) * CHANNELS + quad * 4 + lane]);
            }
            weights[k * CHANNEL_QUADS + quad] = values;
        }
        sync_cube();
        if fc2_active {
            for step in 0..FC2_SLAB / UNROLL {
                #[unroll]
                for offset in 0..UNROLL {
                    let k = step * UNROLL + offset;
                    let activated = hidden[(k_base + k) * FORWARD_HIDDEN_STRIDE + cell];
                    totals += Quad::new(activated) * weights[k * CHANNEL_QUADS + channel_quad];
                }
            }
        }
        sync_cube();
    }
    #[allow(clippy::collapsible_if)] // comptime skip guard must stay outside the runtime condition
    if !skip.fc2 {
        if fc2_active {
            let global_cell = first_cell + cell;
            let mask = fired(key, global_cell as u32, rate);
            #[unroll]
            for lane in 0..4 {
                // The unfused step adds fc2's zero bias to the stored product.
                let delta = totals.extract(lane) + 0.0f32;
                let scaled = delta * mask;
                let position = global_cell * CHANNELS + channel_quad * 4 + lane;
                output[position] = state[position] + scaled;
            }
        }
    }
}

/// g_d = mask · g_y: the residual's gradient through the firing mask, drawn in the kernel.
#[cube(launch)]
fn masked_delta(upstream: &Tensor<f32>, output: &mut Tensor<f32>, key: u32, rate: f32) {
    let index = ABSOLUTE_POS;
    if index >= output.len() {
        terminate!();
    }
    let cell = index / CHANNELS;
    output[index] = upstream[index] * fired(key, cell as u32, rate);
}

/// g_d = mask · g_y for `gradient` [1, N, 16] with the firing mask of `key`.
pub(super) fn masked(gradient: &CubeTensor, key: u32, rate: f32) -> CubeTensor {
    let cells = gradient.meta.shape().dims::<3>()[1];
    let delta = empty(gradient, [1, cells, CHANNELS]);
    masked_delta::launch(
        &delta.client,
        CubeCount::Static((cells * CHANNELS).div_ceil(256) as u32, 1, 1),
        CubeDim::new_1d(256),
        gradient.clone().into_tensor_arg(),
        delta.clone().into_tensor_arg(),
        key,
        rate,
    );
    delta
}

/// The bias gradient of `cell.rs`: the hidden gradient summed over 256-cell chunks, then over the chunks.
pub(super) fn bias_gradient(hidden_gradient: &CubeTensor, chunks: usize) -> CubeTensor {
    let rows = CubeBackend::float_reshape(hidden_gradient.clone(), Shape::new([chunks, CHUNK_CELLS, HIDDEN]));
    let partial = CubeBackend::float_sum_dim(rows, 1);
    CubeBackend::float_reshape(CubeBackend::float_sum_dim(partial, 0), Shape::new([HIDDEN]))
}

pub(super) const CHUNK: usize = CHUNK_CELLS;

/// A frozen tensor's CubeCL primitive. Tracked tensors are refused: the chunk backward is
/// the gradient, it does not record one.
pub(super) fn cube(tensor: DispatchTensor) -> CubeTensor {
    match tensor.kind {
        DispatchTensorKind::Cube(BackendTensor::Float(inner)) => into_contiguous(inner),
        _ => panic!("the fused cell step takes frozen float tensors on the Cube backend"),
    }
}

pub(super) fn dispatch(tensor: CubeTensor) -> DispatchTensor {
    DispatchTensor { kind: DispatchTensorKind::Cube(BackendTensor::Float(tensor)), autodiff: DispatchAutodiffContext::Disabled }
}

/// The k-major copies the forward reads: fc1 as [64, 96] and fc2 as [96, 16].
fn transposed(weight: CubeTensor) -> CubeTensor {
    into_contiguous(CubeBackend::float_swap_dims(weight, 0, 1))
}

pub(super) fn empty(like: &CubeTensor, shape: [usize; 3]) -> CubeTensor {
    empty_device_dtype(like.client.clone(), like.device.clone(), Shape::new(shape), DType::F32)
}

pub(super) struct ForwardParameters {
    pub(super) fc1: CubeTensor,
    pub(super) bias: CubeTensor,
    pub(super) fc2: CubeTensor,
}

pub(super) struct ForwardOptions {
    pub(super) key: u32,
    pub(super) rate: f32,
    pub(super) side: usize,
    pub(super) save: bool,
    pub(super) skip: Skip,
}

/// The fused forward on frozen tensors; with `save`, also the ReLU output [1, N, 96] the
/// backward reads instead of recomputing fc1.
pub(super) fn forward(
    state: CubeTensor,
    parameters: ForwardParameters,
    options: ForwardOptions,
) -> (CubeTensor, Option<CubeTensor>) {
    let ForwardParameters { fc1, bias, fc2 } = parameters;
    let ForwardOptions { key, rate, side, save, skip } = options;
    for tensor in [&state, &fc1, &bias, &fc2] {
        assert_eq!(tensor.dtype, DType::F32);
    }
    let state = into_contiguous(state);
    let [_, cells, channels] = state.meta.shape().dims::<3>();
    assert_eq!(channels, CHANNELS);
    assert_eq!(cells % FORWARD_TILE, 0, "the cell tile divides every grid");
    assert_eq!(fc1.meta.shape().dims::<2>(), [HIDDEN, PERCEPTIONS]);
    assert_eq!(fc2.meta.shape().dims::<2>(), [CHANNELS, HIDDEN]);
    let (fc1_transposed, fc2_transposed, bias) = (transposed(fc1), transposed(fc2), into_contiguous(bias));
    let output = empty(&state, [1, cells, CHANNELS]);
    // An unwritten placeholder when the hidden values are not saved.
    let hidden = empty(&state, if save { [1, cells, HIDDEN] } else { [1, 1, 1] });
    fused_step::launch(
        &output.client,
        CubeCount::Static((cells / FORWARD_TILE) as u32, 1, 1),
        CubeDim::new_2d(HIDDEN_QUADS as u32, CELL_QUADS as u32),
        state.into_tensor_arg(),
        fc1_transposed.into_tensor_arg(),
        bias.into_tensor_arg(),
        fc2_transposed.into_tensor_arg(),
        output.clone().into_tensor_arg(),
        hidden.clone().into_tensor_arg(),
        key,
        rate,
        side,
        save,
        skip,
    );
    (output, save.then_some(hidden))
}

impl CellStepBackend for CubeBackend {
    fn cell_step(
        state: CubeTensor,
        fc1: CubeTensor,
        bias: CubeTensor,
        fc2: CubeTensor,
        key: u32,
        rate: f32,
        side: usize,
    ) -> CubeTensor {
        detail("cell step forward", || {
            forward(
                state,
                ForwardParameters { fc1, bias, fc2 },
                ForwardOptions { key, rate, side, save: false, skip: Skip::default() },
            )
            .0
        })
    }
}

/// Forward only: the rollout without a tape and the live grid. A tracked state would lose its
/// gradient here; the chunked backward is `chunk_gradient`.
impl<C: CheckpointStrategy> CellStepBackend for Autodiff<CubeBackend, C> {
    fn cell_step(
        state: FloatTensor<Self>,
        fc1: FloatTensor<Self>,
        bias: FloatTensor<Self>,
        fc2: FloatTensor<Self>,
        key: u32,
        rate: f32,
        side: usize,
    ) -> FloatTensor<Self> {
        assert!(
            !state.is_tracked() && !fc1.is_tracked() && !bias.is_tracked() && !fc2.is_tracked(),
            "the fused cell step has no backward; use it on frozen tensors only"
        );
        Self::from_inner(CubeBackend::cell_step(
            state.into_primitive(),
            fc1.into_primitive(),
            bias.into_primitive(),
            fc2.into_primitive(),
            key,
            rate,
            side,
        ))
    }
}

/// One stochastic step of the cell rule, x + mask · W2 relu(W1 perceive(x) + b), with the
/// firing mask of `key` at `rate` drawn in the kernel (`draws::fire_mask`'s values). Frozen
/// tensors only: `state_1NC` [1, N, C], `fc1_JP` [96, 64], `bias_J` [96], `fc2_CJ` [16, 96].
pub fn step(
    state_1NC: BurnTensor<3>,
    fc1_JP: BurnTensor<2>,
    bias_J: BurnTensor<1>,
    fc2_CJ: BurnTensor<2>,
    key: u32,
    rate: f32,
    side: usize,
) -> BurnTensor<3> {
    BurnTensor::from_dispatch(Dispatch::cell_step(
        state_1NC.into_dispatch(),
        fc1_JP.into_dispatch(),
        bias_J.into_dispatch(),
        fc2_CJ.into_dispatch(),
        key,
        rate,
        side,
    ))
}

/// The gradients of one chunk of steps: the state gradient at the chunk's start and the
/// parameter gradients summed over the chunk's steps, last step first, as the autodiff path
/// accumulates them.
pub struct ChunkGradient {
    pub state_1NC: BurnTensor<3>,
    pub fc1_JP: BurnTensor<2>,
    pub bias_J: BurnTensor<1>,
    pub fc2_CJ: BurnTensor<2>,
}

/// Weight pair of one cellular MLP rule (`fc1` and `fc2`) for `cell_rule_backward_step`.
pub(super) struct RuleWeights<'a> {
    pub fc1: &'a CubeTensor,
    pub fc2: &'a CubeTensor,
}

/// Per-step schedule parameters for `cell_rule_backward_step`.
#[derive(Clone, Copy)]
pub(super) struct BackwardStepConfig {
    pub key: u32,
    pub rate: f32,
    pub chunks: usize,
}

/// Gradients produced by one cellular MLP backward step (`cell_rule_backward_step`).
pub(super) struct RuleStepGradients {
    pub input_gradient: CubeTensor,
    pub fc1: CubeTensor,
    pub bias: CubeTensor,
    pub fc2: CubeTensor,
}

/// Backward pass of one cellular MLP step: masked residual gradient, `dW2`, hidden gradient
/// with ReLU mask, `dW1`, `db`, and input gradient `[1, N, I]`. Preserves Burn's autodiff
/// reduction order bit for bit.
pub(super) fn cell_rule_backward_step(
    upstream: &CubeTensor,
    input: impl FnOnce() -> CubeTensor,
    hidden: CubeTensor,
    weights: RuleWeights<'_>,
    config: BackwardStepConfig,
) -> RuleStepGradients {
    let delta = masked(upstream, config.key, config.rate);
    let fc2 = detail("cell weight gradient", || {
        weight_gradient(&hidden, &delta, config.chunks)
    });
    let hidden_gradient = detail("cell input gradient", || {
        cell_linear::hidden_gradient(delta, weights.fc2.clone(), hidden)
    });
    let input = input();
    let fc1 = detail("cell weight gradient", || {
        weight_gradient(&input, &hidden_gradient, config.chunks)
    });
    let bias = detail("cell bias gradient", || {
        bias_gradient(&hidden_gradient, config.chunks)
    });
    let input_gradient = detail("cell input gradient", || {
        cell_linear::input_gradient(hidden_gradient, weights.fc1.clone())
    });
    RuleStepGradients {
        input_gradient,
        fc1,
        bias,
        fc2,
    }
}

/// Inputs to [`chunk_gradient`] for one cell-rule rollout chunk.
pub struct CellChunkInput<'a> {
    pub start_1NC: BurnTensor<3>,
    pub fc1_JP: BurnTensor<2>,
    pub bias_J: BurnTensor<1>,
    pub fc2_CJ: BurnTensor<2>,
    pub keys: &'a [u32],
    pub rate: f32,
    pub side: usize,
    pub upstream_1NC: BurnTensor<3>,
}

/// The backward of `keys.len()` fused steps from `start_1NC` with the firing masks of `keys`
/// (one per step, in step order), given the gradient `upstream_1NC` of the chunk's last state.
/// The chunk is recomputed forward with its hidden values saved (`keys.len()` × N × 96 floats),
/// then each step runs `cell_rule_backward_step` followed by the perception adjoint with the
/// residual gradient. Every reduction keeps the autodiff path's order, so the result equals it
/// bit for bit. Frozen tensors in, inner gradients out.
pub fn chunk_gradient(input: CellChunkInput<'_>) -> ChunkGradient {
    let CellChunkInput { start_1NC, fc1_JP, bias_J, fc2_CJ, keys, rate, side, upstream_1NC } = input;
    let cells = start_1NC.dims()[1];
    let (fc1, fc2, bias) = (cube(fc1_JP.into_dispatch()), cube(fc2_CJ.into_dispatch()), cube(bias_J.into_dispatch()));
    assert_eq!(cells % CHUNK_CELLS, 0, "the weight-gradient chunk divides every grid");
    let chunks = cells / CHUNK_CELLS;

    // Forward through the chunk, keeping every state and its hidden values.
    let mut states = vec![cube(start_1NC.into_dispatch())];
    let mut hiddens = Vec::with_capacity(keys.len());
    for &key in keys {
        let (next, hidden) = detail("cell step forward", || {
            forward(
                states.last().unwrap().clone(),
                ForwardParameters { fc1: fc1.clone(), bias: bias.clone(), fc2: fc2.clone() },
                ForwardOptions { key, rate, side, save: true, skip: Skip::default() },
            )
        });
        states.push(next);
        hiddens.push(hidden.unwrap());
    }

    let mut gradient = cube(upstream_1NC.into_dispatch());
    let mut totals: Option<[CubeTensor; 3]> = None;
    for (index, &key) in keys.iter().enumerate().rev() {
        let state = states[index].clone();
        let hidden = hiddens[index].clone();
        let step = cell_rule_backward_step(
            &gradient,
            || CubeBackend::perceive(state, side, false),
            hidden,
            RuleWeights { fc1: &fc1, fc2: &fc2 },
            BackwardStepConfig { key, rate, chunks },
        );
        gradient = cell::perceive_adjoint_plus(step.input_gradient, gradient, side);
        totals = Some(match totals {
            // Burn's gradient container adds a new gradient as new + old.
            Some([fc1_total, bias_total, fc2_total]) => [
                CubeBackend::float_add(step.fc1, fc1_total),
                CubeBackend::float_add(step.bias, bias_total),
                CubeBackend::float_add(step.fc2, fc2_total),
            ],
            None => [step.fc1, step.bias, step.fc2],
        });
    }
    let [fc1_total, bias_total, fc2_total] = totals.expect("at least one step");
    ChunkGradient {
        state_1NC: BurnTensor::from_dispatch(dispatch(gradient)),
        fc1_JP: BurnTensor::from_dispatch(dispatch(fc1_total)),
        bias_J: BurnTensor::from_dispatch(dispatch(bias_total)),
        fc2_CJ: BurnTensor::from_dispatch(dispatch(fc2_total)),
    }
}

/// dW = gᵀ x over 256-cell chunks, then over the chunks: the products and reduction of
/// `cell.rs`'s linear backward, on `input` [1, N, I] and `gradient` [1, N, O] → [O, I].
pub(super) fn weight_gradient(input: &CubeTensor, gradient: &CubeTensor, chunks: usize) -> CubeTensor {
    let inputs = input.meta.shape().dims::<3>()[2];
    let outputs = gradient.meta.shape().dims::<3>()[2];
    let left = CubeBackend::float_reshape(gradient.clone(), Shape::new([chunks, 1, CHUNK_CELLS, outputs]));
    let right = CubeBackend::float_reshape(input.clone(), Shape::new([chunks, 1, CHUNK_CELLS, inputs]));
    let partial = batched_product(left, right, true, false, 1.0);
    CubeBackend::float_reshape(CubeBackend::float_sum_dim(partial, 0), Shape::new([outputs, inputs]))
}

/// Native ablation: the time of each kernel with one phase left out, at one shape. Returns
/// (name, milliseconds per launch) rows; the launches run `repeats` times between two syncs.
#[cfg(feature = "harness")]
pub fn ablation(
    state_1NC: BurnTensor<3>,
    fc1_JP: BurnTensor<2>,
    bias_J: BurnTensor<1>,
    fc2_CJ: BurnTensor<2>,
    side: usize,
    repeats: u32,
    sync: &dyn Fn(),
) -> Vec<(String, f64)> {
    let (state, fc1, bias, fc2) = (
        cube(state_1NC.into_dispatch()),
        cube(fc1_JP.into_dispatch()),
        cube(bias_J.into_dispatch()),
        cube(fc2_CJ.into_dispatch()),
    );
    // Every variant is a closure; the rounds interleave them so clock and load drift fall on
    // all of them alike, and each variant reports the median of its rounds.
    let mut variants: Vec<(String, Box<dyn Fn()>)> = Vec::new();
    let forward_variants = [
        ("forward: all phases", Skip::default()),
        ("forward: no perception", Skip { perception: true, ..Skip::default() }),
        ("forward: no fc1", Skip { fc1: true, ..Skip::default() }),
        ("forward: no fc2", Skip { fc2: true, ..Skip::default() }),
        ("forward: fc1 only", Skip { perception: true, fc2: true, ..Skip::default() }),
        ("forward: nothing", Skip { perception: true, fc1: true, fc2: true }),
    ];
    for (name, skip) in forward_variants {
        let (state, fc1, bias, fc2) = (state.clone(), fc1.clone(), bias.clone(), fc2.clone());
        variants.push((name.to_string(), Box::new(move || {
            let _ = forward(
                state.clone(),
                ForwardParameters { fc1: fc1.clone(), bias: bias.clone(), fc2: fc2.clone() },
                ForwardOptions { key: 7, rate: 0.5, side, save: false, skip },
            );
        })));
    }
    // The generic path's kernels for the same step, as the unfused rollout runs them.
    {
        let (state, fc1, bias, fc2) = (state.clone(), fc1.clone(), bias.clone(), fc2.clone());
        variants.push(("unfused: perceive + fc1 + fc2 (band kernels)".to_string(), Box::new(move || {
            let perceived = CubeBackend::perceive(state.clone(), side, false);
            let hidden = CubeBackend::rule_linear(perceived, fc1.clone(), bias.clone(), true);
            let zero = CubeBackend::float_zeros(Shape::new([CHANNELS]), &state.device, burn::tensor::FloatDType::F32);
            let _ = CubeBackend::rule_linear(hidden, fc2.clone(), zero, false);
        })));
    }
    {
        let (state, fc1, bias, fc2) = (state.clone(), fc1.clone(), bias.clone(), fc2.clone());
        variants.push(("unfused: perceive + fc1 + fc2 (generic kernels)".to_string(), Box::new(move || {
            let perceived = CubeBackend::perceive(state.clone(), side, false);
            let hidden = cell::generic_rule_linear(perceived, fc1.clone(), bias.clone(), true);
            let zero = CubeBackend::float_zeros(Shape::new([CHANNELS]), &state.device, burn::tensor::FloatDType::F32);
            let _ = cell::generic_rule_linear(hidden, fc2.clone(), zero, false);
        })));
    }
    let warm = std::time::Instant::now();
    while warm.elapsed().as_millis() < 300 {
        for (_, launch) in &variants {
            launch();
        }
        sync();
    }
    let rounds = 12usize;
    let mut samples: Vec<Vec<f64>> = vec![Vec::new(); variants.len()];
    for _ in 0..rounds {
        for (index, (_, launch)) in variants.iter().enumerate() {
            sync();
            let start = std::time::Instant::now();
            for _ in 0..repeats {
                launch();
            }
            sync();
            samples[index].push(start.elapsed().as_secs_f64() * 1e3 / repeats as f64);
        }
    }
    variants
        .iter()
        .zip(samples)
        .map(|((name, _), mut times)| {
            times.sort_by(|a, b| a.partial_cmp(b).unwrap());
            (name.clone(), times[times.len() / 2])
        })
        .collect()
}
