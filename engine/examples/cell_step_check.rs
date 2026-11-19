//! The fused cell step against the unfused operations, bit for bit, then both timed natively.
//!
//!   cargo run --release --features harness --example cell_step_check [-- steps]
//!
//! Random states and rule values in the cellular automaton's training ranges on two grid sides,
//! chained over `steps` steps (default 10): the unfused output of a step feeds both paths of the
//! next, so a difference cannot hide behind chaos. Reports every mismatching value (count, largest
//! difference, first index) per step and the native time per step of each path at the figure
//! recipe's batch-4 shape.
#![allow(non_snake_case)] // Tensor suffixes document axes.
use burn::tensor::{Device, Distribution, Tensor};
use dinodreamer_engine::{
    grow::figure::upsample_torus,
    kernels::{
        cell::{self, CHANNELS, HIDDEN, PERCEPTIONS},
        cell_step, draws,
        pyramid::{self, PyramidChunkInput, PyramidStates},
    },
};
use serde_json::json;
use std::{env, time::Instant};

const RATE: f32 = 0.5;

fn values(tensor: Tensor<3>) -> Vec<f32> {
    tensor.into_data().try_to_vec::<f32>().unwrap()
}

/// The unfused step of `grow/figure/rule.rs`: perceive, fc1 with bias and ReLU, fc2, mask, residual.
fn unfused(state_1NC: Tensor<3>, fc1_JP: &Tensor<2>, bias_J: &Tensor<1>, fc2_CJ: &Tensor<2>, key: u32, side: usize) -> Tensor<3> {
    let device = state_1NC.device();
    let cells = state_1NC.dims()[1];
    let hidden_1NJ = cell::linear(cell::perceive(state_1NC.clone(), side), fc1_JP.clone(), bias_J.clone(), true);
    let delta_1NC = cell::linear(hidden_1NJ, fc2_CJ.clone(), Tensor::zeros([CHANNELS], &device), false);
    state_1NC + delta_1NC * draws::fire_mask(key, cells, RATE, &device)
}

fn compare(actual: &[f32], expected: &[f32]) -> serde_json::Value {
    assert_eq!(actual.len(), expected.len());
    let mut mismatches = 0usize;
    let mut largest = 0.0f32;
    let mut first = None;
    for (index, (a, e)) in actual.iter().zip(expected).enumerate() {
        if a.to_bits() != e.to_bits() {
            mismatches += 1;
            largest = largest.max((a - e).abs());
            first.get_or_insert((index, *a, *e));
        }
    }
    json!({ "values": actual.len(), "mismatches": mismatches, "largestDifference": largest, "first": first, "exact": mismatches == 0 })
}

fn time_steps(device: &Device, name: &str, steps: u32, mut piece: impl FnMut()) -> f64 {
    // Warm the clocks with the same work first.
    let warm = Instant::now();
    while warm.elapsed().as_millis() < 300 {
        piece();
        device.sync().unwrap();
    }
    let start = Instant::now();
    for _ in 0..steps {
        piece();
    }
    device.sync().unwrap();
    let milliseconds = start.elapsed().as_secs_f64() * 1e3 / steps as f64;
    eprintln!("{name:<24} {milliseconds:8.3} ms per step");
    milliseconds
}

fn sum3(values: Tensor<3>) -> Tensor<1> {
    values.sum_dim(2).sum_dim(1).sum_dim(0).reshape([1])
}

