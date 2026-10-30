//! The cell rule's projections at their own shapes: N = 16,384 cells per grid, 64 or 80 inputs,
//! 96 hidden values, 16 channels. The generic tiled kernel (`linear.rs`, 64 × 32 tiles, three
//! column tiles for 96 outputs) reads each input tile three times, writes the output through
//! a separate bias and ReLU pass, and reaches about 1.5 TFLOPS on fc1 and 0.8 on fc2 at batch
//! 4. These kernels give one workgroup a
//! band of 128 cells and the full output width, so an input is read once, the weights once
//! per band, and the bias and ReLU join the epilogue.
//!
//! Every statement repeats the generic path's arithmetic in its order, so the results are
//! bit-identical: one accumulator per output, the reduction index ascending, one fused
//! multiply-add per term; the bias added to the rounded sum, then ReLU as `cell.rs::activation`.
//! `examples/cell_step_check.rs` checks both kernels against the generic path bit for bit.
//!
//! fc1 (`band_fc1`): thread (hidden group, cell quad) owns 4 cells × 12 hidden values, 48
//! multiply-adds per four shared loads (one quad of cells, three quads of hidden values), from
//! 16-deep slabs of the inputs and the weights in shared memory (14 KiB).
//! fc2 (`band_fc2`): thread (channel quad, cell pair) owns 2 cells × 4 channels from a slab
//! of the hidden values and a slab of the weights (9 KiB).
use super::cell::{CHANNELS, HIDDEN};
use burn::backend::wgpu::CubeTensor;
use burn::tensor::{DType, Shape};
use burn_cubecl::{kernel::into_contiguous, ops::numeric::empty_device_dtype};
use cubecl::{CubeCount, CubeDim, prelude::*};

/// Cells per workgroup.
const BAND: usize = 128;
const BAND_QUADS: usize = BAND / 4;
const BAND_PAIRS: usize = BAND / 2;
/// Reduction indices per shared slab.
const SLAB: usize = 16;
/// Reduction indices per inner iteration, as in the linear kernel.
const UNROLL: usize = 4;
const HIDDEN_QUADS: usize = HIDDEN / 4;
/// fc1: hidden values per thread, as three quads; groups of them across the width.
const FC1_GROUP: usize = 12;
const FC1_GROUPS: usize = HIDDEN / FC1_GROUP;
const FC1_THREADS: usize = FC1_GROUPS * BAND_QUADS;
/// fc2: channel quads; threads own one quad of channels for two cells.
const CHANNEL_QUADS: usize = CHANNELS / 4;
const FC2_THREADS: usize = CHANNEL_QUADS * BAND_PAIRS;
/// fc2's hidden slab is cell-major with a padded row, against bank conflicts.
const FC2_SLAB_STRIDE: usize = SLAB + 1;

/// Four cells, four hidden values or four channels at one reduction index.
type Quad = Vector<f32, Const<4>>;
/// Cells per thread: a quad.
const QUAD_ROWS: usize = 4;

