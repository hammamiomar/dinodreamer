//! Figure-recipe parity against the CPU oracle (`tools/prepare_grow_recipe.py`). The engine
//! trains from the oracle's request and seed, then compares every recorded update: the drawn
//! plan, loss terms, per-view mean codes, grown states, normalized gradients and parameters,
//! and finally the live grid's picture and readouts. It prints one JSON report. For a set method
//! the engine first prepares the target set from the fixture's raw-pixel windows and compares it
//! with the oracle's (`support/target_set_fixture.rs`); the update's terms include the method's
//! loss and each compared layer's terms.
//!
//!   cargo run --release --features harness --example grow_recipe_parity -- \
//!       tools/fixtures/grow-recipe-oracle-12002-batch4.json [report.json]
//!
//! Assets: `local/release/model` (encoder and dictionary blocks) and
//! `local/reader-assets/model/monet-dtd-seed9-20261004-pass-003` (the reader's frames), or
//! the directories in DINODREAMER_MODEL and DINODREAMER_READER.
//!
//! Gate: every plan must match exactly, and update 0 must match the reference at the
//! tolerances below. Update 0's states are the drawn noise, so it isolates the draws, the
//! picture, the views, DINO at 128 px, the loss and the backward pass. Later updates are
//! reported, not gated: Adam's first steps move every parameter by about the learning rate
//! times the sign of its gradient, so a gradient element near zero can flip and the
//! trajectories then separate.
#![allow(non_snake_case)] // Tensor suffixes document axes.
#[path = "support/target_set_fixture.rs"]
mod target_set_fixture;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use burn::tensor::{Device, Tensor, TensorData};
use dinodreamer_engine::{
    calibration::{Calibration, load_frame},
    encoder::{Block, DEPTH, Dino},
    grow::figure::{
        self, Cells, FigureGrid, FigureReadings, FigureRequest, FigureRule, FigureTraining, Layer,
        LayerLoss, Plan, ReadTarget,
        target_set::{TargetSet, WINDOW_SIDE},
    },
    reader::DictionaryReader,
};
use target_set_fixture::{SetRecord, compare_set, load_windows};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

const ENCODER: &str = "dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "monet-dtd-seed9-20261004-pass-003";
/// A continued record's grown states after its first rollout, largest absolute difference: float32
/// rounding of the trained rule's steps (5.4e-7 measured on block 12002).
const GROWN_TOLERANCE: f64 = 1e-5;
/// Update-0 tolerances: relative error of the loss terms (also a set method's loss and layer
/// terms), relative RMS of the mean codes and of the normalized gradients. The grown states of update 0 are the drawn noise: exact.
const LOSS_TOLERANCE: f64 = 1e-4;
const CODES_TOLERANCE: f64 = 1e-3;
/// The gradient tolerance is this multiple of the fixture's `gradientFloor`: the reference's own
/// float32 error against float64 at update 0 (relative RMS of the normalized gradient, same
/// draws). The floor varies 16-fold over the fixtures (4.4e-4 to 7.2e-3), so one
/// constant does not fit every kind. Two float32 results with independent rounding differ by
/// about √2 floors; the engine's GPU sums and attention may be up to twice as noisy as torch's
/// CPU float32, so the tolerance is 3 floors. Structural errors show at 1e-1 and above.
const GRADIENT_FLOOR_FACTOR: f64 = 3.0;
/// Readout tolerances after up to 600 replayed ticks, where float differences can change some
/// display bytes: strength in units of m, and the winner fraction by at most one read patch.
const STRENGTH_TOLERANCE: f64 = 0.01;
/// The mean of the reading's per-patch codes (`FigureReading::codes_TR`) over the read patches,
/// against the oracle's: `‖difference‖` in units of `m`, the strength's scale.
const MEAN_CODE_TOLERANCE: f64 = 0.01;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    request: FigureRequest,
    direction: [f32; 3],
    initial_values: String,
    /// A continued run's first update, trained from `initial_values` with a fresh Adam and pool.
    #[serde(default)]
    from_update: Option<u32>,
    gradient_floor: f64,
    /// A set method's prepared set, from the windows of `set.file` beside the fixture.
    #[serde(default)]
    set: Option<SetRecord>,
    #[serde(default)]
    updates: Vec<Record>,
    /// Large fixtures store each update beside the fixture to keep every file below 1 MB.
    #[serde(default)]
    update_files: Vec<PathBuf>,
    /// Optional: updates repeated from the reference's own parameters and initial states.
    #[serde(default)]
    lockstep: Vec<Lockstep>,
    readings: Vec<Reading>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Lockstep {
    update: u32,
    plan: Plan,
    values: String,
    initial: String,
    /// The pyramid's coarse grids, in the engine's layout.
    #[serde(default)]
    initial_coarse: Option<String>,
    loss: f64,
    #[serde(default)]
    method_loss: Option<f64>,
    #[serde(default)]
    layer_terms: Vec<LayerTermsRecord>,
    mean_codes: Vec<f64>,
    grown_sample: String,
    #[serde(default)]
    grown_coarse_sample: Option<String>,
    gradients: String,
}