/// Reference gradients through Burn's autodiff: leaf copies of the parameters, unfused
/// steps on a tape, the objective sum(output · upstream), then state and parameter gradients.
fn autodiff_chunk(autodiff: &Device, input: cell_step::CellChunkInput<'_>) -> [Vec<f32>; 4] {
    let cell_step::CellChunkInput {
        start_1NC,
        fc1_JP,
        bias_J,
        fc2_CJ,
        keys,
        rate,
        side,
        upstream_1NC,
    } = input;
    let cells = start_1NC.dims()[1];
    let (w1, b1, w2) = (
        fc1_JP.autodiff().require_grad(),
        bias_J.autodiff().require_grad(),
        fc2_CJ.autodiff().require_grad(),
    );
    let input_1NC = start_1NC.autodiff().require_grad();
    let mut state_1NC = input_1NC.clone();
    for &key in keys {
        let fired_1N1 = draws::fire_mask(key, cells, rate, &autodiff.clone().inner()).autodiff();
        let hidden_1NJ = cell::linear(cell::perceive(state_1NC.clone(), side), w1.clone(), b1.clone(), true);
        let delta_1NC = cell::linear(hidden_1NJ, w2.clone(), Tensor::zeros([CHANNELS], autodiff), false);
        state_1NC = state_1NC + delta_1NC * fired_1N1;
    }
    let mut derivatives = sum3(state_1NC * upstream_1NC.autodiff()).backward();
    let read = |tensor: Tensor<3>| values(tensor);
    [
        read(input_1NC.grad_remove(&mut derivatives).unwrap()),
        w1.grad_remove(&mut derivatives).unwrap().into_data().try_to_vec::<f32>().unwrap(),
        b1.grad_remove(&mut derivatives).unwrap().into_data().try_to_vec::<f32>().unwrap(),
        w2.grad_remove(&mut derivatives).unwrap().into_data().try_to_vec::<f32>().unwrap(),
    ]
}

/// `cell_step_check ablate`: the per-phase timings of both fused kernels at the batch-4 shape.
fn ablate() {
    let device = Device::wgpu_options().init().unwrap().autodiff().inner();
    let (side, grids) = (128usize, 4usize);
    let cells = grids * side * side;
    let state_1NC = Tensor::<3>::random([1, cells, CHANNELS], Distribution::Uniform(-0.5, 0.5), &device);
    let fc1_JP = Tensor::<2>::random([HIDDEN, PERCEPTIONS], Distribution::Uniform(-0.125, 0.125), &device);
    let bias_J = Tensor::<1>::random([HIDDEN], Distribution::Uniform(-0.125, 0.125), &device);
    let fc2_CJ = Tensor::<2>::random([CHANNELS, HIDDEN], Distribution::Uniform(-0.05, 0.05), &device);
    let sync_device = device.clone();
    let rows = cell_step::ablation(state_1NC, fc1_JP, bias_J, fc2_CJ, side, 24, &|| sync_device.sync().unwrap());
    for (name, milliseconds) in &rows {
        eprintln!("{name:<36} {milliseconds:8.3} ms per launch");
    }
    println!("{}", serde_json::to_string_pretty(&json!({ "side": side, "grids": grids, "rows": rows })).unwrap());
}

