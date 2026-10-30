//! FP32 tiled projection with a 32-wide reduction tile. Reader tiles are 64×64.
//! Narrow cell tiles avoid idle output columns and use at most 16 KiB shared memory.

use super::{
    FrozenLinearBackend,
    cell::{CHANNELS, HIDDEN},
};
use burn::{
    backend::{
        tensor::FloatTensor,
        wgpu::{CubeBackend, CubeTensor},
    },
    tensor::{DType, Shape},
};
use burn_cubecl::kernel::into_contiguous;
use cubecl::{CubeCount, CubeDim, prelude::*};

const TILE_DEPTH: usize = 32;
const THREAD_SIDE: u32 = 16;
const THREAD_TILE: usize = 4;
/// Reduction indices per inner iteration. On an M1 Max, 4 is faster than 8, 16 or 32 in the native benchmark.
const UNROLL: usize = 4;
const TILE_SIDE: usize = THREAD_SIDE as usize * THREAD_TILE;

/// Four FP32 values: four rows of the input tile, or four columns of the weight tile.
type Quad = Vector<f32, Const<4>>;

#[cube(launch)]
fn tiled_linear(
    input: &Tensor<f32>,
    weight: &Tensor<f32>,
    output: &mut Tensor<f32>,
    #[comptime] rows: usize,
    #[comptime] inner: usize,
    #[comptime] columns: usize,
    #[comptime] transpose: bool,
    #[comptime] row_tile: usize,
    #[comptime] column_tile: usize,
    #[comptime] depth: usize,
) {
    let row_quads = comptime!(row_tile / 4);
    let column_quads = comptime!(column_tile / 4);
    let thread_count = comptime!(row_quads * column_quads);
    let row_base = CUBE_POS_Y as usize * row_tile;
    let column_base = CUBE_POS_X as usize * column_tile;
    let row_quad = UNIT_POS_Y as usize;
    let column_quad = UNIT_POS_X as usize;
    let thread = UNIT_POS as usize;
    // Both tiles are k-major. Each entry holds four rows or columns at one
    // reduction index; the row and column tiles can have different widths.
    let mut input_tile = Shared::<[Quad]>::new_slice(depth * row_quads);
    let mut weight_tile = Shared::<[Quad]>::new_slice(depth * column_quads);
    // One quad per output row; its lanes are the thread's four columns.
    let mut accumulators = Array::<Quad>::new(THREAD_TILE);
    #[unroll]
    for row in 0..THREAD_TILE {
        accumulators[row] = Quad::new(0.0);
    }

    for block in 0..inner.div_ceil(depth) {
        let inner_base = block * depth;
        // Each shared entry has one writer. Consecutive threads read consecutive reduction
        // indices of a row, the contiguous direction of X and of the forward weight.
        for chunk in 0..(depth * row_quads / thread_count) {
            let index = thread + chunk * thread_count;
            let k = index % depth;
            let quad = index / depth;
            let mut input_values = Quad::empty();
            #[unroll]
            for lane in 0..4 {
                let row = row_base + quad * 4 + lane;
                let mut value = 0.0;
                if row < rows && inner_base + k < inner {
                    value = input[row * inner + inner_base + k];
                }
                input_values.insert(lane, value);
            }
            input_tile[k * row_quads + quad] = input_values;
        }
        for chunk in 0..(depth * column_quads / thread_count) {
            let index = thread + chunk * thread_count;
            let k = index % depth;
            let quad = index / depth;
            let mut weight_values = Quad::empty();
            if !transpose {
                #[unroll]
                for lane in 0..4 {
                    let column = column_base + quad * 4 + lane;
                    let mut value = 0.0;
                    if column < columns && inner_base + k < inner {
                        value = weight[column * inner + inner_base + k];
                    }
                    weight_values.insert(lane, value);
                }
                weight_tile[k * column_quads + quad] = weight_values;
            } else {
                // dY W: the weight's columns are contiguous; read four of them per entry.
                let k = index / column_quads;
                let quad = index % column_quads;
                #[unroll]
                for lane in 0..4 {
                    let column = column_base + quad * 4 + lane;
                    let mut value = 0.0;
                    if inner_base + k < inner && column < columns {
                        value = weight[(inner_base + k) * columns + column];
                    }
                    weight_values.insert(lane, value);
                }
                weight_tile[k * column_quads + quad] = weight_values;
            }
        }
        sync_cube();

        // UNROLL reduction indices per iteration, so the loads of the next index can be
        // issued before the FMAs of this one. Order per output: k ascending, one FMA each.
        for step in 0..depth / UNROLL {
            #[unroll]
            for offset in 0..UNROLL {
                let k = step * UNROLL + offset;
                let input_values = input_tile[k * row_quads + row_quad];
                let weight_values = weight_tile[k * column_quads + column_quad];
                #[unroll]
                for row in 0..THREAD_TILE {
                    accumulators[row] += Quad::new(input_values.extract(row)) * weight_values;
                }
            }
        }
        // No thread can overwrite a tile until every thread finishes reading it.
        // Tail threads also reach both barriers; there is no early return.
        sync_cube();
    }

    #[unroll]
    for row in 0..THREAD_TILE {
        let values = accumulators[row];
        let output_row = row_base + row_quad * 4 + row;
        #[unroll]
        for column in 0..THREAD_TILE {
            let output_column = column_base + column_quad * 4 + column;
            if output_row < rows && output_column < columns {
                output[output_row * columns + output_column] = values.extract(column);
            }
        }
    }
}

impl FrozenLinearBackend for CubeBackend {
    fn frozen_linear(
        input: FloatTensor<Self>,
        weight: FloatTensor<Self>,
        transpose: bool,
    ) -> FloatTensor<Self> {
        assert_eq!(input.dtype, DType::F32);
        assert_eq!(weight.dtype, DType::F32);
        let input = into_contiguous(input);
        let weight = into_contiguous(weight);
        let [batch, tokens, inner] = input.meta.shape().dims::<3>();
        let [weight_rows, weight_columns] = weight.meta.shape().dims::<2>();
        let columns = if transpose {
            assert_eq!(inner, weight_rows);
            weight_columns
        } else {
            assert_eq!(inner, weight_columns);
            weight_rows
        };
        let rows = batch * tokens;
        let tile = TILE_SIDE;
        // The rule has 16 or 96 output channels. Narrow column tiles avoid idle
        // lanes in its forward and hidden-gradient products; the reader stays 64×64.
        let column_tile = if inner <= HIDDEN && columns <= HIDDEN {
            if columns == CHANNELS {
                16
            } else if columns == HIDDEN {
                32
            } else {
                tile
            }
        } else {
            tile
        };
        let thread_rows = (tile / THREAD_TILE) as u32;
        let thread_columns = (column_tile / THREAD_TILE) as u32;
        let depth = TILE_DEPTH;
        let shape = Shape::new([batch, tokens, columns]);
        let output = CubeTensor::new_contiguous(
            input.client.clone(),
            input.device.clone(),
            shape,
            input.client.empty(rows * columns * size_of::<f32>()),
            DType::F32,
        );
        tiled_linear::launch(
            &output.client,
            CubeCount::Static(
                columns.div_ceil(column_tile) as u32,
                rows.div_ceil(tile) as u32,
                1,
            ),
            CubeDim::new_2d(thread_columns, thread_rows),
            input.into_tensor_arg(),
            weight.into_tensor_arg(),
            output.clone().into_tensor_arg(),
            rows,
            inner,
            columns,
            transpose,
            tile,
            column_tile,
            depth,
        );
        output
    }
}
