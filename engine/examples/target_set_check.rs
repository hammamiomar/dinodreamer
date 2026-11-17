//! The target set alone against the CPU oracle: the engine prepares a set method's set from the
//! fixture's raw-pixel windows (one DINO pass, the 3 × 3 tokens, the standardization and the kernel)
//! and compares it with the oracle's record (`support/target_set_fixture.rs`). It runs on either
//! build, so the set is checked on the CPU too:
//!
//!   cargo run --release --no-default-features --features cpu --example target_set_check -- \
//!       tools/fixtures/grow-recipe-oracle-12002-pyramid-seeded-token-distribution-batch4.json
//!   cargo run --release --features harness --example target_set_check -- <the same fixture>
//!
//! Assets as in grow_recipe_parity. It prints one JSON report and exits 1 when the set differs.
#![allow(non_snake_case)] // Tensor suffixes document axes.
#[path = "support/target_set_fixture.rs"]
mod target_set_fixture;

use burn::tensor::{Device, Tensor, TensorData};
use dinodreamer_engine::{
    encoder::{Block, DEPTH, Dino},
    grow::figure::{FigureRequest, target_set::{TargetSet, WINDOW_SIDE}},
    objective::{Calibration, load_frame},
};
use serde::Deserialize;
use serde_json::json;
use std::{env, fs, path::{Path, PathBuf}};

const ENCODER: &str = "dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "monet-dtd-seed9-20261004-pass-003";

#[derive(Deserialize)]
struct Fixture {
    request: FigureRequest,
    set: target_set_fixture::SetRecord,
}

fn device() -> Device {
    #[cfg(feature = "gpu")]
    return Device::wgpu_options().init().unwrap().autodiff();
    #[cfg(not(feature = "gpu"))]
    Device::flex().autodiff()
}

fn main() {
    let path = env::args().nth(1).expect("usage: target_set_check <oracle fixture of a set method>");
    let fixture: Fixture = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let model = PathBuf::from(env::var("DINODREAMER_MODEL").unwrap_or("local/release/model".into()));
    let device = device();
    let mut encoder = Dino::load_stem(&fs::read(model.join(ENCODER).join("encoder-stem.safetensors")).unwrap(), &device).unwrap();
    for layer in 0..DEPTH {
        let file = model.join(ENCODER).join(format!("encoder-layer-{layer:02}.safetensors"));
        encoder.blocks.push(Block::load(&fs::read(file).unwrap(), &device).unwrap());
    }
    let dictionary = model.join(DICTIONARY);
    let calibration = Calibration::load(&fs::read(dictionary.join("calibration.safetensors")).unwrap(), &device).unwrap();
    let block = fixture.request.block;
    let frame_DR = load_frame(&fs::read(dictionary.join(format!("blocks/{block:05}.safetensors"))).unwrap(), &device).unwrap();

    let (windows, dots, file) = target_set_fixture::load_windows(&Path::new(&path).with_file_name(&fixture.set.file));
    assert_eq!(file.block, block, "the set file is the request's basis group's");
    let windows_P3HW = Tensor::<4>::from_data(TensorData::new(windows, [dots.len(), 3, WINDOW_SIDE, WINDOW_SIDE]), &device);
    let started = std::time::Instant::now();
    let target = pollster::block_on(TargetSet::prepare(&encoder, &calibration, &frame_DR.transpose(), &fixture.request, windows_P3HW, &dots)).unwrap();
    let seconds = started.elapsed().as_secs_f64();
    let (report, pass) = target_set_fixture::compare_set(&target, &fixture.set);
    let backend = if cfg!(feature = "gpu") { "wgpu" } else { "cpu" };
    println!("{}", serde_json::to_string_pretty(&json!({"fixture": path, "backend": backend, "seconds": seconds, "set": report})).unwrap());
    if !pass {
        std::process::exit(1);
    }
}
