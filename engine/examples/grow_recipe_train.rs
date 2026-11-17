//! Train the figure recipe natively and read the rule as Grow does: one JSON line per update
//! (loss terms, largest |state|, training-view pole) and, every `--read-every` updates, the
//! replay grid's strength and winner fraction after `--ticks` ticks (64 and 600 by default, seed 9317).
//!
//!   cargo run --release --features harness --example grow_recipe_train -- \
//!       --fixture tools/fixtures/grow-recipe-oracle-12002-batch4.json --seed 1 --updates 300
//!
//! The request (block, k, m, batch, rule, start, method and layers) and the readout axis come from
//! a parity fixture; `--seed` and `--batch` override it. A set method's fixture names its set's
//! windows, which the engine prepares first. `--pictures <folder>` writes the replay grid's picture
//! at each read tick as `update-0100-tick-0600.png`, and the final rule as `rule.json`. Assets as in
//! grow_recipe_parity.
#![allow(non_snake_case)] // Tensor suffixes document axes.
#[path = "support/target_set_fixture.rs"]
#[allow(dead_code)] // the training reads the set's windows, not the oracle's record of it
mod target_set_fixture;

use burn::tensor::{Device, Tensor, TensorData};
use dinodreamer_engine::{
    encoder::{Block, DEPTH, Dino},
    grow::figure::{self, FigureGrid, FigureRequest, FigureRule, FigureTraining, target_set::{TargetSet, WINDOW_SIDE}},
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
    #[serde(default)]
    set: Option<target_set_fixture::SetRecord>,
}

/// An opaque RGBA picture as an 8-bit RGB PNG.
fn write_png(path: &std::path::Path, rgba: &[u8], side: u32) {
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(fs::File::create(path).unwrap()), side, side);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let rgb: Vec<u8> = rgba.chunks_exact(4).flat_map(|pixel| [pixel[0], pixel[1], pixel[2]]).collect();
    encoder.write_header().unwrap().write_image_data(&rgb).unwrap();
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
    let ticks: Vec<u32> = argument(&arguments, "--ticks").map_or(vec![64, 600], |value| value.split(',').map(|tick| tick.parse().unwrap()).collect());
    let pictures = argument(&arguments, "--pictures").map(PathBuf::from);
    if let Some(folder) = &pictures {
        fs::create_dir_all(folder).unwrap();
    }
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
    let target = fixture.set.as_ref().map(|record| {
        let fixture_path = PathBuf::from(argument(&arguments, "--fixture").unwrap());
        let (windows, dots, _) = target_set_fixture::load_windows(&fixture_path.with_file_name(&record.file));
        let windows_P3HW = Tensor::<4>::from_data(TensorData::new(windows, [dots.len(), 3, WINDOW_SIDE, WINDOW_SIDE]), &device);
        let frame_RD = frame_DR.clone().transpose();
        pollster::block_on(TargetSet::prepare(&encoder, &calibration, &frame_RD, &request, windows_P3HW, &dots)).unwrap()
    });
    let mut training = FigureTraining::new(request.clone(), target, frame_DR, device.clone()).unwrap();
    let started = std::time::Instant::now();
    for _ in 0..updates {
        let update = pollster::block_on(training.update(&encoder, &calibration)).unwrap();
        println!("{}", json!({
            "update": update.completed - 1, "loss": update.loss, "methodLoss": update.method_loss, "layers": update.layers,
            "codeLoss": update.code_loss, "overflow": update.overflow,
            "stateMax": update.state_max, "pictureContrast": update.picture_contrast, "pole": pole(&update.mean_codes),
            "learningRate": update.learning_rate,
            "steps": update.plan.steps, "seconds": started.elapsed().as_secs_f64(),
            "usedBytes": device.memory_pool_usage().map(|usage| usage.bytes_in_use),
            "reservedBytes": device.memory_pool_usage().map(|usage| usage.bytes_reserved),
        }));
        if update.completed % read_every == 0 || update.completed == updates {
            let values = pollster::block_on(training.rule.values()).unwrap();
            let rule = FigureRule::fixed(request.rule, &values, &device).unwrap();
            let mut readings = Vec::new();
            let mut grid = FigureGrid::new(9317, request.rule, request.start, &device);
            for &ticks in &ticks {
                grid.advance(&rule, ticks - grid.tick);
                if let Some(folder) = &pictures {
                    let rgba = pollster::block_on(grid.rgba()).unwrap();
                    write_png(&folder.join(format!("update-{:04}-tick-{ticks:04}.png", update.completed)), &rgba, 128);
                }
                let reading = pollster::block_on(figure::read(
                    &encoder, &calibration, &reader, grid.picture(), request.block, direction, request.median_norm, grid.patches(),
                ))
                .unwrap();
                readings.push(json!({"ticks": ticks, "strength": reading.strength, "winnerFraction": reading.winner_fraction}));
            }
            println!("{}", json!({"reading": update.completed, "seed": request.seed, "readings": readings}));
        }
    }
    if let Some(folder) = &pictures {
        let values = pollster::block_on(training.rule.values()).unwrap();
        let rule = json!({"request": request, "updates": training.completed(), "values": values});
        fs::write(folder.join("rule.json"), rule.to_string()).unwrap();
    }
}
