//! Gate G1 and measurement M1 of runs continued
//! from a saved definition, native on the GPU.
//!
//! For each saved definition, the run it came from is trained again from its random initialization
//! (the definition's request, seed and batch) to the definition's update K, and its state is kept:
//! the rule, Adam's moments and corrections, and the pool. Then:
//!   G1: a run continued from that rule with that optimizer state and that pool equals the original run
//!       bit for bit `--g1-updates` later (default 50): the continuation's indexing of the plans, the
//!       firing and the learning rate is the original's.
//!   M1: runs continued from that rule with a fresh pool train to update 1,000 beside the original:
//!       A a fresh Adam, C the original's moments and corrections. Every 25 updates and at 1,000 the
//!       rule grows on a replay grid (seed 9317) to steps 600 and 2,000 and is measured; the first 50
//!       losses after K are kept.
//!
//!   cargo run --release --features harness --example grow_continue_check -- <definition.material.json> ... \
//!       [--g1-updates 50] [--g1-only] [--out report.json]
//!
//! Model and reader as grow_recipe_train (DINODREAMER_MODEL, DINODREAMER_READER).
#![allow(non_snake_case)] // Tensor suffixes document axes.
use burn::tensor::Device;
use dinodreamer_engine::{
    encoder::{Block, DEPTH, Dino},
    grow::figure::{self, FigureGrid, FigureRequest, FigureRule, FigureTraining, RuleKind, Start, UPDATES},
    objective::{Calibration, load_frame},
    reader::DictionaryReader,
};
use serde_json::{Value, json};
use std::{env, fs, path::PathBuf};

const ENCODER: &str = "dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "monet-dtd-seed9-20261004-pass-003";
/// The replay grid Train measures on, and its two measured steps.
const LIVE_SEED: u32 = 9317;
const READING_TICKS: [u32; 2] = [600, 2000];
const CHECKPOINT_EVERY: u32 = 25;
const LOSSES_KEPT: u32 = 50;

fn option(arguments: &[String], name: &str) -> Option<String> {
    arguments.iter().position(|value| value == name).map(|index| arguments[index + 1].clone())
}

struct Models {
    encoder: Dino,
    calibration: Calibration,
    reader: DictionaryReader,
    model: PathBuf,
    device: Device,
}

/// The definition's request as Train sends it, with its training seed and batch, its update count
/// and its measurement direction (the training target's, k/|k|).
fn definition(file: &Value) -> (FigureRequest, u32, [f32; 3]) {
    let code: Vec<f32> = file["anchor"]["code"].as_array().unwrap().iter().map(|value| value.as_f64().unwrap() as f32).collect();
    let length = code.iter().map(|value| value * value).sum::<f32>().sqrt();
    let rule = if file["rule"]["layout"].as_str().unwrap().contains("pyramid") { RuleKind::Pyramid } else { RuleKind::Cell };
    let start = if file["start"]["kind"] == "centre-disc" { Start::CentreDisc } else { Start::Noise };
    let request = FigureRequest {
        block: file["block"].as_u64().unwrap() as u32,
        code: [code[0], code[1], code[2]],
        median_norm: file["recipe"]["settings"]["medianNorm"].as_f64().unwrap() as f32,
        seed: file["training"]["seed"].as_u64().unwrap() as u32,
        batch: file["recipe"]["settings"]["batch"].as_u64().unwrap() as usize,
        rule,
        start,
    };
    (request, file["training"]["updates"].as_u64().unwrap() as u32, [code[0] / length, code[1] / length, code[2] / length])
}

/// The rule grown on the replay grid to steps 600 and 2,000 and measured at each.
fn measure(models: &Models, training: &FigureTraining, direction: [f32; 3]) -> Value {
    let request = &training.request;
    let values = pollster::block_on(training.rule.values()).unwrap();
    let rule = FigureRule::fixed(request.rule, &values, &models.device).unwrap();
    let mut grid = FigureGrid::new(LIVE_SEED, request.rule, request.start, &models.device);
    let mut readings = Vec::new();
    for tick in READING_TICKS {
        grid.advance(&rule, tick - grid.tick);
        let finite = pollster::block_on(grid.finite()).unwrap();
        let reading = finite.then(|| {
            pollster::block_on(figure::read(&models.encoder, &models.calibration, &models.reader, grid.picture(), request.block,
                direction, request.median_norm, grid.patches()))
            .unwrap()
        });
        readings.push(json!({"tick": tick, "finite": finite,
            "strength": reading.as_ref().map(|r| r.strength), "winnerFraction": reading.as_ref().map(|r| r.winner_fraction)}));
    }
    json!({"update": training.completed(), "readings": readings})
}

/// Train to `until`, measuring every CHECKPOINT_EVERY updates and keeping the first LOSSES_KEPT losses.
fn train_to(models: &Models, training: &mut FigureTraining, until: u32, direction: [f32; 3]) -> (Vec<Value>, Vec<f32>) {
    let (mut checkpoints, mut losses) = (Vec::new(), Vec::new());
    let first = training.completed();
    while training.completed() < until {
        let update = pollster::block_on(training.update(&models.encoder, &models.calibration)).unwrap();
        if update.completed - first <= LOSSES_KEPT {
            losses.push(update.loss);
        }
        if update.completed % CHECKPOINT_EVERY == 0 || update.completed == until {
            checkpoints.push(measure(models, training, direction));
        }
    }
    (checkpoints, losses)
}