/// A compared layer's value and, for a distribution method, its kernel means E k(x, x') and E k(x, y).
#[derive(Deserialize)]
struct LayerTermsRecord {
    layer: Layer,
    value: f64,
    #[serde(default)]
    xx: Option<f64>,
    #[serde(default)]
    xy: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    update: u32,
    plan: Plan,
    learning_rate: f64,
    loss: f64,
    code_loss: f64,
    #[serde(default)]
    method_loss: Option<f64>,
    #[serde(default)]
    layer_terms: Vec<LayerTermsRecord>,
    overflow: f64,
    state_max: f64,
    mean_codes: Vec<f64>,
    grown_sample: String,
    /// Every 257th value of the pyramid's grown coarse grids.
    #[serde(default)]
    grown_coarse_sample: Option<String>,
    grown_norm: f64,
    gradients: String,
    values: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reading {
    rule: String,
    values: String,
    seed: u32,
    ticks: u32,
    strength: f64,
    winner_fraction: f64,
    /// The mean code over the read patches.
    mean_code: [f64; 3],
    levels: String,
}

fn load_fixture(path: &Path) -> Fixture {
    let mut fixture: Fixture = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    if !fixture.update_files.is_empty() {
        assert!(fixture.updates.is_empty(), "use inline updates or update files, not both");
        fixture.updates = fixture.update_files.iter()
            .map(|file| {
                let path = path.parent().unwrap().join(file);
                serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
            })
            .collect();
    }
    assert!(!fixture.updates.is_empty(), "the fixture must record at least one update");
    fixture
}

fn floats(encoded: &str) -> Vec<f32> {
    STANDARD
        .decode(encoded)
        .expect("base64 float32 values")
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
        .collect()
}

async fn read(tensor: Tensor<1>) -> Vec<f32> {
    tensor.into_data_async().await.unwrap().try_to_vec::<f32>().unwrap()
}

/// Relative RMS error, largest absolute error, and the share of values within `close` of the reference.
fn compare(actual: &[f32], expected: &[f32], close: f32) -> Value {
    assert_eq!(actual.len(), expected.len(), "compared arrays differ in length");
    let (mut error, mut norm) = (0.0f64, 0.0f64);
    let mut largest = 0.0f32;
    let mut within = 0usize;
    for (a, e) in actual.iter().zip(expected) {
        error += (*a as f64 - *e as f64).powi(2);
        norm += (*e as f64).powi(2);
        largest = largest.max((a - e).abs());
        within += usize::from((a - e).abs() <= close);
    }
    json!({
        "relativeRms": (error / norm.max(1e-30)).sqrt(),
        "maximumAbsolute": largest,
        "withinShare": within as f64 / actual.len() as f64,
        "close": close,
        "values": actual.len(),
    })
}

/// The grown fine grids and, for the pyramid, the coarse grids, flattened in the engine's layout.
fn grown_values(grown: &Cells) -> (Vec<f32>, Option<Vec<f32>>) {
    let fine = pollster::block_on(read(grown.fine_1NC.clone().flatten(0, 2)));
    let coarse = grown.coarse_1MC.clone().map(|coarse| pollster::block_on(read(coarse.flatten(0, 2))));
    (fine, coarse)
}

/// Every 257th value; 257 shares no factor with the 16 channels or the grid rows, so every
/// channel and column is sampled.
fn sample(values: &[f32]) -> Vec<f32> {
    values.iter().step_by(257).copied().collect()
}

/// The coarse sample's comparison, when the fixture has the pyramid's coarse grids.
fn compare_coarse(coarse: &Option<Vec<f32>>, expected: &Option<String>) -> Value {
    match (coarse, expected) {
        (Some(coarse), Some(expected)) => compare(&sample(coarse), &floats(expected), 1e-5),
        (None, None) => Value::Null,
        _ => panic!("the fixture and the engine disagree on the pyramid's coarse grid"),
    }
}

fn relative(actual: f64, expected: f64) -> f64 {
    (actual - expected).abs() / expected.abs().max(1e-12)
}

/// Each compared layer's terms against the oracle's: [engine, oracle, relative error] per term,
/// and the largest relative error.
fn compare_layers(actual: &[LayerLoss], expected: &[LayerTermsRecord]) -> (Value, f64) {
    assert_eq!(actual.len(), expected.len(), "the engine and the oracle compare the same layers");
    let mut largest = 0.0f64;
    let mut term = |engine: Option<f32>, oracle: Option<f64>| match (engine, oracle) {
        (Some(engine), Some(oracle)) => {
            let error = relative(engine as f64, oracle);
            largest = largest.max(error);
            json!([engine, oracle, error])
        }
        (None, None) => Value::Null,
        _ => panic!("the engine and the oracle disagree on a layer's terms"),
    };
    let layers = actual.iter().zip(expected).map(|(engine, oracle)| {
        assert_eq!(engine.layer, oracle.layer, "the layers come in the request's order");
        json!({"layer": engine.layer, "value": term(Some(engine.value), Some(oracle.value)),
               "kernelXx": term(engine.kernel_xx, oracle.xx), "kernelXy": term(engine.kernel_xy, oracle.xy)})
    }).collect();
    (Value::Array(layers), largest)
}

/// A set method's target set from the fixture's windows, and its comparison with the oracle's.
fn prepare_set(fixture_path: &Path, fixture: &Fixture, encoder: &Dino, calibration: &Calibration, frame_DR: &Tensor<2>, device: &Device) -> Option<(TargetSet, Value, bool)> {
    let record = fixture.set.as_ref()?;
    let (windows, dots, file) = load_windows(&fixture_path.with_file_name(&record.file));
    assert_eq!(file.block, fixture.request.block, "the set file is the request's basis group's");
    let windows_PCHW = Tensor::<4>::from_data(TensorData::new(windows, [dots.len(), 3, WINDOW_SIDE, WINDOW_SIDE]), device);
    let started = std::time::Instant::now();
    let target = pollster::block_on(TargetSet::prepare(encoder, calibration, &frame_DR.clone().transpose(), &fixture.request, windows_PCHW, &dots)).unwrap();
    let seconds = started.elapsed().as_secs_f64();
    let (mut report, pass) = compare_set(&target, record);
    report["seconds"] = json!(seconds);
    Some((target, report, pass))
}

fn load_reader(directory: &std::path::Path, device: &Device) -> DictionaryReader {
    let index: Value = serde_json::from_slice(&fs::read(directory.join("reader.json")).unwrap()).unwrap();
    let mut reader = DictionaryReader::default();
    for file in index["files"].as_array().unwrap() {
        let name = file["path"].as_str().unwrap().rsplit('/').next().unwrap();
        let first = file["firstBlock"].as_u64().unwrap() as usize;
        let count = file["blocks"].as_u64().unwrap() as usize;
        reader.load(first, count, &fs::read(directory.join(name)).unwrap(), device).unwrap();
    }
    reader
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let fixture_path = arguments.first().expect("usage: grow_recipe_parity <fixture.json> [report.json]");
    let fixture = load_fixture(Path::new(fixture_path));
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
    let block = fixture.request.block;
    let frame_DR = load_frame(&fs::read(dictionary.join(format!("blocks/{block:05}.safetensors"))).unwrap(), &device).unwrap();
    let reader = load_reader(&reader_directory, &device);

    let request = fixture.request.clone();
    let first = fixture.from_update.unwrap_or(0);
    let mut gate = Vec::new();
    let prepared = prepare_set(Path::new(fixture_path), &fixture, &encoder, &calibration, &frame_DR, &device);
    let (target, set_report) = match prepared {
        Some((target, report, pass)) => {
            gate.push(("set", pass));
            (Some(target), report)
        }
        None => (None, Value::Null),
    };
    let mut training = match fixture.from_update {
        Some(from) => FigureTraining::continued(request.clone(), target, &floats(&fixture.initial_values), from, frame_DR, device.clone()).unwrap(),
        None => FigureTraining::new(request.clone(), target, frame_DR, device.clone()).unwrap(),
    };
    let initial = pollster::block_on(training.rule.values()).unwrap();
    let initial_check = compare(&initial, &floats(&fixture.initial_values), 0.0);
    let mut reports = Vec::new();
    // Draws do not depend on the numerics, so every update's plan must match exactly.
    let mut plans_match = true;
    for record in &fixture.updates {
        assert_eq!(record.update, training.completed(), "the fixture's updates must start at its first update and be consecutive");
        let started = std::time::Instant::now();
        let gradient = training.gradient(&encoder, &calibration).unwrap();
        let normalized = pollster::block_on(read(Tensor::cat(
            gradient.normalized.iter().map(|g| g.clone().inner().flatten(0, 3)).collect(),
            0,
        )));
        let (grown, grown_coarse) = grown_values(&gradient.grown);
        let plan = gradient.plan.clone();
        let update = pollster::block_on(training.apply(gradient)).unwrap();
        let values = pollster::block_on(training.rule.values()).unwrap();
        let seconds = started.elapsed().as_secs_f64();

        let grown_norm = grown.iter().chain(grown_coarse.iter().flatten()).map(|v| (*v as f64).powi(2)).sum::<f64>().sqrt();
        let codes: Vec<f32> = update.mean_codes.clone();
        let expected_codes: Vec<f32> = record.mean_codes.iter().map(|v| *v as f32).collect();
        let (layer_terms, layer_error) = compare_layers(&update.layers, &record.layer_terms);
        let method_loss = record.method_loss.map(|expected| json!([update.method_loss, expected, relative(update.method_loss as f64, expected)]));
        let report = json!({
            "update": record.update,
            "planMatches": plan == record.plan,
            "learningRate": [update.learning_rate, record.learning_rate],
            "loss": [update.loss, record.loss, relative(update.loss as f64, record.loss)],
            "methodLoss": method_loss,
            "layerTerms": layer_terms,
            "codeLoss": [update.code_loss, record.code_loss, relative(update.code_loss as f64, record.code_loss)],
            "overflow": [update.overflow, record.overflow],
            "stateMax": [update.state_max, record.state_max],
            "meanCodes": compare(&codes, &expected_codes, 1e-3),
"grownSample": compare(&sample(&grown), &floats(&record.grown_sample), 1e-5),
            "grownCoarseSample": compare_coarse(&grown_coarse, &record.grown_coarse_sample),
            "grownNorm": [grown_norm, record.grown_norm, relative(grown_norm, record.grown_norm)],
            "gradients": compare(&normalized, &floats(&record.gradients), 1e-5),
            "parameters": compare(&values, &floats(&record.values), 1e-5),
            "engineSeconds": seconds,
        });
        if record.update == first {
            let codes_error = report["meanCodes"]["relativeRms"].as_f64().unwrap();
            let gradient_error = report["gradients"]["relativeRms"].as_f64().unwrap();
            let coarse_error = report["grownCoarseSample"]["maximumAbsolute"].as_f64().unwrap_or(0.0);
            let grown_error = report["grownSample"]["maximumAbsolute"].as_f64().unwrap().max(coarse_error);
            gate.push(("loss", relative(update.loss as f64, record.loss) <= LOSS_TOLERANCE));
            if request.method.needs_set() {
                // Each layer's value and kernel means. An MMD value is a difference of kernel means
                // near 0.7 leaving roughly 0.1 to 0.3, so float32 rounding stays well below 1e-4.
                gate.push(("layer terms", layer_error <= LOSS_TOLERANCE));
                // The basis-group mean loss stays a reading on the same tokens.
                gate.push(("code loss reading", relative(update.code_loss as f64, record.code_loss) <= LOSS_TOLERANCE));
            }
            gate.push(("mean codes", codes_error <= CODES_TOLERANCE));
            // A fresh run's first update grows its drawn noise unchanged (each fc2 starts at zero), so
            // those states must match exactly; a continued rule grows them, and they match to float32
            // rounding of its rollout.
            if fixture.from_update.is_none() {
                gate.push(("noise states", grown_error == 0.0));
            } else {
                gate.push(("grown states", grown_error <= GROWN_TOLERANCE));
            }
            gate.push(("gradients", gradient_error <= GRADIENT_FLOOR_FACTOR * fixture.gradient_floor));
        }
        plans_match &= plan == record.plan;
        eprintln!("{}", serde_json::to_string(&report).unwrap());
        reports.push(report);
    }

    gate.push(("plans", plans_match));

    // Lockstep: the engine repeats a later reference update from the reference's parameters
    // and initial states, so trajectory chaos cannot hide a difference in the mechanics.
    let mut lockstep = Vec::new();
    for expected in &fixture.lockstep {
        training.rule = FigureRule::load(request.rule, &floats(&expected.values), &device).unwrap();
        let state = |encoded: &str| {
            let values = floats(encoded);
            let cells = values.len() / 16;
            Tensor::<3>::from_data(burn::tensor::TensorData::new(values, [1, cells, 16]), &device.clone().inner())
        };
        let initial = Cells { fine_1NC: state(&expected.initial), coarse_1MC: expected.initial_coarse.as_deref().map(state) };
        let gradient = training
            .differentiate(&encoder, &calibration, initial, expected.plan.clone(), expected.update)
            .unwrap();
        let normalized = pollster::block_on(read(Tensor::cat(
            gradient.normalized.iter().map(|g| g.clone().inner().flatten(0, 3)).collect(),
            0,
        )));
        let (grown, grown_coarse) = grown_values(&gradient.grown);
        let readings = FigureReadings::decode(&pollster::block_on(read(gradient.metrics.clone())), &request);
        let expected_codes: Vec<f32> = expected.mean_codes.iter().map(|v| *v as f32).collect();
        let report = json!({
            "update": expected.update,
            "loss": [readings.loss, expected.loss, relative(readings.loss as f64, expected.loss)],
            "methodLoss": expected.method_loss.map(|loss| json!([readings.method_loss, loss, relative(readings.method_loss as f64, loss)])),
            "layerTerms": compare_layers(&readings.layers, &expected.layer_terms).0,
            "meanCodes": compare(&readings.mean_codes, &expected_codes, 1e-3),
            "grownSample": compare(&sample(&grown), &floats(&expected.grown_sample), 1e-5),
            "grownCoarseSample": compare_coarse(&grown_coarse, &expected.grown_coarse_sample),
            "gradients": compare(&normalized, &floats(&expected.gradients), 1e-5),
        });
        eprintln!("lockstep {}", serde_json::to_string(&report).unwrap());
        lockstep.push(report);
    }

    // Live grid on the replay contract, grown with the reference's rules (its last trained rule
    // and saved reference rules), isolating the grid, picture, and reader from training divergence.
    let mut readings = Vec::new();
    let mut readings_match = true;
    for expected in &fixture.readings {
        let rule = FigureRule::fixed(request.rule, &floats(&expected.values), &device).unwrap();
        let mut grid = FigureGrid::new(expected.seed, request.rule, request.start, &device);
        grid.advance(&rule, expected.ticks);
        let rgba = pollster::block_on(grid.rgba()).unwrap();
        let expected_rgb = STANDARD.decode(&expected.levels).unwrap();
        let rgb: Vec<u8> = rgba.chunks_exact(4).flat_map(|pixel| [pixel[0], pixel[1], pixel[2]]).collect();
        let reading = pollster::block_on(figure::read(
            &encoder,
            &calibration,
            &reader,
            grid.picture(),
            ReadTarget {
                block,
                direction: fixture.direction,
                median_norm: request.median_norm,
                patches: grid.patches(),
            },
        ))
        .unwrap();
        // One read patch: 1/64 of the field, 1/16 of the centre.
        let winner_tolerance = 1.0 / grid.patches().len() as f64;
        assert_eq!(reading.codes_TR.len(), 3 * figure::PATCHES, "a code for every patch of the 8 × 8 grid");
        let mean_code: Vec<f64> = (0..3)
            .map(|axis| grid.patches().iter().map(|&patch| reading.codes_TR[3 * patch + axis] as f64).sum::<f64>() / grid.patches().len() as f64)
            .collect();
        let mean_code_error = mean_code.iter().zip(expected.mean_code).map(|(a, e)| (a - e).powi(2)).sum::<f64>().sqrt() / request.median_norm as f64;
        let close = (reading.strength as f64 - expected.strength).abs() <= STRENGTH_TOLERANCE
            && (reading.winner_fraction as f64 - expected.winner_fraction).abs() <= winner_tolerance
            && mean_code_error <= MEAN_CODE_TOLERANCE;
        readings_match &= close;
        readings.push(json!({
            "rule": expected.rule,
            "seed": expected.seed,
            "ticks": expected.ticks,
            "strength": [reading.strength, expected.strength],
            "winnerFraction": [reading.winner_fraction, expected.winner_fraction],
            "meanCode": [mean_code, expected.mean_code, mean_code_error],
            "differingBytes": rgb.iter().zip(&expected_rgb).filter(|(a, b)| a != b).count(),
            "largestByteDifference": rgb.iter().zip(&expected_rgb).map(|(a, b)| a.abs_diff(*b)).max().unwrap_or(0),
            "bytes": rgb.len(),
        }));
    }
    gate.push(("readings", readings_match));

    let report = json!({
        "fixture": fixture_path,
        "request": request,
        "initialValues": initial_check,
        "gate": gate.iter().map(|(name, pass)| json!({"check": name, "pass": pass})).collect::<Vec<_>>(),
        "pass": gate.iter().all(|(_, pass)| *pass) && initial_check["maximumAbsolute"].as_f64() == Some(0.0),
        "set": set_report,
        "tolerances": {
            "loss": LOSS_TOLERANCE,
            "setScalars": target_set_fixture::SET_SCALAR_TOLERANCE,
            "setVectors": target_set_fixture::SET_VECTOR_TOLERANCE,
            "meanCodes": CODES_TOLERANCE,
            "gradients": GRADIENT_FLOOR_FACTOR * fixture.gradient_floor,
            "gradientFloor": fixture.gradient_floor,
            "strength": STRENGTH_TOLERANCE,
            "meanCodeOverMedianNorm": MEAN_CODE_TOLERANCE,
            "winnerFraction": "one read patch",
        },
        "updates": reports,
        "lockstep": lockstep,
        "readings": readings,
        "planOfNextUpdate": Plan::draw(request.seed, training.completed(), request.batch),
    });
    let text = serde_json::to_string_pretty(&report).unwrap();
    if let Some(path) = arguments.get(1) {
        fs::write(path, &text).unwrap();
    }
    println!("{text}");
    if report["pass"] != json!(true) {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inline_fixture_keeps_its_updates() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tools/fixtures/grow-recipe-oracle-12002-batch4.json");
        let fixture = load_fixture(&path);
        assert_eq!(fixture.updates.len(), 5);
        assert_eq!(fixture.readings.len(), 3);
        assert_eq!(floats(&fixture.initial_values).len(), 7_776);
    }

    #[test]
    fn recorded_pyramid_cases_keep_all_updates_and_readings_within_the_file_limit() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("tools/fixtures");
        for (name, readings) in [
            ("grow-recipe-oracle-12002-pyramid-batch4.json", 3),
            ("grow-recipe-oracle-12002-pyramid-seeded-batch4.json", 3),
            ("grow-recipe-oracle-4009-pyramid-batch4.json", 2),
        ] {
            let path = directory.join(name);
            let fixture = load_fixture(&path);
            assert_eq!(fixture.request.batch, 4);
            assert_eq!(fixture.updates.len(), 5);
            assert_eq!(fixture.readings.len(), readings);
            assert_eq!(floats(&fixture.initial_values).len(), 17_088);
            for (update, record) in fixture.updates.iter().enumerate() {
                assert_eq!(record.update, update as u32);
                assert_eq!(floats(&record.gradients).len(), 17_088);
                assert_eq!(floats(&record.values).len(), 17_088);
                assert_eq!(record.plan, Plan::draw(fixture.request.seed, record.update, 4));
            }
            for file in std::iter::once(path).chain(fixture.update_files.iter().map(|file| directory.join(file))) {
                assert!(fs::metadata(&file).unwrap().len() <= 1_000_000, "{} exceeds 1 MB", file.display());
            }
        }
    }