/// y = relu(W x + b) for a band of cells: `input` [1, N, inputs], `weight` [96, inputs] row-major,
/// `bias` [96], `output` [1, N, 96].
#[cube(launch)]
fn band_fc1(
    input: &Tensor<f32>,
    weight: &Tensor<f32>,
    bias: &Tensor<f32>,
    output: &mut Tensor<f32>,
    #[comptime] inputs: usize,
    #[comptime] relu: bool,
) {
    let group = UNIT_POS_X as usize;
    let cell_quad = UNIT_POS_Y as usize;
    let thread = UNIT_POS as usize;
    let first_cell = CUBE_POS as usize * BAND;
    // k-major slabs: entry k · quads + quad holds four cells, or four hidden values, at index k.
    let mut input_tile = Shared::<[Quad]>::new_slice(SLAB * BAND_QUADS);
    let mut weight_tile = Shared::<[Quad]>::new_slice(SLAB * HIDDEN_QUADS);
    let mut accumulators = Array::<Quad>::new(FC1_GROUP);
    #[unroll]
    for i in 0..FC1_GROUP {
        accumulators[i] = Quad::new(0.0);
    }
    for slab in 0..inputs / SLAB {
        let k_base = slab * SLAB;
        // Each shared entry has one writer; consecutive threads read consecutive indices of a cell.
        for chunk in 0..(SLAB * BAND_QUADS / FC1_THREADS) {
            let index = thread + chunk * FC1_THREADS;
            let k = index % SLAB;
            let quad = index / SLAB;
            let mut values = Quad::empty();
            #[unroll]
            for lane in 0..4 {
                values.insert(lane, input[(first_cell + quad * 4 + lane) * inputs + k_base + k]);
            }
            input_tile[k * BAND_QUADS + quad] = values;
        }
        for chunk in 0..(SLAB * HIDDEN_QUADS).div_ceil(FC1_THREADS) {
            let index = thread + chunk * FC1_THREADS;
            if index < SLAB * HIDDEN_QUADS {
                let k = index % SLAB;
                let quad = index / SLAB;
                let mut values = Quad::empty();
                #[unroll]
                for lane in 0..4 {
                    values.insert(lane, weight[(quad * 4 + lane) * inputs + k_base + k]);
                }
                weight_tile[k * HIDDEN_QUADS + quad] = values;
            }
        }
        sync_cube();
        for step in 0..SLAB / UNROLL {
            #[unroll]
            for offset in 0..UNROLL {
                let k = step * UNROLL + offset;
                let input_values = input_tile[k * BAND_QUADS + cell_quad];
                #[unroll]
                for part in 0..3 {
                    let weight_values = weight_tile[k * HIDDEN_QUADS + group * 3 + part];
                    #[unroll]
                    for row in 0..4 {
                        accumulators[row * 3 + part] += Quad::new(input_values.extract(row)) * weight_values;
                    }
                }
            }
        }
        // No thread may overwrite a slab until every thread has finished reading it.
        sync_cube();
    }
    #[unroll]
    for row in 0..4 {
        let cell = first_cell + cell_quad * 4 + row;
        #[unroll]
        for part in 0..3 {
            let values = accumulators[row * 3 + part];
            #[unroll]
            for lane in 0..4 {
                let column = (group * 3 + part) * 4 + lane;
                let value = values.extract(lane) + bias[column];
                output[cell * HIDDEN + column] = if relu && value < 0.0f32 { 0.0f32 } else { value };
            }
        }
    }
}

/// y = W x + b for a band of cells: `input` [1, N, 96], `weight` [16, 96] row-major, `bias` [16],
/// `output` [1, N, 16].
#[cube(launch)]
fn band_fc2(
    input: &Tensor<f32>,
    weight: &Tensor<f32>,
    bias: &Tensor<f32>,
    output: &mut Tensor<f32>,
    #[comptime] relu: bool,
) {
    let channel_quad = UNIT_POS_X as usize;
    let cell_pair = UNIT_POS_Y as usize;
    let thread = UNIT_POS as usize;
    let first_cell = CUBE_POS as usize * BAND;
    // The hidden values of the band at the slab's indices, cell-major with a padded row.
    let mut input_tile = Shared::<[f32]>::new_slice(BAND * FC2_SLAB_STRIDE);
    // k-major: entry k · CHANNEL_QUADS + quad holds four channels' weights at index k.
    let mut weight_tile = Shared::<[Quad]>::new_slice(SLAB * CHANNEL_QUADS);
    let mut first = Quad::new(0.0);
    let mut second = Quad::new(0.0);
    for slab in 0..HIDDEN / SLAB {
        let k_base = slab * SLAB;
        // Consecutive threads read consecutive indices of a cell: one 64-byte row piece.
        for chunk in 0..(BAND * SLAB / FC2_THREADS) {
            let index = thread + chunk * FC2_THREADS;
            let k = index % SLAB;
            let cell = index / SLAB;
            input_tile[cell * FC2_SLAB_STRIDE + k] = input[(first_cell + cell) * HIDDEN + k_base + k];
        }
        if thread < SLAB * CHANNEL_QUADS {
            let k = thread / CHANNEL_QUADS;
            let quad = thread % CHANNEL_QUADS;
            let mut values = Quad::empty();
            #[unroll]
            for lane in 0..4 {
                values.insert(lane, weight[(quad * 4 + lane) * HIDDEN + k_base + k]);
            }
            weight_tile[k * CHANNEL_QUADS + quad] = values;
        }
        sync_cube();
        for step in 0..SLAB / UNROLL {
            #[unroll]
            for offset in 0..UNROLL {
                let k = step * UNROLL + offset;
                let weight_values = weight_tile[k * CHANNEL_QUADS + channel_quad];
                first += Quad::new(input_tile[(cell_pair * 2) * FC2_SLAB_STRIDE + k]) * weight_values;
                second += Quad::new(input_tile[(cell_pair * 2 + 1) * FC2_SLAB_STRIDE + k]) * weight_values;
            }
        }
        sync_cube();
    }
    #[unroll]
    for lane in 0..4 {
        let column = channel_quad * 4 + lane;
        let value = first.extract(lane) + bias[column];
        output[(first_cell + cell_pair * 2) * CHANNELS + column] = if relu && value < 0.0f32 { 0.0f32 } else { value };
        let value = second.extract(lane) + bias[column];
        output[(first_cell + cell_pair * 2 + 1) * CHANNELS + column] = if relu && value < 0.0f32 { 0.0f32 } else { value };
    }
}

