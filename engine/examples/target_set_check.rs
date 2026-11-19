//! The target set alone against the CPU oracle: the engine prepares a set method's set from the
//! fixture's raw-pixel windows (one DINO pass, the 3 × 3 tokens, the standardization and the kernel)
//! and compares it with the oracle's record (`support/target_set_fixture.rs`). It runs on either
//! build, so the set is checked on the CPU too:
//!
//!   cargo run --release --no-default-features --features cpu --example target_set_check -- \
//!       tools/fixtures/grow-recipe-oracle-12002-pyramid-seeded-token-distribution-batch4.json
//!   cargo run --release --features harness --example target_set_check -- <the same fixture>
//!
//! For the basis-group distribution fixture it also prepares token-method sets from the same windows:
//! every method keeps the same codes of its tokens (`TargetSet::codes_NR`), so they must be identical.
//! Assets as in grow_recipe_parity. It prints one JSON report and exits 1 when the set differs.
#![allow(non_snake_case)] // Tensor suffixes document axes.
#[path = "support/target_set_fixture.rs"]
mod target_set_fixture;

use burn::tensor::{Device, Tensor, TensorData};
use dinodreamer_engine::{
    calibration::{Calibration, load_frame},
    encoder::{Block, DEPTH, Dino},
    grow::figure::{FigureRequest, Layer, Method, target_set::{TargetSet, WINDOW_SIDE}},
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
    let prepare = |request: &FigureRequest| {
        let windows_PCHW = Tensor::<4>::from_data(TensorData::new(windows.clone(), [dots.len(), 3, WINDOW_SIDE, WINDOW_SIDE]), &device);
        pollster::block_on(TargetSet::prepare(&encoder, &calibration, &frame_DR.clone().transpose(), request, windows_PCHW, &dots)).unwrap()
    };
    let started = std::time::Instant::now();
    let target = prepare(&fixture.request);
    let seconds = started.elapsed().as_secs_f64();
    let (report, mut pass) = target_set_fixture::compare_set(&target, &fixture.set);
    let mut same_codes = None;
    if fixture.request.method == Method::BasisGroupDistribution {
        let token_methods = [(Method::TokenDistribution, vec![Layer::Final]), (Method::TokenMean, vec![Layer::Block(3), Layer::Final])];
        let identical = token_methods.into_iter().all(|(method, layers)| {
            let other = prepare(&FigureRequest { method, layers, ..fixture.request.clone() });
            other.codes_NR == target.codes_NR && other.pictures_N == target.pictures_N
        });
        pass &= identical;
        same_codes = Some(identical);
    }
    let backend = if cfg!(feature = "gpu") { "wgpu" } else { "cpu" };
    println!("{}", serde_json::to_string_pretty(&json!({"fixture": path, "backend": backend, "seconds": seconds, "set": report,
        "tokenMethodsKeepTheSameCodes": same_codes, "pass": pass})).unwrap());
    if !pass {
        std::process::exit(1);
    }
}
