//! A study for the reading step of the set methods: each trained rule grows on the replay grid
//! (seed 9317, the site's live seed) and is read at a ladder of ticks. At each tick it records
//! (a) the run's own loss on that one picture: its method and layers against its prepared set, on
//! the scored region (basis-group mean: the code loss), and (b) the site's reading: the group's
//! selection share and strength over the read patches. It prints one JSON line per tick and writes
//! the picture of every tick, `<name>-tick-0200.png`, for the contact sheet. Evidence only: the
//! page does not use this.
//!
//!   cargo run --release --features harness --example reading_step_study -- --runs <runs.json> --pictures <folder>
//!
//! `runs.json` lists `{name, rule, definition}`: a `rule.json` of grow_recipe_train, and the
//! fixture or run file that gave its direction and set. Assets as in grow_recipe_parity.
#![allow(non_snake_case)] // Tensor suffixes document axes.
#[path = "support/target_set_fixture.rs"]
#[allow(dead_code)] // the study reads the set's windows, not the oracle's record of it
mod target_set_fixture;

use burn::tensor::{Device, Tensor, TensorData};
use dinodreamer_engine::{
    encoder::{Block, DEPTH, Dino, PREFIX, WIDTH},
    grow::figure::{
        self, FigureGrid, FigureRequest, FigureRule, Layer, Method, PATCHES, mean_code_loss, region_features, region_mean_codes,
        target_set::{TargetSet, WINDOW_SIDE},
    },
    kernels::frozen_linear,
    objective::{Calibration, load_frame},
    reader::DictionaryReader,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{env, fs, path::{Path, PathBuf}, time::Instant};

const ENCODER: &str = "dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "monet-dtd-seed9-20261004-pass-003";
const LIVE_SEED: u32 = 9317;
const TICKS: [u32; 11] = [50, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000];

#[derive(Deserialize)]
struct Run {
    name: String,
    rule: PathBuf,
    definition: PathBuf,
}

#[derive(Deserialize)]
struct SavedRule {
    request: FigureRequest,
    values: Vec<f32>,
}

#[derive(Deserialize)]
struct Definition {
    direction: [f32; 3],
    #[serde(default)]
    set: Option<SetReference>,
}

#[derive(Deserialize)]
struct SetReference {
    file: String,
}

fn argument(arguments: &[String], name: &str) -> String {
    let index = arguments.iter().position(|value| value == name).unwrap_or_else(|| panic!("{name} is required"));
    arguments[index + 1].clone()
}

fn write_png(path: &Path, rgba: &[u8]) {
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(fs::File::create(path).unwrap()), 128, 128);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let rgb: Vec<u8> = rgba.chunks_exact(4).flat_map(|pixel| [pixel[0], pixel[1], pixel[2]]).collect();
    encoder.write_header().unwrap().write_image_data(&rgb).unwrap();
}