/// g_h = [a > 0] · (g_d W2) for a band of cells: fc2's input gradient with the ReLU mask of
/// `cell.rs::activation`'s backward. `delta` [1, N, 16] (the masked upstream), `weight` [16, 96]
/// row-major, `hidden` [1, N, 96] (the saved ReLU output), `output` [1, N, 96]. Thread (hidden
/// group, cell quad) owns 4 cells × 12 hidden values over the 16 channels, channel ascending.
#[cube(launch)]
fn band_hidden_gradient(delta: &Tensor<f32>, weight: &Tensor<f32>, hidden: &Tensor<f32>, output: &mut Tensor<f32>) {
    let group = UNIT_POS_X as usize;
    let cell_quad = UNIT_POS_Y as usize;
    let thread = UNIT_POS as usize;
    let first_cell = CUBE_POS as usize * BAND;
    // k-major: entry o · quads + quad holds four cells' deltas, or four hidden columns of W2, at channel o.
    let mut delta_tile = Shared::<[Quad]>::new_slice(CHANNELS * BAND_QUADS);
    let mut weight_tile = Shared::<[Quad]>::new_slice(CHANNELS * HIDDEN_QUADS);
    for chunk in 0..(CHANNELS * BAND_QUADS / FC1_THREADS) {
        let index = thread + chunk * FC1_THREADS;
        let o = index % CHANNELS;
        let quad = index / CHANNELS;
        let mut values = Quad::empty();
        #[unroll]
        for lane in 0..4 {
            values.insert(lane, delta[(first_cell + quad * 4 + lane) * CHANNELS + o]);
        }
        delta_tile[o * BAND_QUADS + quad] = values;
    }
    for chunk in 0..(CHANNELS * HIDDEN_QUADS).div_ceil(FC1_THREADS) {
        let index = thread + chunk * FC1_THREADS;
        if index < CHANNELS * HIDDEN_QUADS {
            let o = index / HIDDEN_QUADS;
            let quad = index % HIDDEN_QUADS;
            let mut values = Quad::empty();
            #[unroll]
            for lane in 0..4 {
                values.insert(lane, weight[o * HIDDEN + quad * 4 + lane]);
            }
            weight_tile[o * HIDDEN_QUADS + quad] = values;
        }
    }
    sync_cube();
    let mut accumulators = Array::<Quad>::new(FC1_GROUP);
    #[unroll]
    for i in 0..FC1_GROUP {
        accumulators[i] = Quad::new(0.0);
    }
    for step in 0..CHANNELS / UNROLL {
        #[unroll]
        for offset in 0..UNROLL {
            let o = step * UNROLL + offset;
            let delta_values = delta_tile[o * BAND_QUADS + cell_quad];
            #[unroll]
            for part in 0..3 {
                let weight_values = weight_tile[o * HIDDEN_QUADS + group * 3 + part];
                #[unroll]
                for row in 0..4 {
                    accumulators[row * 3 + part] += Quad::new(delta_values.extract(row)) * weight_values;
                }
            }
        }
    }
    #[unroll]
    for row in 0..4 {
        let cell = first_cell + cell_quad * 4 + row;
        #[unroll]
        for part in 0..3 {
            let values = accumulators[row * 3 + part];
            #[unroll]
            for lane in 0..4 {
                let column = (group * 3 + part) * 4 + lane;
                let position = cell * HIDDEN + column;
                output[position] = if hidden[position] <= 0.0f32 { 0.0f32 } else { values.extract(lane) };
            }
        }
    }
}

