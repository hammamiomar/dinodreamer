//! Train the figure recipe natively and read the rule as Grow does: one JSON line per update
//! (loss terms, largest |state|, training-view pole) and, every `--read-every` updates, the
//! replay grid's strength and winner fraction after 64 and 600 ticks (seed 9317).
//!
//!   cargo run --release --features harness --example grow_recipe_train -- \
//!       --fixture tools/fixtures/grow-recipe-oracle-12002-batch4.json --seed 1 --updates 300
//!
//! The request (block, k, m, batch, rule, start) and the readout axis come from a parity
//! fixture; `--seed` and `--batch` override it. Assets as in grow_recipe_parity.
#![allow(non_snake_case)] // Tensor suffixes document axes.
use burn::tensor::Device;
use dinodreamer_engine::{
    encoder::{Block, DEPTH, Dino},
    grow::figure::{self, FigureGrid, FigureRequest, FigureRule, FigureTraining},
    objective::{Calibration, load_frame},
    reader::DictionaryReader,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{env, fs, path::PathBuf};

const ENCODER: &str = "dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "monet-dtd-seed9-20261004-pass-003";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    request: FigureRequest,
    direction: [f32; 3],
}

fn argument(arguments: &[String], name: &str) -> Option<String> {
    arguments.iter().position(|value| value == name).map(|index| arguments[index + 1].clone())
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let fixture: Fixture =
        serde_json::from_slice(&fs::read(argument(&arguments, "--fixture").expect("--fixture <parity fixture>")).unwrap()).unwrap();
    let mut request = fixture.request.clone();
    if let Some(seed) = argument(&arguments, "--seed") {
        request.seed = seed.parse().unwrap();
    }
    if let Some(batch) = argument(&arguments, "--batch") {
        request.batch = batch.parse().unwrap();
    }
    let updates: u32 = argument(&arguments, "--updates").map_or(1000, |value| value.parse().unwrap());
    let read_every: u32 = argument(&arguments, "--read-every").map_or(100, |value| value.parse().unwrap());
    let model = PathBuf::from(env::var("DINODREAMER_MODEL").unwrap_or("local/release/model".into()));
    let reader_directory = PathBuf::from(
        env::var("DINODREAMER_READER").unwrap_or(format!("local/reader-assets/model/{DICTIONARY}")),
    );

    let device = Device::wgpu_options().init().unwrap().autodiff();
    let mut encoder = Dino::load_stem(&fs::read(model.join(ENCODER).join("encoder-stem.safetensors")).unwrap(), &device).unwrap();
    for layer in 0..DEPTH {
        let path = model.join(ENCODER).join(format!("encoder-layer-{layer:02}.safetensors"));
        encoder.blocks.push(Block::load(&fs::read(path).unwrap(), &device).unwrap());
    }
    let dictionary = model.join(DICTIONARY);
    let calibration = Calibration::load(&fs::read(dictionary.join("calibration.safetensors")).unwrap(), &device).unwrap();
    let frame_DR =
        load_frame(&fs::read(dictionary.join(format!("blocks/{:05}.safetensors", request.block))).unwrap(), &device).unwrap();
    let index: Value = serde_json::from_slice(&fs::read(reader_directory.join("reader.json")).unwrap()).unwrap();
    let mut reader = DictionaryReader::default();
    for file in index["files"].as_array().unwrap() {
        let name = file["path"].as_str().unwrap().rsplit('/').next().unwrap();
        let (first, count) = (file["firstBlock"].as_u64().unwrap() as usize, file["blocks"].as_u64().unwrap() as usize);
        reader.load(first, count, &fs::read(reader_directory.join(name)).unwrap(), &device).unwrap();
    }

    let direction = fixture.direction;
    let pole = |codes: &[f32]| {
        let views = codes.len() / 3;
        codes.chunks_exact(3).map(|code| code.iter().zip(direction).map(|(a, b)| a * b).sum::<f32>()).sum::<f32>()
            / (views as f32 * request.median_norm)
    };
    let mut training = FigureTraining::new(request.clone(), frame_DR, device.clone()).unwrap();
    let started = std::time::Instant::now();
    for _ in 0..updates {
        let update = pollster::block_on(training.update(&encoder, &calibration)).unwrap();
        println!("{}", json!({
            "update": update.completed - 1, "loss": update.loss, "codeLoss": update.code_loss, "overflow": update.overflow,
            "stateMax": update.state_max, "pictureContrast": update.picture_contrast, "pole": pole(&update.mean_codes),
            "learningRate": update.learning_rate,
            "steps": update.plan.steps, "seconds": started.elapsed().as_secs_f64(),
        }));
        if update.completed % read_every == 0 || update.completed == updates {
            let values = pollster::block_on(training.rule.values()).unwrap();
            let rule = FigureRule::fixed(request.rule, &values, &device).unwrap();
            let mut readings = Vec::new();
            let mut grid = FigureGrid::new(9317, request.rule, request.start, &device);
            for ticks in [64, 600] {
                grid.advance(&rule, ticks - grid.tick);
                let reading = pollster::block_on(figure::read(
                    &encoder, &calibration, &reader, grid.picture(), request.block, direction, request.median_norm, grid.patches(),
                ))
                .unwrap();
                readings.push(json!({"ticks": ticks, "strength": reading.strength, "winnerFraction": reading.winner_fraction}));
            }
            println!("{}", json!({"reading": update.completed, "seed": request.seed, "readings": readings}));
        }
    }
}
