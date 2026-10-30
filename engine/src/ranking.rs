//! Sorted order and mass intervals on the GPU for the Appearance term.
//!
//! Each row of generated values is sorted, and the measured cells' masses follow their
//! values: the cell at sorted position i occupies the mass interval [A_i, B_i) with
//! B_i = A_i + p_ci. Burn has no GPU sort for WebGPU, so the rows are sorted by a bitonic
//! network of ordinary tensor operations: compare, select and concatenate. Sorting needs no
//! gradient; it runs on detached values, and the caller's loss stays a function of the
//! values with the intervals fixed.
//!
//! The sort key is (value, column). Equal values, including −0 and +0, therefore rank in
//! column order, as a stable sort would rank them. The loss of tied values does not depend
//! on this order; their gradients do, so the order is fixed. The network is fixed for a row
//! length, so the result is deterministic.

use burn::tensor::{IndexingUpdateOp, Int, Tensor};

/// The sorted cells' mass intervals of every row: `order_NP` is the column of each sorted
/// position, `lower_NP` and `upper_NP` the interval of that position's cell. `masses_NP` has
/// the same row layout as the values; its entries are positive and sum to 1 per row.
pub struct MassIntervals {
    pub order_NP: Tensor<2, Int>,
    pub lower_NP: Tensor<2>,
    pub upper_NP: Tensor<2>,
}

/// `values_NP`: N independent rows of P entries, P ≥ 1, finite. `masses_NP`: their cells' masses.
pub fn mass_intervals(values_NP: Tensor<2>, masses_NP: Tensor<2>) -> MassIntervals {
    let [rows, points] = values_NP.dims();
    assert_eq!(masses_NP.dims(), [rows, points]);
    let order_NP = sorted_order(values_NP).slice([0..rows, 0..points]).int();
    let sorted_masses_NP = masses_NP.gather(1, order_NP.clone());
    let upper_NP = sorted_masses_NP.clone().cumsum(1);
    MassIntervals { order_NP, lower_NP: upper_NP.clone() - sorted_masses_NP, upper_NP }
}

/// Values given per sorted position, returned per cell: `cells[n, order[n, i]] = sorted[n, i]`.
pub fn by_cell(order_NP: Tensor<2, Int>, sorted_NP: Tensor<2>) -> Tensor<2> {
    sorted_NP.zeros_like().scatter(1, order_NP, sorted_NP, IndexingUpdateOp::Assign)
}

/// The column that each sorted entry of each row came from, [N, Q] with Q = P rounded up
/// to a power of two. Padding entries hold the largest finite FP32 value and columns P and
/// above, so they sort after every finite value. (WGSL lets a GPU assume that no value is
/// infinite, so the padding is not +∞.)
fn sorted_order(values_NP: Tensor<2>) -> Tensor<2> {
    let [rows, points] = values_NP.dims();
    let device = values_NP.device();
    let width = points.next_power_of_two();
    let mut values_NQ = if width == points {
        values_NP
    } else {
        let padding = Tensor::full([rows, width - points], f32::MAX, &device);
        Tensor::cat(vec![values_NP, padding], 1)
    };
    // Column numbers as FP32 are exact below 2^24.
    let mut order_NQ = Tensor::arange(0..width as i64, &device)
        .float()
        .reshape([1, width])
        .expand([rows, width]);
    // Merge sorted runs of `run` entries into runs of 2 × `run`: one mirrored exchange
    // makes both halves bitonic, then half-cleaners at distances run/2, run/4, …, 1.
    let mut run = 1;
    while run < width {
        (values_NQ, order_NQ) = exchange(values_NQ, order_NQ, run, true);
        let mut distance = run / 2;
        while distance >= 1 {
            (values_NQ, order_NQ) = exchange(values_NQ, order_NQ, distance, false);
            distance /= 2;
        }
        run *= 2;
    }
    order_NQ
}