/// g_p = g_h W1 for a band of cells: fc1's input gradient. `gradient` [1, N, 96], `weight`
/// [96, inputs] row-major, `output` [1, N, inputs]. Thread (input group, cell quad) owns
/// 4 cells × 8 inputs over the 96 hidden values, hidden index ascending, from 16-deep slabs.
#[cube(launch)]
fn band_input_gradient(gradient: &Tensor<f32>, weight: &Tensor<f32>, output: &mut Tensor<f32>, #[comptime] inputs: usize) {
    let group = UNIT_POS_X as usize;
    let cell_quad = UNIT_POS_Y as usize;
    let thread = UNIT_POS as usize;
    let first_cell = CUBE_POS as usize * BAND;
    let input_quads = inputs / 4;
    let groups = input_quads / 2;
    let threads = groups * BAND_QUADS;
    // k-major: entry j · quads + quad holds four cells' gradients, or four inputs of W1's row j.
    let mut gradient_tile = Shared::<[Quad]>::new_slice(SLAB * BAND_QUADS);
    let mut weight_tile = Shared::<[Quad]>::new_slice(SLAB * input_quads);
    let mut first = Array::<Quad>::new(QUAD_ROWS);
    let mut second = Array::<Quad>::new(QUAD_ROWS);
    #[unroll]
    for row in 0..4 {
        first[row] = Quad::new(0.0);
        second[row] = Quad::new(0.0);
    }
    for slab in 0..HIDDEN / SLAB {
        let j_base = slab * SLAB;
        for chunk in 0..(SLAB * BAND_QUADS).div_ceil(threads) {
            let index = thread + chunk * threads;
            if index < SLAB * BAND_QUADS {
                let j = index % SLAB;
                let quad = index / SLAB;
                let mut values = Quad::empty();
                #[unroll]
                for lane in 0..4 {
                    values.insert(lane, gradient[(first_cell + quad * 4 + lane) * HIDDEN + j_base + j]);
                }
                gradient_tile[j * BAND_QUADS + quad] = values;
            }
        }
        for chunk in 0..(SLAB * input_quads).div_ceil(threads) {
            let index = thread + chunk * threads;
            if index < SLAB * input_quads {
                let j = index / input_quads;
                let quad = index % input_quads;
                let mut values = Quad::empty();
                #[unroll]
                for lane in 0..4 {
                    values.insert(lane, weight[(j_base + j) * inputs + quad * 4 + lane]);
                }
                weight_tile[j * input_quads + quad] = values;
            }
        }
        sync_cube();
        for step in 0..SLAB / UNROLL {
            #[unroll]
            for offset in 0..UNROLL {
                let j = step * UNROLL + offset;
                let gradient_values = gradient_tile[j * BAND_QUADS + cell_quad];
                let first_weights = weight_tile[j * input_quads + group * 2];
                let second_weights = weight_tile[j * input_quads + group * 2 + 1];
                #[unroll]
                for row in 0..4 {
                    let value = Quad::new(gradient_values.extract(row));
                    first[row] += value * first_weights;
                    second[row] += value * second_weights;
                }
            }
        }
        sync_cube();
    }
    #[unroll]
    for row in 0..4 {
        let cell = first_cell + cell_quad * 4 + row;
        #[unroll]
        for lane in 0..4 {
            output[cell * inputs + (group * 2) * 4 + lane] = first[row].extract(lane);
            output[cell * inputs + (group * 2 + 1) * 4 + lane] = second[row].extract(lane);
        }
    }
}

