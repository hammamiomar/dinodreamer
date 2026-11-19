//! Native timing of the update's kernels on WGPU (Metal on a Mac): the tiled linear layers,
//! attention, LayerNorm and GELU forward and backward, and the GPU ranking, at the shapes of
//! one evidence update (B = 2 views, T = 261 tokens, 4 appearance layers). Each operation runs `REPEATS` times between two
//! device syncs, after 300 ms of warm-up; the time per call includes launch overhead.
//! Run: cargo run --release --features harness --example kernel_benchmarks [-- linear|ranking|attention|norm]
//! With a section name, only that section runs.
#![allow(non_snake_case)] // Tensor suffixes document axes.
use burn::tensor::{Device, Distribution, Tensor};
use dinodreamer_engine::{
    encoder::{HEAD_WIDTH, HEADS, TOKENS, WIDTH},
    kernels::{frozen_linear, scaled_attention},
};
use std::time::Instant;

const REPEATS: u32 = 40;
const VIEWS: usize = 2;

fn time(device: &Device, name: &str, flops: f64, mut operation: impl FnMut()) {
    // At least 300 ms of the same work first: the GPU clock rises under load.
    let warm = Instant::now();
    while warm.elapsed().as_millis() < 300 {
        operation();
        device.sync().unwrap();
    }
    let start = Instant::now();
    for _ in 0..REPEATS {
        operation();
    }
    device.sync().unwrap();
    let seconds = start.elapsed().as_secs_f64() / REPEATS as f64;
    let rate = if flops > 0.0 { format!("{:6.2} TFLOP/s", flops / seconds / 1e12) } else { String::new() };
    println!("{name:<40} {:8.3} ms {rate}", seconds * 1e3);
}

fn random<const D: usize>(shape: [usize; D], device: &Device) -> Tensor<D> {
    Tensor::random(shape, Distribution::Normal(0.0, 1.0), device)
}

fn layer_norm(tokens_BTD: Tensor<3>) -> Tensor<3> {
    let centered_BTD = tokens_BTD.clone() - tokens_BTD.mean_dim(2);
    let variance_BT1 = centered_BTD.clone().square().mean_dim(2);
    centered_BTD / (variance_BT1 + 1e-5).sqrt()
}

fn gelu(hidden: Tensor<3>) -> Tensor<3> {
    hidden.clone() * 0.5 * ((hidden / 2.0_f64.sqrt()).erf() + 1.0)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let device = Device::wgpu_options().init()?.autodiff();
    let only = std::env::args().nth(1);
    let runs = |section: &str| only.as_deref().is_none_or(|name| name == section);
    let rows = (VIEWS * TOKENS) as f64;
    let linear_layers = [("qkv", WIDTH, 3 * WIDTH), ("proj", WIDTH, WIDTH), ("mlp in", WIDTH, 4 * WIDTH), ("mlp out", 4 * WIDTH, WIDTH)];
    for (name, input, output) in linear_layers.into_iter().filter(|_| runs("linear")) {
        let weight = random([output, input], &device).inner().autodiff();
        let tokens = random([VIEWS, TOKENS, input], &device);
        let flops = 2.0 * rows * input as f64 * output as f64;
        time(&device, &format!("linear {name} forward"), flops, || {
            let _ = frozen_linear(tokens.clone(), weight.clone());
        });
        let tracked = tokens.clone().require_grad();
        time(&device, &format!("linear {name} forward + backward"), 2.0 * flops, || {
            let _ = frozen_linear(tracked.clone(), weight.clone()).sum().backward();
        });
    }
    let rankings = [("ranking, 256-cell Look like (6144 rows of 256)", 256), ("ranking, 12-cell Look like (6144 rows of 12)", 12)];
    for (name, points) in rankings.into_iter().filter(|_| runs("ranking")) {
        let rows = 4 * VIEWS * WIDTH;
        let values = random([rows, points], &device).inner();
        // Equal masses: the sort, the cumulative masses and the scatter back to the cells.
        let masses = burn::tensor::Tensor::full([rows, points], 1.0 / points as f32, &device).inner();
        time(&device, name, 0.0, || {
            let intervals = dinodreamer_engine::ranking::mass_intervals(values.clone(), masses.clone());
            let _ = dinodreamer_engine::ranking::by_cell(intervals.order_NP, intervals.upper_NP);
        });
    }
    if runs("attention") {
        let heads = || random([VIEWS, HEADS, TOKENS, HEAD_WIDTH], &device);
        let (query, key, value) = (heads(), heads(), heads());
        let attention_flops = 4.0 * (VIEWS * HEADS) as f64 * (TOKENS * TOKENS * HEAD_WIDTH) as f64;
        time(&device, "attention forward", attention_flops, || {
            let _ = scaled_attention(query.clone(), key.clone(), value.clone());
        });
        let (query, key, value) = (query.require_grad(), key.require_grad(), value.require_grad());
        time(&device, "attention forward + backward", 3.0 * attention_flops, || {
            let _ = scaled_attention(query.clone(), key.clone(), value.clone()).sum().backward();
        });
    }
    if !runs("norm") {
        return Ok(());
    }
    let tokens = random([VIEWS, TOKENS, WIDTH], &device);
    time(&device, "layer norm forward", 0.0, || {
        let _ = layer_norm(tokens.clone());
    });
    let tracked = tokens.require_grad();
    time(&device, "layer norm forward + backward", 0.0, || {
        let _ = layer_norm(tracked.clone()).sum().backward();
    });
    let hidden = random([VIEWS, TOKENS, 4 * WIDTH], &device);
    time(&device, "gelu forward", 0.0, || {
        let _ = gelu(hidden.clone());
    });
    let tracked = hidden.require_grad();
    time(&device, "gelu forward + backward", 0.0, || {
        let _ = gelu(tracked.clone()).sum().backward();
    });
    Ok(())
}