/// `cell_step_check order`: which accumulation order of the four taps per axis reproduces the
/// tape's coarse gradient of `upsample_torus`, searched on the CPU in f32 (no contraction).
fn order() {
    let autodiff = Device::wgpu_options().init().unwrap().autodiff();
    let device = autodiff.clone().inner();
    let (side, grids) = (32usize, 2usize);
    let coarse_side = side / 2;
    let cells = grids * side * side;
    let coarse_1MC = Tensor::<3>::random([1, cells / 4, CHANNELS], Distribution::Uniform(-0.5, 0.5), &device);
    // Only the upsampled columns of the fine-input gradient reach the coarse grid.
    let upstream_1NC = Tensor::<3>::random([1, cells, CHANNELS], Distribution::Uniform(-1.0, 1.0), &device);
    let coarse = coarse_1MC.clone().autodiff().require_grad();
    let mut derivatives = sum3(upsample_torus(coarse.clone(), grids, coarse_side) * upstream_1NC.clone().autodiff()).backward();
    let expected = values(coarse.grad_remove(&mut derivatives).unwrap());
    let g = values(upstream_1NC);
    // The four taps of coarse index k along an axis: fine 2k (0.75), 2k + 1 (0.75), 2k − 1 (0.25), 2k + 2 (0.25).
    let taps = |k: usize, length: usize| -> [(usize, f32); 4] {
        [((2 * k) % (2 * length), 0.75), ((2 * k + 1) % (2 * length), 0.75), ((2 * k + 2 * length - 1) % (2 * length), 0.25), ((2 * k + 2) % (2 * length), 0.25)]
    };
    let permutations: Vec<[usize; 4]> = {
        let mut all = Vec::new();
        for a in 0..4 { for b in 0..4 { for c in 0..4 { for d in 0..4 {
            if a != b && a != c && a != d && b != c && b != d && c != d { all.push([a, b, c, d]); }
        }}}}
        all
    };
    let accumulate = |terms: [f32; 4], order: &[usize; 4]| -> f32 {
        let mut total = terms[order[0]];
        for &i in &order[1..] { total += terms[i]; }
        total
    };
    let fine_at = |grid: usize, row: usize, column: usize, channel: usize| g[((grid * side + row) * side + column) * CHANNELS + channel];
    let mut matches = Vec::new();
    for (hi, order_h) in permutations.iter().enumerate() {
        // The widened rows' gradient: coarse row r, fine column j.
        let mut widened = vec![0.0f32; grids * coarse_side * side * CHANNELS];
        for grid in 0..grids { for r in 0..coarse_side { for j in 0..side { for ch in 0..CHANNELS {
            let t = taps(r, coarse_side);
            let terms = [fine_at(grid, t[0].0, j, ch) * t[0].1, fine_at(grid, t[1].0, j, ch) * t[1].1, fine_at(grid, t[2].0, j, ch) * t[2].1, fine_at(grid, t[3].0, j, ch) * t[3].1];
            widened[((grid * coarse_side + r) * side + j) * CHANNELS + ch] = accumulate(terms, order_h);
        }}}}
        for (wi, order_w) in permutations.iter().enumerate() {
            let mut mismatches = 0usize;
            'outer: for grid in 0..grids { for r in 0..coarse_side { for c in 0..coarse_side { for ch in 0..CHANNELS {
                let t = taps(c, coarse_side);
                let w = |j: usize| widened[((grid * coarse_side + r) * side + j) * CHANNELS + ch];
                let terms = [w(t[0].0) * t[0].1, w(t[1].0) * t[1].1, w(t[2].0) * t[2].1, w(t[3].0) * t[3].1];
                let actual = accumulate(terms, order_w);
                let index = ((grid * coarse_side + r) * coarse_side + c) * CHANNELS + ch;
                if actual.to_bits() != expected[index].to_bits() { mismatches += 1; if mismatches > 64 { break 'outer; } }
            }}}}
            if mismatches == 0 { matches.push((hi, wi, *order_h, *order_w)); }
        }
    }
    println!("{}", serde_json::to_string_pretty(&json!({ "matches": matches.iter().map(|(hi, wi, h, w)| json!({ "height": h, "width": w, "indices": [hi, wi] })).collect::<Vec<_>>(), "tapNames": ["fine 2k x 0.75", "fine 2k+1 x 0.75", "fine 2k-1 x 0.25", "fine 2k+2 x 0.25"] })).unwrap());
}