/// fc2's input gradient with fc1's ReLU mask, `delta` [1, N, 16], `weight` [16, 96], `hidden` [1, N, 96] → [1, N, 96].
pub(super) fn hidden_gradient(delta: CubeTensor, weight: CubeTensor, hidden: CubeTensor) -> CubeTensor {
    let (delta, weight, hidden) = (into_contiguous(delta), into_contiguous(weight), into_contiguous(hidden));
    let [_, cells, channels] = delta.meta.shape().dims::<3>();
    assert_eq!(channels, CHANNELS);
    assert_eq!(weight.meta.shape().dims::<2>(), [CHANNELS, HIDDEN]);
    assert_eq!(hidden.meta.shape().dims::<3>(), [1, cells, HIDDEN]);
    assert_eq!(cells % BAND, 0);
    let output = empty_device_dtype(delta.client.clone(), delta.device.clone(), Shape::new([1, cells, HIDDEN]), DType::F32);
    band_hidden_gradient::launch(
        &output.client,
        CubeCount::Static((cells / BAND) as u32, 1, 1),
        CubeDim::new_2d(FC1_GROUPS as u32, BAND_QUADS as u32),
        delta.into_tensor_arg(),
        weight.into_tensor_arg(),
        hidden.into_tensor_arg(),
        output.clone().into_tensor_arg(),
    );
    output
}

/// fc1's input gradient, `gradient` [1, N, 96], `weight` [96, inputs] → [1, N, inputs]; `inputs` is 64 or 80.
pub(super) fn input_gradient(gradient: CubeTensor, weight: CubeTensor) -> CubeTensor {
    let (gradient, weight) = (into_contiguous(gradient), into_contiguous(weight));
    let [_, cells, hidden] = gradient.meta.shape().dims::<3>();
    let [weight_hidden, inputs] = weight.meta.shape().dims::<2>();
    assert_eq!((hidden, weight_hidden), (HIDDEN, HIDDEN));
    assert!(inputs % 8 == 0 && inputs <= 128 && cells % BAND == 0);
    let groups = inputs / 8;
    let output = empty_device_dtype(gradient.client.clone(), gradient.device.clone(), Shape::new([1, cells, inputs]), DType::F32);
    band_input_gradient::launch(
        &output.client,
        CubeCount::Static((cells / BAND) as u32, 1, 1),
        CubeDim::new_2d(groups as u32, BAND_QUADS as u32),
        gradient.into_tensor_arg(),
        weight.into_tensor_arg(),
        output.clone().into_tensor_arg(),
        inputs,
    );
    output
}

/// Whether the band kernels serve this projection: a band of cells per workgroup, the rule's widths.
pub(super) fn serves(cells: usize, inputs: usize, outputs: usize) -> bool {
    cells % BAND == 0 && ((outputs == HIDDEN && inputs % SLAB == 0 && inputs <= 128) || (outputs == CHANNELS && inputs == HIDDEN))
}

/// `activation(frozen_linear(input, weight), bias, relu)` of `cell.rs` for the rule's shapes,
/// in one dispatch. `input` [1, N, inputs], `weight` [outputs, inputs], `bias` [outputs].
pub(super) fn projection(input: CubeTensor, weight: CubeTensor, bias: CubeTensor, relu: bool) -> CubeTensor {
    for tensor in [&input, &weight, &bias] {
        assert_eq!(tensor.dtype, DType::F32);
    }
    let (input, weight, bias) = (into_contiguous(input), into_contiguous(weight), into_contiguous(bias));
    let [_, cells, inputs] = input.meta.shape().dims::<3>();
    let [outputs, weight_inputs] = weight.meta.shape().dims::<2>();
    assert_eq!(inputs, weight_inputs);
    assert!(serves(cells, inputs, outputs), "the band kernels serve the rule's shapes only");
    let output = empty_device_dtype(input.client.clone(), input.device.clone(), Shape::new([1, cells, outputs]), DType::F32);
    let bands = CubeCount::Static((cells / BAND) as u32, 1, 1);
    if outputs == HIDDEN {
        band_fc1::launch(
            &output.client,
            bands,
            CubeDim::new_2d(FC1_GROUPS as u32, BAND_QUADS as u32),
            input.into_tensor_arg(),
            weight.into_tensor_arg(),
            bias.into_tensor_arg(),
            output.clone().into_tensor_arg(),
            inputs,
            relu,
        );
    } else {
        band_fc2::launch(
            &output.client,
            bands,
            CubeDim::new_2d(CHANNEL_QUADS as u32, BAND_PAIRS as u32),
            input.into_tensor_arg(),
            weight.into_tensor_arg(),
            bias.into_tensor_arg(),
            output.clone().into_tensor_arg(),
            relu,
        );
    }
    output
}
