//! Native evidence updates for per-kernel GPU timing: install tools/fixtures/evidence-recipe.json
//! as the worker does, run a few warm-up updates, then `UPDATES` more, as the app's run does
//! (each update reads its frame back).
//!
//! CubeCL times every kernel and writes a summary at each device sync:
//!   CUBECL_DEBUG_LOG=local/kernels.log cargo run --release --features harness --example updates
//! The last summary in the log covers the measured updates only.
//! Needs local/release (tools/local_release.py).
use burn::tensor::Device;
use dinodreamer_engine::{
    encoder::{Block, DEPTH, Dino},
    objective::{Calibration, ObjectiveSpec, ProbeSpec},
    state::{Edit, Engine},
};
use serde::Deserialize;
use std::{fs, path::Path, time::Instant};

const ENCODER: &str = "local/release/model/dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "local/release/model/monet-dtd-seed9-20261004-pass-003";
const PREVIEWS: &str =
    "local/release/web/v2/assets/452ed7c3d3da3f1e26e5049db467eff46527627b37798e976d518b3da8105072/previews";
const WARMUP: usize = 3;
const UPDATES: usize = 20;

#[derive(Deserialize)]
struct Specs {
    objective: ObjectiveSpec,
    probes: Vec<ProbeSpec>,
}

#[derive(Deserialize)]
struct Recipe {
    protect: Vec<bool>,
    seed: u32,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let device = Device::wgpu_options().init()?.autodiff();
    let encoder_root = Path::new(ENCODER);
    let mut encoder = Dino::load_stem(&fs::read(encoder_root.join("encoder-stem.safetensors"))?, &device)?;
    for layer in 0..DEPTH {
        let path = encoder_root.join(format!("encoder-layer-{layer:02}.safetensors"));
        encoder.blocks.push(Block::load(&fs::read(path)?, &device)?);
    }
    let dictionary = Path::new(DICTIONARY);
    let calibration = Calibration::load(&fs::read(dictionary.join("calibration.safetensors"))?, &device)?;
    let mut engine = Engine::new(encoder, calibration, device.clone());

    let fixtures = Path::new("tools/fixtures");
    let specs: Specs = serde_json::from_slice(&fs::read(fixtures.join("evidence-specs.json"))?)?;
    let recipe: Recipe = serde_json::from_slice(&fs::read(fixtures.join("evidence-recipe.json"))?)?;
    for probe in &specs.probes {
        let block = probe.code.block;
        engine.load_frame(block, &fs::read(dictionary.join(format!("blocks/{block:05}.safetensors")))?)?;
    }
    let images: Vec<u64> = specs
        .objective
        .requests
        .iter()
        .filter_map(|request| request.look.as_ref())
        .flat_map(|look| look.references.iter().map(|reference| reference.image_id))
        .collect();
    for image_id in engine.references_to_encode(&images) {
        let png = fs::read(Path::new(PREVIEWS).join(format!("{image_id}.png")))?;
        pollster::block_on(engine.encode_reference(image_id, &png))?;
    }
    engine.install(&Edit {
        objective: Some(specs.objective),
        probes: Some(specs.probes),
        editable: Some(recipe.protect.iter().map(|&protected| !protected).collect()),
        motion: None,
        seed: Some(recipe.seed),
        optimizer: None,
    })?;

    for _ in 0..WARMUP {
        pollster::block_on(engine.step())?;
    }
    device.sync()?;
    let start = Instant::now();
    for _ in 0..UPDATES {
        pollster::block_on(engine.step())?;
    }
    device.sync()?;
    println!("{UPDATES} updates: {:.1} ms each", start.elapsed().as_secs_f64() * 1e3 / UPDATES as f64);
    Ok(())
}
