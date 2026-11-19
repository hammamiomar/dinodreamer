//! Verification of the `/how` explorable exports against the CPU oracle fixture:
//! one layer of DINO laid open (`Dino::probe`), the explicit attention against the forward pass's
//! fused kernel, one token through the gate (`DictionaryReader::gate`), and three frames. It prints
//! one JSON report and exits 1 if a gate fails.
//!
//!   cargo run --release --features harness --example explain_check -- \
//!       tools/fixtures/explain-oracle.json [report.json]
//!
//! Assets as in grow_recipe_parity.
#![allow(non_snake_case)] // Tensor suffixes document axes.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use burn::tensor::{Device, Tensor, TensorData};
use dinodreamer_engine::{
    calibration::Calibration,
    encoder::{Block, DEPTH, Dino, TOKENS, WIDTH},
    reader::DictionaryReader,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{env, fs, path::PathBuf};

const ENCODER: &str = "dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "monet-dtd-seed9-20261004-pass-003";
/// The tokens after up to twelve layers on the GPU against torch on the CPU, relative RMS.
const TOKEN_TOLERANCE: f64 = 1e-4;
/// Attention weights lie in [0, 1]: the largest absolute difference.
const ATTENTION_TOLERANCE: f64 = 1e-4;
/// The explicit attention against the fused kernel on the same input, relative RMS: the same
/// arithmetic in another order.
const FUSED_TOLERANCE: f64 = 1e-5;
/// The gate of the oracle's own token: one projection and one sum, relative RMS.
const GATE_TOLERANCE: f64 = 1e-5;

#[derive(Deserialize)]
struct Fixture {
    picture: Picture,
    layer: usize,
    sample: usize,
    probe: Probe,
    gates: Vec<GateRecord>,
    frames: Vec<FrameRecord>,
}
#[derive(Deserialize)]
struct Picture {
    rgb: String,
}
#[derive(Deserialize)]
struct Probe {
    before: String,
    after: String,
    #[serde(rename = "final")]
    native: String,
    queries: Vec<usize>,
    attention: String,
}
#[derive(Deserialize)]
struct GateRecord {
    token: usize,
    native: String,
    calibrated: String,
    blocks: Vec<u16>,
    codes: String,
    norms: String,
    reconstruction: String,
    residual: f64,
}
#[derive(Deserialize)]
struct FrameRecord {
    block: usize,
    directions: String,
}

fn floats(encoded: &str) -> Vec<f32> {
    STANDARD
        .decode(encoded)
        .expect("base64 float32 values")
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
        .collect()
}

fn read<const D: usize>(tensor: Tensor<D>) -> Vec<f32> {
    pollster::block_on(tensor.into_data_async()).unwrap().try_to_vec::<f32>().unwrap()
}

fn relative_rms(actual: &[f32], expected: &[f32]) -> f64 {
    assert_eq!(actual.len(), expected.len(), "compared arrays differ in length");
    let error: f64 = actual.iter().zip(expected).map(|(a, e)| (*a as f64 - *e as f64).powi(2)).sum();
    let norm: f64 = expected.iter().map(|e| (*e as f64).powi(2)).sum();
    (error / norm.max(1e-30)).sqrt()
}

fn largest_difference(actual: &[f32], expected: &[f32]) -> f64 {
    actual.iter().zip(expected).map(|(a, e)| (*a as f64 - *e as f64).abs()).fold(0.0, f64::max)
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let fixture_path = arguments.first().expect("usage: explain_check <fixture.json> [report.json]");
    let fixture: Fixture = serde_json::from_slice(&fs::read(fixture_path).unwrap()).unwrap();
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
    let calibration =
        Calibration::load(&fs::read(model.join(DICTIONARY).join("calibration.safetensors")).unwrap(), &device).unwrap();
    let index: Value = serde_json::from_slice(&fs::read(reader_directory.join("reader.json")).unwrap()).unwrap();
    let mut reader = DictionaryReader::default();
    for file in index["files"].as_array().unwrap() {
        let name = file["path"].as_str().unwrap().rsplit('/').next().unwrap();
        let (first, count) = (file["firstBlock"].as_u64().unwrap() as usize, file["blocks"].as_u64().unwrap() as usize);
        reader.load(first, count, &fs::read(reader_directory.join(name)).unwrap(), &device).unwrap();
    }
    let mut gate = Vec::new();

    // One layer laid open, from the oracle's picture.
    let rgb_HWC = STANDARD.decode(&fixture.picture.rgb).unwrap();
    let rgb_CHW: Vec<f32> = (0..3).flat_map(|channel| rgb_HWC.iter().skip(channel).step_by(3).map(|&value| value as f32 / 255.0).collect::<Vec<_>>()).collect();
    let image_1CHW = Tensor::<4>::from_data(TensorData::new(rgb_CHW, [1, 3, 256, 256]), &device);
    let probe = encoder.probe(image_1CHW, fixture.layer);
    let sampled = |values: Vec<f32>| values.into_iter().step_by(fixture.sample).collect::<Vec<f32>>();
    let before = read(probe.before_1TD.clone());
    let tokens = json!({
        "before": relative_rms(&sampled(before.clone()), &floats(&fixture.probe.before)),
        "after": relative_rms(&sampled(read(probe.after_1TD.clone())), &floats(&fixture.probe.after)),
        "final": relative_rms(&sampled(read(probe.native_1TD.clone())), &floats(&fixture.probe.native)),
    });
    for name in ["before", "after", "final"] {
        gate.push((format!("{name} tokens"), tokens[name].as_f64().unwrap() <= TOKEN_TOLERANCE));
    }
    let attention = read(probe.attention_1HTT.clone());
    let heads = attention.len() / (TOKENS * TOKENS);
    let rows: Vec<f32> = (0..heads)
        .flat_map(|head| fixture.probe.queries.iter().map(move |&query| (head, query)))
        .flat_map(|(head, query)| attention[(head * TOKENS + query) * TOKENS..(head * TOKENS + query + 1) * TOKENS].to_vec())
        .collect();
    let attention_difference = largest_difference(&rows, &floats(&fixture.probe.attention));
    let row_sums = attention.chunks_exact(TOKENS).map(|row| (row.iter().map(|&w| w as f64).sum::<f64>() - 1.0).abs()).fold(0.0, f64::max);
    gate.push(("attention weights".into(), attention_difference <= ATTENTION_TOLERANCE));
    gate.push(("attention rows sum to 1".into(), row_sums <= 1e-5));
    // The explicit weights' output against the forward pass's fused kernel, on the engine's own input.
    let before_1TD = Tensor::<3>::from_data(TensorData::new(before, [1, TOKENS, WIDTH]), &device);
    let block = &encoder.blocks[fixture.layer];
    let (_, explicit_1HTE) = block.explicit_attention(before_1TD.clone(), &encoder.rope);
    let fused = relative_rms(&read(explicit_1HTE), &read(block.forward_attention(before_1TD, &encoder.rope)));
    gate.push(("explicit attention against the fused kernel".into(), fused <= FUSED_TOLERANCE));

    // Each oracle token through the gate.
    let mut gates = Vec::new();
    for expected in &fixture.gates {
        let native_11D = Tensor::<3>::from_data(TensorData::new(floats(&expected.native), [1, 1, WIDTH]), &device);
        let calibrated_11D = calibration.tokens(native_11D);
        let calibrated = read(calibrated_11D.clone());
        let result = pollster::block_on(reader.gate(calibrated_11D)).unwrap();
        let squared = |values: Vec<f64>| values.iter().map(|v| v * v).sum::<f64>().sqrt();
        let residual = squared(calibrated.iter().zip(&result.reconstruction_D).map(|(x, r)| (x - r) as f64).collect())
            / squared(calibrated.iter().map(|&x| x as f64).collect());
        let report = json!({
            "token": expected.token,
            "calibrated": relative_rms(&calibrated, &floats(&expected.calibrated)),
            "blocksMatch": result.addresses.blocks == expected.blocks,
            "codes": relative_rms(&result.addresses.codes, &floats(&expected.codes)),
            "norms": relative_rms(&result.addresses.norms, &floats(&expected.norms)),
            "reconstruction": relative_rms(&result.reconstruction_D, &floats(&expected.reconstruction)),
            "residual": [residual, expected.residual],
        });
        gate.push((format!("gate of token {}: winners", expected.token), report["blocksMatch"] == json!(true)));
        for name in ["calibrated", "codes", "norms", "reconstruction"] {
            gate.push((format!("gate of token {}: {name}", expected.token), report[name].as_f64().unwrap() <= GATE_TOLERANCE));
        }
        gates.push(report);
    }

    // Frames from the reader chunks against the bundle's.
    let mut frames = Vec::new();
    for expected in &fixture.frames {
        let difference = largest_difference(&read(reader.frame(expected.block).unwrap()), &floats(&expected.directions));
        gate.push((format!("frame of block {}", expected.block), difference == 0.0));
        frames.push(json!({"block": expected.block, "largestDifference": difference}));
    }

    let report = json!({
        "fixture": fixture_path,
        "layer": fixture.layer,
        "gate": gate.iter().map(|(name, pass)| json!({"check": name, "pass": pass})).collect::<Vec<_>>(),
        "pass": gate.iter().all(|(_, pass)| *pass),
        "tolerances": {"tokens": TOKEN_TOLERANCE, "attention": ATTENTION_TOLERANCE, "fused": FUSED_TOLERANCE, "gate": GATE_TOLERANCE},
        "tokens": tokens,
        "attention": {"largestDifference": attention_difference, "largestRowSumError": row_sums, "explicitAgainstFused": fused},
        "gates": gates,
        "frames": frames,
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
