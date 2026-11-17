//! The replay pictures of published automaton files at the reading ladder of decision 12 (brief of
//! 17 November 2026): each file's rule grows on the live grid of the replay contract with the seed and
//! side its reading names, and the picture of every ladder tick is written as a PNG, the picture a
//! visitor's replay shows there. The research's re-export at the own step reads these pictures
//! (research/experiment-browser/own_steps.py): it takes the tick with the lowest own loss.
//!
//!   cargo run --release --features harness --example research_replay_pictures -- --files <list.json> --out <folder>
//!
//! `list.json` holds `[{id, file}]`, a material file (format 4) for each id; it writes
//! `<out>/<id>/tick-0100.png` and so on, and one JSON line per file. A file outside the replay
//! contract this grid grows is refused: another grid side, pixels per cell, hidden noise or start.
#![allow(non_snake_case)] // Tensor suffixes document axes.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use burn::tensor::Device;
use dinodreamer_engine::grow::figure::{FigureGrid, FigureRule, RuleKind, SEEDED_FIELD_BACKGROUND, SIDE, START_RADIUS, Start};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{env, fs, path::{Path, PathBuf}};

/// Decision 12's ladder.
const LADDER: [u32; 10] = [100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000];

#[derive(Deserialize)]
struct Listed {
    id: String,
    file: PathBuf,
}

fn argument(arguments: &[String], name: &str) -> String {
    let index = arguments.iter().position(|value| value == name).unwrap_or_else(|| panic!("{name} is required"));
    arguments[index + 1].clone()
}

/// The rule kind, its values, the start and the reading's seed of a material file, or why the grid cannot replay it.
fn replay_of(file: &Value) -> Result<(RuleKind, Vec<f32>, Start, u32), String> {
    let kind = match file["rule"]["layout"].as_str() {
        Some("figure-pyramid-16-96-torus-v1") => RuleKind::Pyramid,
        Some("figure-16-96-torus-v1") => RuleKind::Cell,
        other => return Err(format!("rule layout {other:?}")),
    };
    if file["rule"]["fireRate"].as_f64() != Some(0.5) || file["rule"]["dtype"] != "float32-le" {
        return Err("fire rate or dtype".into());
    }
    let values: Vec<f32> = STANDARD.decode(file["rule"]["values"].as_str().ok_or("rule values")?).map_err(|e| e.to_string())?
        .chunks_exact(4).map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap())).collect();
    let start = match (file["start"]["kind"].as_str(), file["start"]["radius"].as_f64(), file["start"]["backgroundAmplitude"].as_f64()) {
        (None, _, _) => Start::Noise,
        (Some("centre-disc"), Some(radius), None) if radius == START_RADIUS as f64 => Start::CentreDisc,
        (Some("centre-disc"), Some(radius), Some(background)) if radius == START_RADIUS as f64 && background == SEEDED_FIELD_BACKGROUND as f64 => Start::SeededField,
        _ => return Err(format!("start {}", file["start"])),
    };
    let side = file["reading"]["side"].as_u64();
    let pixels_per_cell = file["picture"]["pixelsPerCell"].as_u64().unwrap_or(1);
    let hidden_noise = file["playback"]["hiddenNoise"].as_f64().unwrap_or(0.0);
    if side != Some(SIDE as u64) || pixels_per_cell != 1 || hidden_noise != 0.0 {
        return Err(format!("grid side {side:?}, {pixels_per_cell} pixels per cell, hidden noise {hidden_noise}"));
    }
    let seed = file["reading"]["seed"].as_u64().filter(|seed| *seed <= u32::MAX as u64).ok_or("reading seed")? as u32;
    Ok((kind, values, start, seed))
}

fn write_png(path: &Path, rgba: &[u8]) {
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(fs::File::create(path).unwrap()), SIDE as u32, SIDE as u32);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let rgb: Vec<u8> = rgba.chunks_exact(4).flat_map(|pixel| [pixel[0], pixel[1], pixel[2]]).collect();
    encoder.write_header().unwrap().write_image_data(&rgb).unwrap();
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let listed: Vec<Listed> = serde_json::from_slice(&fs::read(argument(&arguments, "--files")).unwrap()).unwrap();
    let out = PathBuf::from(argument(&arguments, "--out"));
    let device = Device::wgpu_options().init().unwrap().autodiff();
    for entry in &listed {
        let file: Value = serde_json::from_slice(&fs::read(&entry.file).unwrap()).unwrap();
        let (kind, values, start, seed) = match replay_of(&file) {
            Ok(replay) => replay,
            Err(reason) => {
                println!("{}", json!({"id": entry.id, "refused": reason}));
                continue;
            }
        };
        let rule = FigureRule::fixed(kind, &values, &device).unwrap();
        let mut grid = FigureGrid::new(seed, kind, start, &device);
        let folder = out.join(&entry.id);
        fs::create_dir_all(&folder).unwrap();
        let mut ticks = Vec::new();
        for tick in LADDER {
            grid.advance(&rule, tick - grid.tick);
            let finite = pollster::block_on(grid.finite()).unwrap();
            if finite {
                write_png(&folder.join(format!("tick-{tick:04}.png")), &pollster::block_on(grid.rgba()).unwrap());
            }
            ticks.push(json!({"tick": tick, "finite": finite}));
        }
        println!("{}", json!({"id": entry.id, "seed": seed, "start": start, "rule": kind, "ticks": ticks}));
    }
}
