//! A paired measurement of the time per update of each method against basis-group mean matching.
//! One process loads DINO once, prepares each set method's set (twice: the first preparation
//! compiles the kernels), and trains one run per fixture from the same seed. The runs take turns,
//! `--updates` updates each per round, for `--rounds` rounds; the first round is warm-up. Every run
//! draws the same plan at the same update index, so the rollout lengths are paired.
//! Each update reads its terms back, as the app's worker does.
//!
//!   cargo run --release --features harness --example set_methods_timing -- --rounds 6 --updates 10 \
//!       tools/fixtures/grow-recipe-oracle-12002-pyramid-seeded-batch4.json <set-method fixtures>...
//!
//! The first fixture is the reference. It prints one JSON report: per run the median time per
//! update, the median of the per-index ratios to the reference, and the set's preparation time.
//! Assets as in grow_recipe_parity.
#![allow(non_snake_case)] // Tensor suffixes document axes.
#[path = "support/target_set_fixture.rs"]
#[allow(dead_code)] // the measurement reads the set's windows, not the oracle's record of it
mod target_set_fixture;

use burn::tensor::{Device, Tensor, TensorData};
use dinodreamer_engine::{
    encoder::{Block, DEPTH, Dino},
    grow::figure::{FigureRequest, FigureTraining, target_set::{TargetSet, WINDOW_SIDE}},
    objective::{Calibration, load_frame},
};
use serde::Deserialize;
use serde_json::json;
use std::{env, fs, path::{Path, PathBuf}, time::Instant};

const ENCODER: &str = "dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "monet-dtd-seed9-20261004-pass-003";

#[derive(Deserialize)]
struct Fixture {
    request: FigureRequest,
    #[serde(default)]
    set: Option<target_set_fixture::SetRecord>,
}

fn argument(arguments: &[String], name: &str) -> Option<String> {
    arguments.iter().position(|value| value == name).map(|index| arguments[index + 1].clone())
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let rounds: usize = argument(&arguments, "--rounds").map_or(6, |value| value.parse().unwrap());
    let updates: usize = argument(&arguments, "--updates").map_or(10, |value| value.parse().unwrap());
    let paths: Vec<String> = arguments.iter().filter(|value| value.ends_with(".json")).cloned().collect();
    let model = PathBuf::from(env::var("DINODREAMER_MODEL").unwrap_or("local/release/model".into()));
    let device = Device::wgpu_options().init().unwrap().autodiff();
    let mut encoder = Dino::load_stem(&fs::read(model.join(ENCODER).join("encoder-stem.safetensors")).unwrap(), &device).unwrap();
    for layer in 0..DEPTH {
        let file = model.join(ENCODER).join(format!("encoder-layer-{layer:02}.safetensors"));
        encoder.blocks.push(Block::load(&fs::read(file).unwrap(), &device).unwrap());
    }
    let dictionary = model.join(DICTIONARY);
    let calibration = Calibration::load(&fs::read(dictionary.join("calibration.safetensors")).unwrap(), &device).unwrap();

    let mut runs = Vec::new();
    for path in &paths {
        let fixture: Fixture = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let request = fixture.request;
        let frame_DR = load_frame(&fs::read(dictionary.join(format!("blocks/{:05}.safetensors", request.block))).unwrap(), &device).unwrap();
        let mut preparation_seconds = Vec::new();
        let mut target = None;
        if let Some(record) = &fixture.set {
            let (windows, dots, _) = target_set_fixture::load_windows(&Path::new(path).with_file_name(&record.file));
            for _ in 0..2 {
                let windows_P3HW = Tensor::<4>::from_data(TensorData::new(windows.clone(), [dots.len(), 3, WINDOW_SIDE, WINDOW_SIDE]), &device);
                let started = Instant::now();
                target = Some(pollster::block_on(TargetSet::prepare(&encoder, &calibration, &frame_DR.clone().transpose(), &request, windows_P3HW, &dots)).unwrap());
                preparation_seconds.push(started.elapsed().as_secs_f64());
            }
        }
        let training = FigureTraining::new(request.clone(), target, frame_DR, device.clone()).unwrap();
        runs.push((path.clone(), request, training, preparation_seconds, Vec::<f64>::new()));
    }
    for round in 0..rounds {
        for (_, _, training, _, seconds) in runs.iter_mut() {
            for _ in 0..updates {
                let started = Instant::now();
                pollster::block_on(training.update(&encoder, &calibration)).unwrap();
                if round > 0 {
                    seconds.push(started.elapsed().as_secs_f64());
                }
            }
        }
    }
    let reference = runs[0].4.clone();
    let report: Vec<_> = runs.iter().map(|(path, request, _, preparation, seconds)| {
        let mut ratios: Vec<f64> = seconds.iter().zip(&reference).map(|(time, base)| time / base).collect();
        json!({
            "fixture": path,
            "method": request.method,
            "layers": request.layers,
            "medianSecondsPerUpdate": median(&mut seconds.clone()),
            "medianRatioToReference": median(&mut ratios),
            "updatesMeasured": seconds.len(),
            "preparationSeconds": preparation,
        })
    }).collect();
    println!("{}", serde_json::to_string_pretty(&json!({"rounds": rounds, "updatesPerRound": updates, "runs": report})).unwrap());
}
