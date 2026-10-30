//! Small batched FP32 matrix products for attention. B/H are independent batches.
//! Each 64-thread workgroup owns 32×32 outputs and two 16-deep operand tiles.

use burn::backend::wgpu::CubeTensor;
use burn::tensor::Shape;
use burn_cubecl::{kernel::into_contiguous, ops::numeric::empty_device_dtype};
use cubecl::{CubeCount, CubeDim, prelude::*};

const SIDE: usize = 32;
const DEPTH: usize = 16;
const THREAD_SIDE: u32 = 8;
const ITEMS: usize = 4;
const QUADS: usize = SIDE / ITEMS;
const THREADS: usize = THREAD_SIDE as usize * THREAD_SIDE as usize;
/// Reduction indices per inner iteration, as in the linear kernel.
const UNROLL: usize = 4;

/// Four FP32 values: four rows of the left tile, or four columns of the right tile.
type Quad = Vector<f32, Const<4>>;

#[cube(launch)]
fn product(
    lhs: &Tensor<f32>,
    rhs: &Tensor<f32>,
    output: &mut Tensor<f32>,
    #[comptime] rows: usize,
    #[comptime] inner: usize,
    #[comptime] columns: usize,
    #[comptime] transpose_lhs: bool,
    #[comptime] transpose_rhs: bool,
    scale: f32,
) {
    let side = comptime!(SIDE);
    let depth = comptime!(DEPTH);
    let quads = comptime!(QUADS);
    let row_base = CUBE_POS_Y as usize * side;
    let column_base = CUBE_POS_X as usize * side;
    let batch = CUBE_POS_Z as usize;
    let row_quad = UNIT_POS_Y as usize;
    let column_quad = UNIT_POS_X as usize;
    let thread = UNIT_POS as usize;
    let lhs_base = batch * rows * inner;
    let rhs_base = batch * inner * columns;
    // Both tiles are k-major: entry `k * quads + q` holds rows (left) or columns (right)
    // 4q..4q+3 at reduction index k, so a thread reads its four of each with one load.
    let mut left = Shared::<[Quad]>::new_slice(depth * quads);
    let mut right = Shared::<[Quad]>::new_slice(depth * quads);
    // One quad per output row; its lanes are the thread's four columns.
    let mut sums = Array::<Quad>::new(ITEMS);
    #[unroll]
    for row in 0..ITEMS {
        sums[row] = Quad::new(0.0);
    }
    for block in 0..inner.div_ceil(depth) {
        let k_base = block * depth;
        // Each shared entry has one writer. Consecutive threads read consecutive addresses:
        // along k when k is the contiguous axis, along rows or columns when it is not.
        for chunk in 0..(depth * quads / THREADS) {
            let index = thread + chunk * THREADS;
            let mut a = Quad::empty();
            if transpose_lhs {
                // Left operand stored [inner, rows].
                let k = index / quads;
                let quad = index % quads;
                #[unroll]
                for lane in 0..4 {
                    let row = row_base + quad * 4 + lane;
                    let mut value = 0.0;
                    if row < rows && k_base + k < inner {
                        value = lhs[lhs_base + (k_base + k) * rows + row];
                    }
                    a.insert(lane, value);
                }
                left[k * quads + quad] = a;
            } else {
                let k = index % depth;
                let quad = index / depth;
                #[unroll]
                for lane in 0..4 {
                    let row = row_base + quad * 4 + lane;
                    let mut value = 0.0;
                    if row < rows && k_base + k < inner {
                        value = lhs[lhs_base + row * inner + k_base + k];
                    }
                    a.insert(lane, value);
                }
                left[k * quads + quad] = a;
            }
            let mut b = Quad::empty();
            if transpose_rhs {
                // Right operand stored [columns, inner].
                let k = index % depth;
                let quad = index / depth;
                #[unroll]
                for lane in 0..4 {
                    let column = column_base + quad * 4 + lane;
                    let mut value = 0.0;
                    if column < columns && k_base + k < inner {
                        value = rhs[rhs_base + column * inner + k_base + k];
                    }
                    b.insert(lane, value);
                }
                right[k * quads + quad] = b;
            } else {
                let k = index / quads;
                let quad = index % quads;
                #[unroll]
                for lane in 0..4 {
                    let column = column_base + quad * 4 + lane;
                    let mut value = 0.0;
                    if column < columns && k_base + k < inner {
                        value = rhs[rhs_base + (k_base + k) * columns + column];
                    }
                    b.insert(lane, value);
                }
                right[k * quads + quad] = b;
            }
        }
        sync_cube();
        // Order per output: k ascending, one FMA each; the scale is applied once at the end.
        for step in 0..depth / UNROLL {
            #[unroll]
            for offset in 0..UNROLL {
                let k = step * UNROLL + offset;
                let a = left[k * quads + row_quad];
                let b = right[k * quads + column_quad];
                #[unroll]
                for row in 0..ITEMS {
                    sums[row] += Quad::new(a.extract(row)) * b;
                }
            }
        }
        sync_cube();
    }
    #[unroll]
    for row in 0..ITEMS {
        let values = sums[row];
        let m = row_base + row_quad * 4 + row;
        #[unroll]
        for column in 0..ITEMS {
            let n = column_base + column_quad * 4 + column;
            if m < rows && n < columns {
                output[(batch * rows + m) * columns + n] = values.extract(column) * scale;
            }
        }
    }
}

/// Products over the last two axes. No broadcasting between B/H batches.
pub(crate) fn batched_product(
    lhs: CubeTensor,
    rhs: CubeTensor,
    transpose_lhs: bool,
    transpose_rhs: bool,
    scale: f32,
) -> CubeTensor {
    let lhs = into_contiguous(lhs);
    let rhs = into_contiguous(rhs);
    let [batch, heads, a, b] = lhs.meta.shape().dims::<4>();
    let [rhs_batch, rhs_heads, c, d] = rhs.meta.shape().dims::<4>();
    assert_eq!([batch, heads], [rhs_batch, rhs_heads]);
    let (rows, inner) = if transpose_lhs { (b, a) } else { (a, b) };
    let (rhs_inner, columns) = if transpose_rhs { (d, c) } else { (c, d) };
    assert_eq!(inner, rhs_inner);
    let output = empty_device_dtype(
        lhs.client.clone(),
        lhs.device.clone(),
        Shape::new([batch, heads, rows, columns]),
        lhs.dtype,
    );
    product::launch(
        &output.client,
        CubeCount::Static(
            columns.div_ceil(SIDE) as u32,
            rows.div_ceil(SIDE) as u32,
            (batch * heads) as u32,
        ),
        CubeDim::new_2d(THREAD_SIDE, THREAD_SIDE),
        lhs.into_tensor_arg(),
        rhs.into_tensor_arg(),
        output.clone().into_tensor_arg(),
        rows,
        inner,
        columns,
        transpose_lhs,
        transpose_rhs,
        scale,
    );
    output
}
