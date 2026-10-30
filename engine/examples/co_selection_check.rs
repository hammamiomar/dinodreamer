//! A gate for the co-selection readout: the co-selected basis groups that
//! `figure::read` reports for step-600 pictures of stage-6 automata equal the reference CPU readout
//! (research/2026-10-26-co-activation: `out/pictures/<run>/tick-0600.png` and the tick-600 rows of
//! `out/materials/<run>.csv`). Reading the reference pictures tests the readout alone; the engine's replay
//! draws differ from torch growth, so grown pictures could not match.
//!
//!   cargo run --release --no-default-features --features cpu --example co_selection_check -- \
//!       --study <research/2026-10-26-co-activation> --runs <run>,<run> [--out <report.json>]
//!
//! The run name gives the requested group (`block-<id>`) and the read patches: the central 4 × 4
//! for a central start (`seeded-centre`), all 64 otherwise. Model and reader as grow_recipe_train
//! (DINODREAMER_MODEL, DINODREAMER_READER). It runs on the CPU and takes no GPU lock.
#![allow(non_snake_case)] // Tensor suffixes document axes.
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

fn argument(arguments: &[String], name: &str) -> Option<String> {
    arguments.iter().position(|value| value == name).map(|index| arguments[index + 1].clone())
}

/// A 128 × 128 8-bit RGB picture as the encoder reads it: [1, 3, H, W] in [0, 1].
fn picture(path: &PathBuf, device: &Device) -> Tensor<4> {
    let decoder = png::Decoder::new(std::io::BufReader::new(fs::File::open(path).unwrap()));
    let mut reader = decoder.read_info().unwrap();
    let mut bytes = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut bytes).unwrap();
    assert_eq!((info.width as usize, info.height as usize, info.color_type), (SIDE, SIDE, png::ColorType::Rgb), "{path:?}");
    let values: Vec<f32> = bytes[..SIDE * SIDE * 3].iter().map(|&byte| byte as f32).collect();
    let levels_1HWC = Tensor::<4>::from_data(TensorData::new(values, [1, SIDE, SIDE, 3]), device);
    (levels_1HWC.permute([0, 3, 1, 2]) / 255.0).autodiff()
}

/// The reference's tick-600 rows: (group, read patches selecting it, read patches selecting both, rank).
fn expected(csv: &str, read_patches: usize) -> Vec<(u16, u32, u32, u32)> {
    let mut lines = csv.lines();
    let header: Vec<&str> = lines.next().unwrap().split(',').collect();
    let column = |name: &str| header.iter().position(|value| *value == name).unwrap();
    let (tick, block, share, joint, rank) = (column("tick"), column("block"), column("share"), column("joint_share"), column("rank"));
    let count = |value: &str| (value.parse::<f64>().unwrap() * read_patches as f64).round() as u32;
    lines
        .map(|line| line.split(',').collect::<Vec<_>>())
        .filter(|row| row[tick] == "600")
        .map(|row| (row[block].parse().unwrap(), count(row[share]), count(row[joint]), row[rank].parse().unwrap()))
        .collect()
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let study = PathBuf::from(argument(&arguments, "--study").expect("--study <research/2026-10-26-co-activation>"));
    let runs = argument(&arguments, "--runs").expect("--runs <run>,<run>");
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
    for run in runs.split(',') {
        let block: u16 = run.split("block-").nth(1).and_then(|rest| rest.split('-').next()).unwrap().parse().unwrap();
        let patches: &[usize] = if run.contains("seeded-centre") { &CENTRE_PATCHES } else { &all };
        let picture_1CHW = picture(&study.join("out/pictures").join(run).join("tick-0600.png"), &device);
        let reading =
            pollster::block_on(figure::read(&encoder, &calibration, &reader, picture_1CHW, block as u32, [1.0, 0.0, 0.0], 1.0, patches))
                .unwrap();
        let engine_groups: Vec<(u16, u32, u32, u32)> = reading
            .co_selected
            .iter()
            .enumerate()
            .map(|(index, entry)| (entry.group, entry.patches, entry.joint, index as u32 + 1))
            .collect();
        let reference_groups = expected(&fs::read_to_string(study.join("out/materials").join(format!("{run}.csv"))).unwrap(), patches.len());
        let differences: Vec<Value> = reference_groups
            .iter()
            .filter(|row| !engine_groups.contains(row))
            .map(|row| json!({"reference": row, "engine": engine_groups.iter().find(|entry| entry.0 == row.0)}))
            .chain(
                engine_groups.iter()
                    .filter(|row| !reference_groups.iter().any(|entry| entry.0 == row.0))
                    .map(|row| json!({"reference": null, "engine": row})),
            )
            .collect();
        let same = differences.is_empty();
        passed &= same;
        println!(
            "{} {run}: {} groups (reference {}), requested {block} rank {:?}, winner fraction {:.4}{}",
            if same { "PASS" } else { "FAIL" },
            engine_groups.len(),
            reference_groups.len(),
            engine_groups.iter().find(|row| row.0 == block).map(|row| row.3),
            reading.winner_fraction,
            if same { String::new() } else { format!(", {} differences", differences.len()) },
        );
        report.push(json!({"run": run, "block": block, "readPatches": patches.len(), "same": same,
            "groups": engine_groups.len(), "referenceGroups": reference_groups.len(), "winnerFraction": reading.winner_fraction, "differences": differences}));
    }
    if let Some(out) = argument(&arguments, "--out") {
        fs::write(out, serde_json::to_string_pretty(&json!({"study": study, "runs": report})).unwrap() + "\n").unwrap();
    }
    if !passed {
        std::process::exit(1);
    }
}
