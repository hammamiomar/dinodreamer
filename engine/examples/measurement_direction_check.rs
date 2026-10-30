//! Check projection on the target: saved automaton
//! definitions measured again from their own preview, the step-600 picture that was measured when
//! they were saved, once on the direction they were measured on (`recipe.settings.lobeDirection`,
//! the group's main direction) and once on the training target's direction (the reference patch's
//! response, normalized). The first must reproduce the stored measurement and selection fraction;
//! the second is the target-direction measurement. The selection fraction does not depend on the direction.
//!
//!   cargo run --release --no-default-features --features cpu --example measurement_direction_check -- \
//!       <definition.material.json> ... [--out <report.json>]
//!
//! Model and reader as grow_recipe_train (DINODREAMER_MODEL, DINODREAMER_READER). It runs on the
//! CPU and takes no GPU lock.
#![allow(non_snake_case)] // Tensor suffixes document axes.
use base64::Engine;
use burn::tensor::{Device, Tensor, TensorData};
use dinodreamer_engine::{
    encoder::{Block, DEPTH, Dino},
    grow::figure::{self, CENTRE_PATCHES, PATCHES},
    objective::Calibration,
    reader::DictionaryReader,
};
use serde_json::{Value, json};
use std::{env, fs, path::PathBuf};

const ENCODER: &str = "dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "monet-dtd-seed9-20261004-pass-003";
const SIDE: usize = 128;
/// The stored measurement came from the browser's GPU reader; this one runs on the CPU, so the two
/// agree to float32 rounding of the projection, not bit for bit.
const STRENGTH_TOLERANCE: f32 = 1e-3;

/// A definition's preview, the measured 128 × 128 picture, as the encoder reads it: [1, 3, H, W] in [0, 1].
fn preview(data_url: &str, device: &Device) -> Tensor<4> {
    let encoded = data_url.strip_prefix("data:image/png;base64,").expect("an embedded PNG preview");
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
    let mut reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut pixels).unwrap();
    let channels = match info.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        other => panic!("unexpected preview colour type {other:?}"),
    };
    assert_eq!((info.width as usize, info.height as usize), (SIDE, SIDE));
    let values: Vec<f32> = pixels[..SIDE * SIDE * channels].chunks_exact(channels).flat_map(|pixel| pixel[..3].iter().map(|&byte| byte as f32)).collect();
    let levels_1HWC = Tensor::<4>::from_data(TensorData::new(values, [1, SIDE, SIDE, 3]), device);
    (levels_1HWC.permute([0, 3, 1, 2]) / 255.0).autodiff()
}

fn unit(vector: &Value) -> [f32; 3] {
    let values: Vec<f32> = vector.as_array().unwrap().iter().map(|value| value.as_f64().unwrap() as f32).collect();
    let length = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    [values[0] / length, values[1] / length, values[2] / length]
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let out = arguments.iter().position(|value| value == "--out").map(|index| arguments[index + 1].clone());
    let files: Vec<&String> = arguments.iter().enumerate().filter(|(index, value)| !value.starts_with("--") && (*index == 0 || arguments[index - 1] != "--out")).map(|(_, value)| value).collect();
    let model = PathBuf::from(env::var("DINODREAMER_MODEL").unwrap_or("local/release/model".into()));
    let reader_directory =
        PathBuf::from(env::var("DINODREAMER_READER").unwrap_or(format!("local/reader-assets/model/{DICTIONARY}")));

    let device = Device::flex().autodiff();
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

    let all: Vec<usize> = (0..PATCHES).collect();
    let mut report = Vec::new();
    let mut passed = true;
    for path in files {
        let file: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let block = file["block"].as_u64().unwrap() as u32;
        let settings = &file["recipe"]["settings"];
        let median_norm = settings["medianNorm"].as_f64().unwrap() as f32;
        let main = unit(&settings["lobeDirection"]);
        let target = unit(&file["anchor"]["code"]);
        let patches: &[usize] = if file["reading"]["region"] == "centre-4x4" { &CENTRE_PATCHES } else { &all };
        let measure = |direction: [f32; 3]| {
            pollster::block_on(figure::read(&encoder, &calibration, &reader, preview(file["preview"].as_str().unwrap(), &device), block, direction, median_norm, patches))
                .unwrap()
        };
        let (on_main, on_target) = (measure(main), measure(target));
        let stored_strength = file["reading"]["strength"].as_f64().unwrap() as f32;
        let stored_fraction = file["reading"]["winnerFraction"].as_f64().unwrap() as f32;
        let degrees = main.iter().zip(target).map(|(a, b)| a * b).sum::<f32>().clamp(-1.0, 1.0).acos().to_degrees();
        let reproduces = (on_main.strength - stored_strength).abs() <= STRENGTH_TOLERANCE && on_main.winner_fraction == stored_fraction;
        let same_fraction = on_target.winner_fraction == on_main.winner_fraction;
        passed &= reproduces && same_fraction;
        let name = PathBuf::from(path).file_name().unwrap().to_string_lossy().to_string();
        println!(
            "{} {name}: stored {stored_strength:.4} m / {stored_fraction}, main {:.4} m / {}, target {:.4} m / {} ({degrees:.1} degrees apart)",
            if reproduces && same_fraction { "PASS" } else { "FAIL" },
            on_main.strength, on_main.winner_fraction, on_target.strength, on_target.winner_fraction,
        );
        report.push(json!({"file": name, "block": block, "readPatches": patches.len(), "degreesApart": degrees,
            "stored": {"strength": stored_strength, "winnerFraction": stored_fraction},
            "mainDirection": {"strength": on_main.strength, "winnerFraction": on_main.winner_fraction},
            "trainingTarget": {"strength": on_target.strength, "winnerFraction": on_target.winner_fraction},
            "reproduces": reproduces, "sameSelectionFraction": same_fraction}));
    }
    if let Some(out) = out {
        fs::write(out, serde_json::to_string_pretty(&json!({"tolerance": STRENGTH_TOLERANCE, "definitions": report})).unwrap() + "\n").unwrap();
    }
    if !passed {
        std::process::exit(1);
    }
}
