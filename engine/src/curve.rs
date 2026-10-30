//! Reference curves of the Appearance term.
//!
//! One reference window gives, per appearance layer and channel, M sorted values
//! y_0 ≤ … ≤ y_{M−1}. Its curve on the mass coordinate q ∈ [0, 1] is the midpoint rule as a
//! continuous function: with u = clamp(q M − ½, 0, M − 1) and k = ⌊u⌋,
//! Q(q) = y_k + (u − k)(y_{k+1} − y_k). Q is linear on M + 1 segments whose knots are
//! (k + ½) / M. The term's curve Q̄ is the equal-weight mean of its J references' curves.
//!
//! An update needs, for every reference, F(q) = ∫₀^q Q at the generated cells' cumulative
//! masses: `CurveTable` holds each segment's start value, slope and F at its start, and
//! `prefix_integral` evaluates F on the GPU with the segment found arithmetically. The
//! reported loss also needs ∫₀¹ Q̄² once per layer and channel: `squared_integral` sums it
//! on the CPU over the union of the references' knots, where every Q_j is linear.
//!
//! Axes: L appearance layers, D = 768 channels, M window tokens, K = M + 1 segments,
//! N rows (layer, view, channel), P measured cells.

use crate::appearance::LAYERS;
use crate::encoder::{PATCHES, WIDTH};
use burn::tensor::{Device, Int, Tensor, TensorData};

/// Sorted channel values of one reference window: per layer, [M, D] ascending along M.
pub struct SortedWindow {
    pub tokens: usize,
    /// [L, M, D]
    pub values_LMD: Vec<f32>,
}

impl SortedWindow {
    /// `readout_LTD` is the reference's full appearance readout; `window` its source cells.
    pub fn new(readout_LTD: &[f32], window: &[usize]) -> Self {
        assert!(!window.is_empty(), "a reference needs a non-empty source window");
        let tokens = window.len();
        let mut values_LMD = vec![0.0; LAYERS * tokens * WIDTH];
        let mut column = Vec::with_capacity(tokens);
        for layer in 0..LAYERS {
            let readout_TD = &readout_LTD[layer * PATCHES * WIDTH..(layer + 1) * PATCHES * WIDTH];
            for channel in 0..WIDTH {
                column.clear();
                column.extend(window.iter().map(|&position| readout_TD[position * WIDTH + channel]));
                column.sort_unstable_by(f32::total_cmp);
                for (rank, &value) in column.iter().enumerate() {
                    values_LMD[(layer * tokens + rank) * WIDTH + channel] = value;
                }
            }
        }
        Self { tokens, values_LMD }
    }

    fn layer(&self, layer: usize) -> &[f32] {
        &self.values_LMD[layer * self.tokens * WIDTH..(layer + 1) * self.tokens * WIDTH]
    }

    /// Q(q) for every channel of one layer, in f64.
    fn evaluate(&self, layer: usize, q: f64, out_D: &mut [f64]) {
        let tokens = self.tokens;
        let values_MD = self.layer(layer);
        let u = (q * tokens as f64 - 0.5).clamp(0.0, (tokens - 1) as f64);
        let low = u.floor() as usize;
        let high = (low + 1).min(tokens - 1);
        let weight = u - low as f64;
        for channel in 0..WIDTH {
            let (start, end) = (values_MD[low * WIDTH + channel] as f64, values_MD[high * WIDTH + channel] as f64);
            out_D[channel] = start + weight * (end - start);
        }
    }
}

/// The start of segment k of a curve with M tokens: 0, then the knots (k − ½) / M.
fn segment_start(k: usize, tokens: usize) -> f64 {
    if k == 0 { 0.0 } else { (k as f64 - 0.5) / tokens as f64 }
}

/// One reference's curve as the GPU evaluates it: per layer and channel, the M + 1 segments'
/// value at their start, slope, and F at their start. Layout [L, K, D].
pub struct CurveTable {
    pub tokens: usize,
    pub values_LKD: Vec<f32>,
    pub slopes_LKD: Vec<f32>,
    pub prefixes_LKD: Vec<f32>,
}

impl CurveTable {
    pub fn new(window: &SortedWindow) -> Self {
        let tokens = window.tokens;
        let segments = tokens + 1;
        let size = LAYERS * segments * WIDTH;
        let (mut values_LKD, mut slopes_LKD, mut prefixes_LKD) = (vec![0.0; size], vec![0.0; size], vec![0.0; size]);
        let mut prefix_D = vec![0.0f64; WIDTH];
        for layer in 0..LAYERS {
            let sorted_MD = window.layer(layer);
            prefix_D.fill(0.0);
            for k in 0..segments {
                // Segment 0 holds y_0 until the first knot; segment M holds y_{M−1} after the last.
                let (low, high) = if k == 0 { (0, 0) } else { (k - 1, k.min(tokens - 1)) };
                let length = (if k == tokens { 1.0 } else { segment_start(k + 1, tokens) }) - segment_start(k, tokens);
                for channel in 0..WIDTH {
                    let value = sorted_MD[low * WIDTH + channel] as f64;
                    let slope = (sorted_MD[high * WIDTH + channel] as f64 - value) * tokens as f64;
                    let index = (layer * segments + k) * WIDTH + channel;
                    values_LKD[index] = value as f32;
                    slopes_LKD[index] = slope as f32;
                    prefixes_LKD[index] = prefix_D[channel] as f32;
                    prefix_D[channel] += value * length + slope * length * length / 2.0;
                }
            }
        }
        Self { tokens, values_LKD, slopes_LKD, prefixes_LKD }
    }