fn main() {
    if env::args().nth(1).as_deref() == Some("ablate") {
        return ablate();
    }
    if env::args().nth(1).as_deref() == Some("order") {
        return order();
    }
    let steps: u32 = env::args().nth(1).map(|value| value.parse().unwrap()).unwrap_or(10);
    let autodiff = Device::wgpu_options().init().unwrap().autodiff();
    let device = autodiff.clone().inner();
    let mut report = Vec::new();
    for (side, grids) in [(32usize, 2usize), (128, 4)] {
        let cells = grids * side * side;
        // Initial training ranges: states in [−0.5, 0.5), fc1 in ±1/8, fc2 small so the chain stays bounded.
        let mut state_1NC = Tensor::<3>::random([1, cells, CHANNELS], Distribution::Uniform(-0.5, 0.5), &device);
        let fc1_JP = Tensor::<2>::random([HIDDEN, PERCEPTIONS], Distribution::Uniform(-0.125, 0.125), &device);
        let bias_J = Tensor::<1>::random([HIDDEN], Distribution::Uniform(-0.125, 0.125), &device);
        let fc2_CJ = Tensor::<2>::random([CHANNELS, HIDDEN], Distribution::Uniform(-0.05, 0.05), &device);
        let mut rows = Vec::new();
        let mut exact = true;
        for step in 0..steps {
            let key = 0x74666972u32.wrapping_mul(step + 1).wrapping_add(side as u32);
            let reference_1NC = unfused(state_1NC.clone(), &fc1_JP, &bias_J, &fc2_CJ, key, side);
            let fused_1NC = cell_step::step(state_1NC.clone(), fc1_JP.clone(), bias_J.clone(), fc2_CJ.clone(), key, RATE, side);
            let row = compare(&values(fused_1NC), &values(reference_1NC.clone()));
            exact &= row["exact"] == json!(true);
            eprintln!("side {side} step {step}: {row}");
            rows.push(row);
            state_1NC = reference_1NC;
        }
        let unfused_ms = time_steps(&device, &format!("unfused side {side}"), 48, || {
            let _ = unfused(state_1NC.clone(), &fc1_JP, &bias_J, &fc2_CJ, 7, side);
        });
        let fused_ms = time_steps(&device, &format!("fused side {side}"), 48, || {
            let _ = cell_step::step(state_1NC.clone(), fc1_JP.clone(), bias_J.clone(), fc2_CJ.clone(), 7, RATE, side);
        });
        // The band projections against the generic tiled kernel, bit for bit.
        let perceived_1NP = cell::perceive(state_1NC.clone(), side);
        let band_hidden = cell::linear(perceived_1NP.clone(), fc1_JP.clone(), bias_J.clone(), true);
        let generic_hidden = cell::generic_linear(perceived_1NP.clone(), fc1_JP.clone(), bias_J.clone(), true);
        let fc1_rows = compare(&values(band_hidden.clone()), &values(generic_hidden.clone()));
        let zero_C = Tensor::<1>::zeros([CHANNELS], &device);
        let fc2_rows = compare(
            &values(cell::linear(generic_hidden.clone(), fc2_CJ.clone(), zero_C.clone(), false)),
            &values(cell::generic_linear(generic_hidden.clone(), fc2_CJ.clone(), zero_C.clone(), false)),
        );
        eprintln!("side {side} band fc1: {fc1_rows}\nside {side} band fc2: {fc2_rows}");
        let band_exact = fc1_rows["exact"] == json!(true) && fc2_rows["exact"] == json!(true);
        let generic_fc1_ms = time_steps(&device, &format!("generic fc1 side {side}"), 48, || {
            let _ = cell::generic_linear(perceived_1NP.clone(), fc1_JP.clone(), bias_J.clone(), true);
        });
        let band_fc1_ms = time_steps(&device, &format!("band fc1 side {side}"), 48, || {
            let _ = cell::linear(perceived_1NP.clone(), fc1_JP.clone(), bias_J.clone(), true);
        });
        let generic_fc2_ms = time_steps(&device, &format!("generic fc2 side {side}"), 48, || {
            let _ = cell::generic_linear(generic_hidden.clone(), fc2_CJ.clone(), zero_C.clone(), false);
        });
        let band_fc2_ms = time_steps(&device, &format!("band fc2 side {side}"), 48, || {
            let _ = cell::linear(generic_hidden.clone(), fc2_CJ.clone(), zero_C.clone(), false);
        });
        // The pyramid's fine input against the Burn chain it replaces: the forward bit for bit, the
        // adjoint within float rounding (its sums run in another order).
        let coarse_1MC = Tensor::<3>::random([1, cells / 4, CHANNELS], Distribution::Uniform(-0.5, 0.5), &device);
        let chain_1NI = Tensor::cat(vec![cell::perceive(state_1NC.clone(), side), upsample_torus(coarse_1MC.clone(), grids, side / 2)], 2);
        let kernel_1NI = pyramid::fine_input(state_1NC.clone(), coarse_1MC.clone(), side);
        let pyramid_forward = compare(&values(kernel_1NI.clone()), &values(chain_1NI.clone()));
        let upstream_1NI = Tensor::<3>::random([1, cells, PERCEPTIONS + CHANNELS], Distribution::Uniform(-1.0, 1.0), &device);
        let adjoint = |input: &dyn Fn(Tensor<3>, Tensor<3>) -> Tensor<3>| -> (Vec<f32>, Vec<f32>) {
            let fine = state_1NC.clone().autodiff().require_grad();
            let coarse = coarse_1MC.clone().autodiff().require_grad();
            let mut derivatives = sum3(input(fine.clone(), coarse.clone()) * upstream_1NI.clone().autodiff()).backward();
            (values(fine.grad_remove(&mut derivatives).unwrap()), values(coarse.grad_remove(&mut derivatives).unwrap()))
        };
        let (chain_fine, chain_coarse) = adjoint(&|fine, coarse| Tensor::cat(vec![cell::perceive(fine, side), upsample_torus(coarse, grids, side / 2)], 2));
        let (kernel_fine, kernel_coarse) = adjoint(&|fine, coarse| pyramid::fine_input(fine, coarse, side));
        let relative = |a: &[f32], b: &[f32]| {
            let (mut error, mut norm) = (0.0f64, 0.0f64);
            for (x, y) in a.iter().zip(b) { error += (*x as f64 - *y as f64).powi(2); norm += (*y as f64).powi(2); }
            (error / norm.max(1e-30)).sqrt()
        };
        // The coarse adjoint against the tape, bit for bit (its order comes from `order`).
        let coarse_rows = compare(&values(pyramid::coarse_gradient_check(upstream_1NI.clone(), side)), &chain_coarse);
        let pyramid_rows = json!({ "forward": pyramid_forward, "fineGradient": compare(&kernel_fine, &chain_fine),
            "coarseGradient": coarse_rows, "coarseGradientRelativeRms": relative(&kernel_coarse, &chain_coarse) });
        eprintln!("side {side} pyramid fine input: {pyramid_rows}");
        let pyramid_exact = pyramid_forward["exact"] == json!(true) && pyramid_rows["fineGradient"]["exact"] == json!(true)
            && pyramid_rows["coarseGradient"]["exact"] == json!(true);
        let chain_ms = time_steps(&device, &format!("pyramid input chain side {side}"), 24, || {
            let _ = Tensor::cat(vec![cell::perceive(state_1NC.clone(), side), upsample_torus(coarse_1MC.clone(), grids, side / 2)], 2);
        });
        let kernel_ms = time_steps(&device, &format!("pyramid input kernel side {side}"), 24, || {
            let _ = pyramid::fine_input(state_1NC.clone(), coarse_1MC.clone(), side);
        });
        // The pyramid's chunk backward against the tape: both grids, four steps, random states.
        {
            let coarse_side = side / 2;
            let coarse_cells = cells / 4;
            let fc1_c = Tensor::<2>::random([HIDDEN, PERCEPTIONS], Distribution::Uniform(-0.125, 0.125), &device);
            let bias_c = Tensor::<2>::random([1, HIDDEN], Distribution::Uniform(-0.125, 0.125), &device);
            let fc2_c = Tensor::<2>::random([CHANNELS, HIDDEN], Distribution::Uniform(-0.05, 0.05), &device);
            let fc1_f = Tensor::<2>::random([HIDDEN, PERCEPTIONS + CHANNELS], Distribution::Uniform(-0.11, 0.11), &device);
            let bias_f = Tensor::<2>::random([1, HIDDEN], Distribution::Uniform(-0.11, 0.11), &device);
            let fc2_f = Tensor::<2>::random([CHANNELS, HIDDEN], Distribution::Uniform(-0.05, 0.05), &device);
            let coarse_start = Tensor::<3>::random([1, coarse_cells, CHANNELS], Distribution::Uniform(-0.5, 0.5), &device);
            let up_fine = Tensor::<3>::random([1, cells, CHANNELS], Distribution::Uniform(-1.0, 1.0), &device);
            let up_coarse = Tensor::<3>::random([1, coarse_cells, CHANNELS], Distribution::Uniform(-1.0, 1.0), &device);
            let fine_keys: Vec<u32> = (0..4u32).map(|step| 0x70797266u32.wrapping_mul(step + 1).wrapping_add(side as u32)).collect();
            let coarse_keys: Vec<u32> = (0..4u32).map(|step| 0x70797263u32.wrapping_mul(step + 1).wrapping_add(side as u32)).collect();
            // The tape: leaf copies, the rule's own operations, sum(output · upstream) on both grids.
            let leaves: Vec<Tensor<2>> = [&fc1_c, &bias_c, &fc2_c, &fc1_f, &bias_f, &fc2_f].iter().map(|t| (*t).clone().autodiff().require_grad()).collect();
            let fine_leaf = state_1NC.clone().autodiff().require_grad();
            let coarse_leaf = coarse_start.clone().autodiff().require_grad();
            let (mut fine, mut coarse) = (fine_leaf.clone(), coarse_leaf.clone());
            for (&fk, &ck) in fine_keys.iter().zip(&coarse_keys) {
                let coarse_mask = draws::fire_mask(ck, coarse_cells, RATE, &device).autodiff();
                let coarse_hidden = cell::linear(cell::perceive(coarse.clone(), coarse_side), leaves[0].clone(), leaves[1].clone().reshape([HIDDEN]), true);
                let coarse_delta = cell::linear(coarse_hidden, leaves[2].clone(), Tensor::zeros([CHANNELS], &autodiff), false);
                coarse = coarse + coarse_delta * coarse_mask;
                let inputs = pyramid::fine_input(fine.clone(), coarse.clone(), side);
                let fine_mask = draws::fire_mask(fk, cells, RATE, &device).autodiff();
                let fine_hidden = cell::linear(inputs, leaves[3].clone(), leaves[4].clone().reshape([HIDDEN]), true);
                let fine_delta = cell::linear(fine_hidden, leaves[5].clone(), Tensor::zeros([CHANNELS], &autodiff), false);
                fine = fine + fine_delta * fine_mask;
            }
            let objective = sum3(fine * up_fine.clone().autodiff()) + sum3(coarse * up_coarse.clone().autodiff());
            let mut derivatives = objective.backward();
            let expected_fine = values(fine_leaf.grad_remove(&mut derivatives).unwrap());
            let expected_coarse = values(coarse_leaf.grad_remove(&mut derivatives).unwrap());
            let expected_params: Vec<Vec<f32>> = leaves.iter().map(|leaf| leaf.grad_remove(&mut derivatives).unwrap().into_data().try_to_vec::<f32>().unwrap()).collect();
            let actual = pyramid::chunk_gradient(PyramidChunkInput {
                start: PyramidStates {
                    fine_1NC: state_1NC.clone(),
                    coarse_1MC: coarse_start.clone(),
                },
                parameters: [
                    fc1_c.clone(),
                    bias_c.clone(),
                    fc2_c.clone(),
                    fc1_f.clone(),
                    bias_f.clone(),
                    fc2_f.clone(),
                ],
                fine_keys: &fine_keys,
                coarse_keys: &coarse_keys,
                rate: RATE,
                side,
                upstream: PyramidStates {
                    fine_1NC: up_fine.clone(),
                    coarse_1MC: up_coarse.clone(),
                },
            });
            let names = ["fc1Coarse", "biasCoarse", "fc2Coarse", "fc1Fine", "biasFine", "fc2Fine"];
            let mut rows = serde_json::Map::new();
            rows.insert("fineGradient".into(), compare(&values(actual.fine_1NC), &expected_fine));
            rows.insert("coarseGradient".into(), compare(&values(actual.coarse_1MC), &expected_coarse));
            for (i, tensor) in actual.parameters.into_iter().enumerate() {
                rows.insert(names[i].into(), compare(&tensor.into_data().try_to_vec::<f32>().unwrap(), &expected_params[i]));
            }
            let all_exact = rows.values().all(|row| row["exact"] == json!(true));
            eprintln!("side {side} pyramid chunk backward exact {all_exact}: {}", serde_json::Value::Object(rows.clone()));
            exact &= all_exact;
            let tape_ms = time_steps(&device, &format!("pyramid tape chunk side {side}"), 4, || {
                let leaves: Vec<Tensor<2>> = [&fc1_c, &bias_c, &fc2_c, &fc1_f, &bias_f, &fc2_f].iter().map(|t| (*t).clone().autodiff().require_grad()).collect();
                let (mut fine, mut coarse) = (state_1NC.clone().autodiff().require_grad(), coarse_start.clone().autodiff().require_grad());
                for (&fk, &ck) in fine_keys.iter().zip(&coarse_keys) {
                    let coarse_hidden = cell::linear(cell::perceive(coarse.clone(), coarse_side), leaves[0].clone(), leaves[1].clone().reshape([HIDDEN]), true);
                    coarse = coarse + cell::linear(coarse_hidden, leaves[2].clone(), Tensor::zeros([CHANNELS], &autodiff), false) * draws::fire_mask(ck, coarse_cells, RATE, &device).autodiff();
                    let fine_hidden = cell::linear(pyramid::fine_input(fine.clone(), coarse.clone(), side), leaves[3].clone(), leaves[4].clone().reshape([HIDDEN]), true);
                    fine = fine + cell::linear(fine_hidden, leaves[5].clone(), Tensor::zeros([CHANNELS], &autodiff), false) * draws::fire_mask(fk, cells, RATE, &device).autodiff();
                }
                let _ = (sum3(fine * up_fine.clone().autodiff()) + sum3(coarse * up_coarse.clone().autodiff())).backward();
            }) / 4.0;
            let fused_ms = time_steps(&device, &format!("pyramid fused chunk side {side}"), 4, || {
                let _ = pyramid::chunk_gradient(PyramidChunkInput {
                    start: PyramidStates {
                        fine_1NC: state_1NC.clone(),
                        coarse_1MC: coarse_start.clone(),
                    },
                    parameters: [
                        fc1_c.clone(),
                        bias_c.clone(),
                        fc2_c.clone(),
                        fc1_f.clone(),
                        bias_f.clone(),
                        fc2_f.clone(),
                    ],
                    fine_keys: &fine_keys,
                    coarse_keys: &coarse_keys,
                    rate: RATE,
                    side,
                    upstream: PyramidStates {
                        fine_1NC: up_fine.clone(),
                        coarse_1MC: up_coarse.clone(),
                    },
                });
            }) / 4.0;
            eprintln!("side {side} pyramid chunk: tape {tape_ms:.3} ms per step, fused {fused_ms:.3}");
        }
        // The chunk backward: eight steps (the rule's CHUNK) from a random state and upstream.
        let chunk_keys: Vec<u32> = (0..8u32).map(|step| 0x63686b6eu32.wrapping_mul(step + 1).wrapping_add(side as u32)).collect();
        let upstream_1NC = Tensor::<3>::random([1, cells, CHANNELS], Distribution::Uniform(-1.0, 1.0), &device);
        let chunk_input = || cell_step::CellChunkInput {
            start_1NC: state_1NC.clone(),
            fc1_JP: fc1_JP.clone(),
            bias_J: bias_J.clone(),
            fc2_CJ: fc2_CJ.clone(),
            keys: &chunk_keys,
            rate: RATE,
            side,
            upstream_1NC: upstream_1NC.clone(),
        };
        let expected = autodiff_chunk(&autodiff, chunk_input());
        let actual = cell_step::chunk_gradient(chunk_input());
        let backward_rows = json!({
            "stateGradient": compare(&values(actual.state_1NC), &expected[0]),
            "fc1Gradient": compare(&actual.fc1_JP.into_data().try_to_vec::<f32>().unwrap(), &expected[1]),
            "biasGradient": compare(&actual.bias_J.into_data().try_to_vec::<f32>().unwrap(), &expected[2]),
            "fc2Gradient": compare(&actual.fc2_CJ.into_data().try_to_vec::<f32>().unwrap(), &expected[3]),
        });
        let backward_exact = ["stateGradient", "fc1Gradient", "biasGradient", "fc2Gradient"].iter().all(|key| backward_rows[key]["exact"] == json!(true));
        eprintln!("side {side} chunk backward: {backward_rows}");
        let autodiff_chunk_ms = time_steps(&device, &format!("autodiff chunk side {side}"), 6, || {
            let _ = autodiff_chunk(&autodiff, chunk_input());
        }) / 8.0;
        let fused_chunk_ms = time_steps(&device, &format!("fused chunk side {side}"), 6, || {
            let _ = cell_step::chunk_gradient(chunk_input());
        }) / 8.0;
        report.push(json!({ "side": side, "grids": grids, "cells": cells, "exact": exact && backward_exact && band_exact && pyramid_exact, "steps": rows,
            "pyramid": { "checks": pyramid_rows, "chainMs": chain_ms, "kernelMs": kernel_ms },
            "unfusedMsPerStep": unfused_ms, "fusedMsPerStep": fused_ms,
            "band": { "fc1": fc1_rows, "fc2": fc2_rows, "genericFc1Ms": generic_fc1_ms, "bandFc1Ms": band_fc1_ms, "genericFc2Ms": generic_fc2_ms, "bandFc2Ms": band_fc2_ms },
            "backward": backward_rows, "autodiffBackwardMsPerStep": autodiff_chunk_ms, "fusedBackwardMsPerStep": fused_chunk_ms }));
    }
    let pass = report.iter().all(|row| row["exact"] == json!(true));
    println!("{}", serde_json::to_string_pretty(&json!({ "pass": pass, "cases": report })).unwrap());
    if !pass {
        std::process::exit(1);
    }
}