fn frame(models: &Models, block: u32) -> burn::tensor::Tensor<2> {
    load_frame(&fs::read(models.model.join(DICTIONARY).join(format!("blocks/{block:05}.safetensors"))).unwrap(), &models.device).unwrap()
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let g1_updates: u32 = option(&arguments, "--g1-updates").map_or(50, |value| value.parse().unwrap());
    let g1_only = arguments.iter().any(|value| value == "--g1-only");
    let out = option(&arguments, "--out");
    let valued = ["--g1-updates", "--out"];
    let files: Vec<&String> = arguments
        .iter()
        .enumerate()
        .filter(|(index, value)| !value.starts_with("--") && (*index == 0 || !valued.contains(&arguments[index - 1].as_str())))
        .map(|(_, value)| value)
        .collect();
    let model = PathBuf::from(env::var("DINODREAMER_MODEL").unwrap_or("local/release/model".into()));
    let reader_directory =
        PathBuf::from(env::var("DINODREAMER_READER").unwrap_or(format!("local/reader-assets/model/{DICTIONARY}")));

    let device = Device::wgpu_options().init().unwrap().autodiff();
    let mut encoder = Dino::load_stem(&fs::read(model.join(ENCODER).join("encoder-stem.safetensors")).unwrap(), &device).unwrap();
    for layer in 0..DEPTH {
        let path = model.join(ENCODER).join(format!("encoder-layer-{layer:02}.safetensors"));
        encoder.blocks.push(Block::load(&fs::read(path).unwrap(), &device).unwrap());
    }
    let calibration = Calibration::load(&fs::read(model.join(DICTIONARY).join("calibration.safetensors")).unwrap(), &device).unwrap();
    let index: Value = serde_json::from_slice(&fs::read(reader_directory.join("reader.json")).unwrap()).unwrap();
    let mut reader = DictionaryReader::default();
    for file in index["files"].as_array().unwrap() {
        let name = file["path"].as_str().unwrap().rsplit('/').next().unwrap();
        let (first, count) = (file["firstBlock"].as_u64().unwrap() as usize, file["blocks"].as_u64().unwrap() as usize);
        reader.load(first, count, &fs::read(reader_directory.join(name)).unwrap(), &device).unwrap();
    }
    let models = Models { encoder, calibration, reader, model, device };

    let mut report = Vec::new();
    let mut g1_passed = true;
    for path in files {
        let file: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let (request, from, direction) = definition(&file);
        let name = PathBuf::from(path).file_name().unwrap().to_string_lossy().to_string();
        let started = std::time::Instant::now();
        let mut original = FigureTraining::new(request.clone(), frame(&models, request.block), models.device.clone()).unwrap();
        train_to(&models, &mut original, from, direction);
        let values = pollster::block_on(original.rule.values()).unwrap();
        let (adam, pool) = (original.optimizer_state(), original.pool_states());

        // G1: the original's optimizer state and pool carried into a continued run.
        let mut exact = FigureTraining::continued(request.clone(), &values, from, frame(&models, request.block), models.device.clone()).unwrap();
        exact.set_optimizer_state(adam.clone());
        exact.set_pool_states(pool);
        let continued_measure = train_to(&models, &mut exact, from + g1_updates, direction).0;
        let (original_g1, original_g1_losses) = train_to(&models, &mut original, from + g1_updates, direction);
        let exact_values = pollster::block_on(exact.rule.values()).unwrap();
        let original_values = pollster::block_on(original.rule.values()).unwrap();
        let identical = exact_values.iter().zip(&original_values).all(|(a, b)| a.to_bits() == b.to_bits());
        g1_passed &= identical;
        println!("{} G1 {name}: continued from update {from} with the original's optimizer and pool, {g1_updates} updates later the rule is {}",
            if identical { "PASS" } else { "FAIL" }, if identical { "bit for bit the original's" } else { "not the original's" });
        drop(exact);
        let mut row = json!({"definition": name, "block": request.block, "from": from, "g1": {"updates": g1_updates, "identical": identical,
            "continued": continued_measure.last(), "original": original_g1.last()}});

        if !g1_only {
            // M1: the original to 1,000, then the continued arms from its rule at `from`, each with a fresh pool.
            // The original's first losses after `from` came with G1; its checkpoints go on from there.
            let (rest, _) = train_to(&models, &mut original, UPDATES, direction);
            let original_checkpoints: Vec<Value> = original_g1.iter().cloned().chain(rest).collect();
            let original_losses = original_g1_losses;
            drop(original);
            let mut arms = serde_json::Map::new();
            for arm in ["fresh", "stored moments"] {
                let mut run = FigureTraining::continued(request.clone(), &values, from, frame(&models, request.block), models.device.clone()).unwrap();
                if arm == "stored moments" {
                    run.set_optimizer_state(adam.clone());
                }
                let (checkpoints, losses) = train_to(&models, &mut run, UPDATES, direction);
                println!("M1 {name} {arm}: at 1,000 {}", checkpoints.last().map(|value| value["readings"].to_string()).unwrap_or_default());
                arms.insert(arm.into(), json!({"checkpoints": checkpoints, "losses": losses}));
            }
            row["m1"] = json!({"original": {"checkpoints": original_checkpoints, "losses": original_losses}, "arms": arms});
        }
        row["seconds"] = json!(started.elapsed().as_secs_f64());
        report.push(row);
        if let Some(out) = &out {
            fs::write(out, serde_json::to_string_pretty(&json!({"definitions": report})).unwrap() + "\n").unwrap();
        }
    }
    if !g1_passed {
        drop(_lock);
        std::process::exit(1);
    }
}