    /// F(q) = ∫₀^q Q for every channel of one layer, on the CPU in f64 (tests and fixtures).
    pub fn prefix_integral_cpu(&self, layer: usize, q: f64) -> Vec<f64> {
        let tokens = self.tokens;
        let k = ((q * tokens as f64 + 0.5).floor().max(0.0) as usize).min(tokens);
        let t = q - segment_start(k, tokens);
        (0..WIDTH)
            .map(|channel| {
                let index = (layer * (tokens + 1) + k) * WIDTH + channel;
                self.prefixes_LKD[index] as f64 + self.values_LKD[index] as f64 * t + self.slopes_LKD[index] as f64 * t * t / 2.0
            })
            .collect()
    }
}

/// `CurveTable` on the device, [L, 1, D, K]: one row per layer and channel, the rows'
/// layout of the ranking.
pub struct DeviceCurve {
    tokens: usize,
    values_L1DK: Tensor<4>,
    slopes_L1DK: Tensor<4>,
    prefixes_L1DK: Tensor<4>,
}

impl DeviceCurve {
    pub fn new(table: &CurveTable, device: &Device) -> Self {
        let upload = |values_LKD: &[f32]| {
            Tensor::<3>::from_data(TensorData::new(values_LKD.to_vec(), [LAYERS, table.tokens + 1, WIDTH]), device)
                .swap_dims(1, 2)
                .reshape([LAYERS, 1, WIDTH, table.tokens + 1])
        };
        Self {
            tokens: table.tokens,
            values_L1DK: upload(&table.values_LKD),
            slopes_L1DK: upload(&table.slopes_LKD),
            prefixes_L1DK: upload(&table.prefixes_LKD),
        }
    }

    /// F(q) at `q_NP` for N = L × views × D rows in (layer, view, channel) order. Finite q in
    /// [0, 1]; the segment index comes from the arithmetic ⌊q M + ½⌋, so a query at a knot
    /// takes either neighbouring segment, where F agrees.
    pub fn prefix_integral(&self, q_NP: Tensor<2>, views: usize) -> Tensor<2> {
        let [rows, _] = q_NP.dims();
        let tokens = self.tokens as f32;
        let segment_NP = (q_NP.clone() * tokens + 0.5).floor().clamp(0.0, tokens);
        let start_NP = ((segment_NP.clone() - 0.5) / tokens).clamp_min(0.0);
        let t_NP = q_NP - start_NP;
        let index_NP: Tensor<2, Int> = segment_NP.int();
        let gather = |table_L1DK: &Tensor<4>| {
            table_L1DK
                .clone()
                .expand([LAYERS, views, WIDTH, self.tokens + 1])
                .reshape([rows, self.tokens + 1])
                .gather(1, index_NP.clone())
        };
        assert_eq!(rows, LAYERS * views * WIDTH);
        let (values_NP, slopes_NP, prefixes_NP) = (gather(&self.values_L1DK), gather(&self.slopes_L1DK), gather(&self.prefixes_L1DK));
        prefixes_NP + values_NP * t_NP.clone() + slopes_NP * t_NP.clone() * t_NP / 2.0
    }
}

