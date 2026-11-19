//! Native entry point for the same qualification used in the browser harness.
//!
//! Needs local/release (tools/local_release.py) and local/reference.safetensors
//! (tools/reference.py).
//! Run: cargo run --release --features harness --example qualify
use burn::tensor::Device;
use dinodreamer_engine::{
    calibration::Calibration,
    encoder::{Block, DEPTH, Dino},
    objective::{ObjectiveSpec, ProbeSpec},
    qualification::Inputs,
    state::{Engine, OptimizerSpec},
};
use serde::Deserialize;
use std::{fs, path::Path};

const ENCODER: &str = "local/release/model/dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "local/release/model/monet-dtd-seed9-20261004-pass-003";
const PREVIEWS: &str =
    "local/release/web/v2/assets/452ed7c3d3da3f1e26e5049db467eff46527627b37798e976d518b3da8105072/previews";

#[derive(Deserialize)]
struct Specs {
    objective: ObjectiveSpec,
    probes: Vec<ProbeSpec>,
    /// The recipe's optimizer settings; the engine's defaults when the fixture has none.
    #[serde(default)]
    optimizer: Option<OptimizerSpec>,
}

#[derive(Deserialize)]
struct Recipe {
    protect: Vec<bool>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let device = Device::wgpu_options().init()?.autodiff();
    let encoder_root = Path::new(ENCODER);
    let mut encoder = Dino::load_stem(&fs::read(encoder_root.join("encoder-stem.safetensors"))?, &device)?;
    for layer in 0..DEPTH {
        encoder.blocks.push(Block::load(
            &fs::read(encoder_root.join(format!("encoder-layer-{layer:02}.safetensors")))?,
            &device,
        )?);
    }
    let dictionary = Path::new(DICTIONARY);
    let calibration = Calibration::load(&fs::read(dictionary.join("calibration.safetensors"))?, &device)?;
    let mut engine = Engine::new(encoder, calibration, device);

    let fixtures = Path::new("tools/fixtures");
    let specs: Specs = serde_json::from_slice(&fs::read(fixtures.join("evidence-specs.json"))?)?;
    let recipe: Recipe = serde_json::from_slice(&fs::read(fixtures.join("evidence-recipe.json"))?)?;
    for probe in &specs.probes {
        let block = probe.code.block;
        engine.load_frame(block, &fs::read(dictionary.join(format!("blocks/{block:05}.safetensors")))?)?;
    }
    let mut images: Vec<u64> = specs
        .objective
        .requests
        .iter()
        .filter_map(|request| request.look.as_ref())
        .flat_map(|look| look.references.iter().map(|reference| reference.image_id))
        .collect();
    images.sort_unstable();
    images.dedup();
    let previews: Vec<(u64, Vec<u8>)> = images
        .iter()
        .map(|&image_id| Ok((image_id, fs::read(Path::new(PREVIEWS).join(format!("{image_id}.png")))?)))
        .collect::<Result<_, std::io::Error>>()?;
    let reference = fs::read("local/reference.safetensors")?;
    let inputs = Inputs {
        reference: &reference,
        objective: specs.objective,
        probes: specs.probes,
        optimizer: specs.optimizer,
        editable: recipe.protect.iter().map(|&protected| !protected).collect(),
        previews: previews.iter().map(|(id, bytes)| (*id, bytes.as_slice())).collect(),
    };
    let report = pollster::block_on(engine.qualify(inputs, |check| {
        println!(
            "{}: relative_rms={:.7}, max_abs={:.7}, pass={}",
            check.name, check.relative_rms, check.max_absolute, check.passed
        );
    }))?;
    if !report.passed {
        return Err("Numerical qualification failed".into());
    }
    println!("All {} checks passed", report.checks.len());
    Ok(())
}