    #[test]
    fn set_method_fixtures_name_their_set_and_stay_within_the_file_limit() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("tools/fixtures");
        for (name, layers) in [
            ("grow-recipe-oracle-12002-pyramid-seeded-token-distribution-batch4.json", 4),
            ("grow-recipe-oracle-12002-pyramid-token-distribution-batch4.json", 4),
            ("grow-recipe-oracle-12002-pyramid-seeded-basis-group-distribution-batch4.json", 1),
            ("grow-recipe-oracle-12002-pyramid-seeded-token-mean-batch4.json", 1),
            ("grow-recipe-oracle-12002-pyramid-seeded-token-mean-four-layers-batch4.json", 4),
        ] {
            let path = directory.join(name);
            let fixture = load_fixture(&path);
            assert!(fixture.request.validate().is_ok() && fixture.request.method.needs_set(), "{name}");
            let set = fixture.set.as_ref().expect("a set method's fixture records its set");
            assert_eq!((set.layers.len(), fixture.request.compared_layers().len()), (layers, layers), "{name}");
            let (windows, dots, file) = load_windows(&directory.join(&set.file));
            assert_eq!((file.block, dots.len(), windows.len()), (fixture.request.block, 33, 33 * 3 * WINDOW_SIDE * WINDOW_SIDE));
            assert!(set.layers.iter().all(|layer| layer.tokens == 297), "the 3 × 3 tokens of 33 windows whose dots lie inside");
            for record in &fixture.updates {
                assert_eq!(record.layer_terms.len(), layers, "{name}: every update records each layer");
                assert!(record.method_loss.is_some(), "{name}: every update records the method's loss");
            }
            for file in std::iter::once(path).chain(fixture.update_files.iter().map(|file| directory.join(file))) {
                assert!(fs::metadata(&file).unwrap().len() <= 1_000_000, "{} exceeds 1 MB", file.display());
            }
        }
    }
}