/// ∫₀¹ Q̄² per layer and channel, [L, D], with Q̄ the mean of the references' curves. Summed
/// over the union of the references' knots, where every curve is linear: on a segment [a, b]
/// the integral of a linear Q is (b − a)(Q(a)² + Q(a) Q(b) + Q(b)²) / 3.
pub fn squared_integral(windows: &[SortedWindow]) -> Vec<f32> {
    assert!(!windows.is_empty());
    let mut knots: Vec<f64> = vec![0.0, 1.0];
    for window in windows {
        knots.extend((0..window.tokens).map(|k| (k as f64 + 0.5) / window.tokens as f64));
    }
    knots.sort_by(f64::total_cmp);
    knots.dedup();
    let images = windows.len() as f64;
    let mut integral_LD = vec![0.0f32; LAYERS * WIDTH];
    let (mut one_D, mut start_D, mut end_D) = (vec![0.0f64; WIDTH], vec![0.0f64; WIDTH], vec![0.0f64; WIDTH]);
    let mut sum_D = vec![0.0f64; WIDTH];
    for layer in 0..LAYERS {
        sum_D.fill(0.0);
        let mut mean_at = |q: f64, out_D: &mut Vec<f64>| {
            out_D.fill(0.0);
            for window in windows {
                window.evaluate(layer, q, &mut one_D);
                for (total, value) in out_D.iter_mut().zip(&one_D) {
                    *total += value / images;
                }
            }
        };
        mean_at(knots[0], &mut end_D);
        for pair in knots.windows(2) {
            std::mem::swap(&mut start_D, &mut end_D);
            mean_at(pair[1], &mut end_D);
            let length = pair[1] - pair[0];
            for channel in 0..WIDTH {
                let (a, b) = (start_D[channel], end_D[channel]);
                sum_D[channel] += length * (a * a + a * b + b * b) / 3.0;
            }
        }
        for channel in 0..WIDTH {
            integral_LD[layer * WIDTH + channel] = sum_D[channel] as f32;
        }
    }
    integral_LD
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A readout whose channel 0 holds `values` at positions 0.., every other entry zero.
    pub fn readout(values: &[f32]) -> Vec<f32> {
        let mut readout_LTD = vec![0.0; LAYERS * PATCHES * WIDTH];
        for layer in 0..LAYERS {
            for (position, &value) in values.iter().enumerate() {
                readout_LTD[(layer * PATCHES + position) * WIDTH] = value;
            }
        }
        readout_LTD
    }

    fn window(values: &[f32]) -> SortedWindow {
        let positions: Vec<usize> = (0..values.len()).collect();
        SortedWindow::new(&readout(values), &positions)
    }

    #[test]
    fn the_curve_is_the_midpoint_rule_made_continuous() {
        // The worked example: [0, 4, 8, 12] is 0 up to q = 0.125, 16q − 2 to 0.875, then 12.
        let four = window(&[12.0, 0.0, 8.0, 4.0]);
        let mut out_D = vec![0.0; WIDTH];
        for (q, expected) in [(0.0, 0.0), (0.1, 0.0), (0.125, 0.0), (0.25, 2.0), (0.5, 6.0), (0.875, 12.0), (1.0, 12.0)] {
            four.evaluate(0, q, &mut out_D);
            assert!((out_D[0] - expected).abs() < 1e-12, "Q({q}) = {} not {expected}", out_D[0]);
        }
        // Sampling this curve at two interval midpoints gives [2, 10].
        four.evaluate(0, 0.25, &mut out_D);
        let at_quarter = out_D[0];
        four.evaluate(0, 0.75, &mut out_D);
        assert_eq!([at_quarter, out_D[0]], [2.0, 10.0]);
        // A one-token window is a constant curve.
        let one = window(&[3.0]);
        for q in [0.0, 0.3, 1.0] {
            one.evaluate(0, q, &mut out_D);
            assert_eq!(out_D[0], 3.0);
        }
    }

    #[test]
    fn the_prefix_integral_matches_the_curve_s_areas() {
        let four = window(&[0.0, 4.0, 8.0, 12.0]);
        let table = CurveTable::new(&four);
        // ∫₀^0.5 Q = ∫_0.125^0.5 (16q − 2) dq = 8(0.25 − 0.015625) − 2 × 0.375 = 1.125.
        assert!((table.prefix_integral_cpu(0, 0.5)[0] - 1.125).abs() < 1e-12);
        // Whole curve: 1.125 + ∫_0.5^0.875 (16q − 2) + 12 × 0.125 = 1.125 + 3.375 + 1.5 = 6, the mean value.
        assert!((table.prefix_integral_cpu(0, 1.0)[0] - 6.0).abs() < 1e-12);
        assert_eq!(table.prefix_integral_cpu(0, 0.0)[0], 0.0);
        // Inside the flat start: 0; inside the flat end: linear in q.
        assert_eq!(table.prefix_integral_cpu(0, 0.1)[0], 0.0);
        assert!((table.prefix_integral_cpu(0, 0.9)[0] - (6.0 - 12.0 * 0.1)).abs() < 1e-12);
        let one = CurveTable::new(&window(&[3.0]));
        assert!((one.prefix_integral_cpu(0, 0.7)[0] - 2.1).abs() < 1e-12);
    }

    #[test]
    fn the_squared_integral_sums_the_linear_pieces_of_the_mean_curve() {
        // One window [0, 4, 8, 12]: ∫Q² = ∫_0.125^0.875 (16q − 2)² dq + 144 × 0.125 = 36 + 18 = 54.
        let four = window(&[0.0, 4.0, 8.0, 12.0]);
        assert!((squared_integral(&[four])[0] - 54.0).abs() < 1e-4);
        // The mean of [0, 4, 8, 12] and a constant 6 is 6 + (Q − 6) / 2: ∫ = 36 + ¼ ∫(Q − 6)² = 36 + ¼(54 − 36) = 40.5.
        let four = window(&[0.0, 4.0, 8.0, 12.0]);
        let six = window(&[6.0]);
        assert!((squared_integral(&[four, six])[0] - 40.5).abs() < 1e-4);
    }
}