/// The run's own loss on one picture [1, 3, 128, 128]: the training's terms with one picture in
/// place of the eight views (M = 16 scored tokens from the centre disc).
fn own_loss(encoder: &Dino, calibration: &Calibration, frame_RD: &Tensor<2>, request: &FigureRequest, target: Option<&TargetSet>, picture_1CHW: Tensor<4>) -> f32 {
    let blocks = request.intermediate_blocks();
    let readout = encoder.readout(picture_1CHW, &blocks);
    let native_1TD = readout.native_BTD.slice([0..1, PREFIX..PREFIX + PATCHES, 0..WIDTH]);
    let codes_1TR = frozen_linear(calibration.tokens(native_1TD.clone()), frame_RD.clone());
    let loss = match target {
        None => mean_code_loss(region_mean_codes(codes_1TR, request.start), request.code, request.median_norm),
        Some(target) => {
            let features = request.compared_layers().into_iter().map(|layer| match (request.method, layer) {
                (Method::BasisGroupDistribution, _) => region_features(codes_1TR.clone(), request.start),
                (_, Layer::Final) => region_features(native_1TD.clone(), request.start),
                (_, Layer::Block(block)) => {
                    let position = blocks.iter().position(|&read| read == block).unwrap();
                    region_features(readout.intermediate_BPD[position].clone(), request.start)
                }
            }).collect();
            target.loss(features).value
        }
    };
    pollster::block_on(loss.into_data_async()).unwrap().try_to_vec::<f32>().unwrap()[0]
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let runs_path = PathBuf::from(argument(&arguments, "--runs"));
    let runs: Vec<Run> = serde_json::from_slice(&fs::read(&runs_path).unwrap()).unwrap();
    let pictures = PathBuf::from(argument(&arguments, "--pictures"));
    fs::create_dir_all(&pictures).unwrap();
    let model = PathBuf::from(env::var("DINODREAMER_MODEL").unwrap_or("local/release/model".into()));
    let reader_directory = PathBuf::from(env::var("DINODREAMER_READER").unwrap_or(format!("local/reader-assets/model/{DICTIONARY}")));
    let device = Device::wgpu_options().init().unwrap().autodiff();
    let mut encoder = Dino::load_stem(&fs::read(model.join(ENCODER).join("encoder-stem.safetensors")).unwrap(), &device).unwrap();
    for layer in 0..DEPTH {
        let file = model.join(ENCODER).join(format!("encoder-layer-{layer:02}.safetensors"));
        encoder.blocks.push(Block::load(&fs::read(file).unwrap(), &device).unwrap());
    }
    let dictionary = model.join(DICTIONARY);
    let calibration = Calibration::load(&fs::read(dictionary.join("calibration.safetensors")).unwrap(), &device).unwrap();
    let index: Value = serde_json::from_slice(&fs::read(reader_directory.join("reader.json")).unwrap()).unwrap();
    let mut reader = DictionaryReader::default();
    for file in index["files"].as_array().unwrap() {
        let name = file["path"].as_str().unwrap().rsplit('/').next().unwrap();
        let (first, count) = (file["firstBlock"].as_u64().unwrap() as usize, file["blocks"].as_u64().unwrap() as usize);
        reader.load(first, count, &fs::read(reader_directory.join(name)).unwrap(), &device).unwrap();
    }

    for run in &runs {
        let base = runs_path.parent().unwrap();
        let saved: SavedRule = serde_json::from_slice(&fs::read(base.join(&run.rule)).unwrap()).unwrap();
        let definition_path = base.join(&run.definition);
        let definition: Definition = serde_json::from_slice(&fs::read(&definition_path).unwrap()).unwrap();
        let request = saved.request;
        let frame_RD = load_frame(&fs::read(dictionary.join(format!("blocks/{:05}.safetensors", request.block))).unwrap(), &device).unwrap().transpose();
        let target = definition.set.map(|set| {
            let (windows, dots, _) = target_set_fixture::load_windows(&definition_path.with_file_name(&set.file));
            let windows_P3HW = Tensor::<4>::from_data(TensorData::new(windows, [dots.len(), 3, WINDOW_SIDE, WINDOW_SIDE]), &device);
            pollster::block_on(TargetSet::prepare(&encoder, &calibration, &frame_RD, &request, windows_P3HW, &dots)).unwrap()
        });
        let rule = FigureRule::fixed(request.rule, &saved.values, &device).unwrap();
        let mut grid = FigureGrid::new(LIVE_SEED, request.rule, request.start, &device);
        for tick in TICKS {
            grid.advance(&rule, tick - grid.tick);
            let finite = pollster::block_on(grid.finite()).unwrap();
            if !finite {
                println!("{}", json!({"run": run.name, "tick": tick, "finite": false}));
                continue;
            }
            write_png(&pictures.join(format!("{}-tick-{tick:04}.png", run.name)), &pollster::block_on(grid.rgba()).unwrap());
            let started = Instant::now();
            let loss = own_loss(&encoder, &calibration, &frame_RD, &request, target.as_ref(), grid.picture());
            let loss_seconds = started.elapsed().as_secs_f64();
            let started = Instant::now();
            let reading = pollster::block_on(figure::read(
                &encoder, &calibration, &reader, grid.picture(), request.block, definition.direction, request.median_norm, grid.patches(),
            ))
            .unwrap();
            let reading_seconds = started.elapsed().as_secs_f64();
            println!("{}", json!({
                "run": run.name, "tick": tick, "finite": true, "method": request.method, "ownLoss": loss,
                "selected": reading.winner_fraction, "strength": reading.strength,
                "ownLossSeconds": loss_seconds, "siteReadingSeconds": reading_seconds,
            }));
        }
    }
}