/// One layer of the network on blocks of 2 × `distance` entries. Entry i of a block is
/// compared with entry i + `distance`, or with entry 2 × `distance` − 1 − i when
/// `mirrored`; the entry with the smaller (value, column) key moves to entry i. The order
/// rows follow their values.
fn exchange(values_NQ: Tensor<2>, order_NQ: Tensor<2>, distance: usize, mirrored: bool) -> (Tensor<2>, Tensor<2>) {
    let [rows, width] = values_NQ.dims();
    let blocks = width / (2 * distance);
    // Axes: N rows, K blocks, 2 halves of a block, J = `distance` entries per half.
    let halves = |tensor_NQ: Tensor<2>| {
        let tensor_NK2J = tensor_NQ.reshape([rows, blocks, 2, distance]);
        let first_NK1J = tensor_NK2J.clone().slice([0..rows, 0..blocks, 0..1, 0..distance]);
        let second_NK1J = tensor_NK2J.slice([0..rows, 0..blocks, 1..2, 0..distance]);
        let second_NK1J = if mirrored { second_NK1J.flip([3]) } else { second_NK1J };
        (first_NK1J, second_NK1J)
    };
    let join = |low_NK1J: Tensor<4>, high_NK1J: Tensor<4>| {
        let high_NK1J = if mirrored { high_NK1J.flip([3]) } else { high_NK1J };
        Tensor::cat(vec![low_NK1J, high_NK1J], 2).reshape([rows, width])
    };
    let (first_values, second_values) = halves(values_NQ);
    let (first_order, second_order) = halves(order_NQ);
    let tied = first_values.clone().equal(second_values.clone());
    let swap = first_values
        .clone()
        .greater(second_values.clone())
        .bool_or(tied.bool_and(first_order.clone().greater(second_order.clone())));
    let low_values = first_values.clone().mask_where(swap.clone(), second_values.clone());
    let high_values = second_values.mask_where(swap.clone(), first_values);
    let low_order = first_order.clone().mask_where(swap.clone(), second_order.clone());
    let high_order = second_order.mask_where(swap, first_order);
    (join(low_values, high_values), join(low_order, high_order))
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::tensor::{Device, TensorData};

    /// The template entry at each value's rank, the rank assignment before format 4: it
    /// exercises the sort and the scatter back to cells.
    fn assign_ranks(values_NP: Tensor<2>, templates_NP: Tensor<2>) -> Tensor<2> {
        let [rows, points] = values_NP.dims();
        let order_NP = sorted_order(values_NP).slice([0..rows, 0..points]).int();
        by_cell(order_NP, templates_NP)
    }

    fn tensor(values: Vec<f32>, rows: usize, device: &Device) -> Tensor<2> {
        let columns = values.len() / rows;
        Tensor::from_data(TensorData::new(values, [rows, columns]), device)
    }

    fn values(tensor: Tensor<2>) -> Vec<f32> {
        tensor.into_data().try_to_vec::<f32>().unwrap()
    }

    #[test]
    fn rank_assignment_equals_sort_then_subtract() {
        // Generated [5, 1, 9] against the ascending [1.5, 5, 8] → [5, 1.5, 8].
        let device = Device::default();
        let assigned = assign_ranks(tensor(vec![5.0, 1.0, 9.0], 1, &device), tensor(vec![1.5, 5.0, 8.0], 1, &device));
        assert_eq!(values(assigned), [5.0, 1.5, 8.0]);
    }

    /// Ranks of a stable ascending sort, the policy of `assign_ranks`: equal values in column order.
    fn stable_ranks(row: &[f32]) -> Vec<f32> {
        let mut order: Vec<usize> = (0..row.len()).collect();
        order.sort_by(|&a, &b| row[a].partial_cmp(&row[b]).unwrap());
        let mut ranks = vec![0.0; row.len()];
        for (rank, &point) in order.iter().enumerate() {
            ranks[point] = rank as f32;
        }
        ranks
    }

    #[test]
    fn mass_intervals_follow_the_sorted_cells() {
        // Values [5, 1, 9] with masses [0.5, 0.2, 0.3]: sorted cells 1, 0, 2 → intervals
        // [0, 0.2), [0.2, 0.7), [0.7, 1).
        let device = Device::default();
        let intervals = mass_intervals(tensor(vec![5.0, 1.0, 9.0], 1, &device), tensor(vec![0.5, 0.2, 0.3], 1, &device));
        assert_eq!(intervals.order_NP.into_data().try_to_vec::<i32>().unwrap(), [1, 0, 2]);
        let close = |actual: Vec<f32>, expected: [f32; 3]| actual.iter().zip(expected).all(|(a, b)| (a - b).abs() < 1e-6);
        assert!(close(values(intervals.lower_NP), [0.0, 0.2, 0.7]));
        assert!(close(values(intervals.upper_NP), [0.2, 0.7, 1.0]));
    }

    #[test]
    fn ties_rank_in_column_order() {
        // Equal values keep their columns' order: x = [1, 1, 0, 0] against [0, 1, 2, 3] → [2, 3, 0, 1].
        let device = Device::default();
        let ranks = |row: Vec<f32>| {
            let columns = row.len();
            let template = (0..columns).map(|rank| rank as f32).collect();
            values(assign_ranks(tensor(row, 1, &device), tensor(template, 1, &device)))
        };
        assert_eq!(ranks(vec![1.0, 1.0, 0.0, 0.0]), [2.0, 3.0, 0.0, 1.0]);
        // A row length that needs padding, with duplicates, signed zeros and the largest finite value.
        let row = vec![f32::MAX, 0.5, -0.0, f32::MAX, 0.0, 0.5, -1.0];
        assert_eq!(ranks(row.clone()), stable_ranks(&row));
    }

    #[test]
    fn every_row_length_up_to_a_full_grid_matches_a_cpu_sort() {
        let device = Device::default();
        let mut state = 0x2545_f491_u32;
        let mut random = || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as f32 / u32::MAX as f32 - 0.5
        };
        for points in [1, 2, 3, 9, 12, 16, 100, 255, 256] {
            let rows = 3;
            let generated: Vec<f32> = (0..rows * points).map(|_| random()).collect();
            let template: Vec<f32> = (0..rows * points).map(|index| (index % points) as f32).collect();
            let assigned = values(assign_ranks(tensor(generated.clone(), rows, &device), tensor(template, rows, &device)));
            for row in 0..rows {
                let expected = stable_ranks(&generated[row * points..(row + 1) * points]);
                assert_eq!(assigned[row * points..(row + 1) * points], expected, "P = {points}, row {row}");
            }
        }
    }
}
