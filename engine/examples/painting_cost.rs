//! The painted Appearance term's worst cases: the curve preparation
//! time at the apply, the update time and the pool counters for a nine-cell field and a
//! full-grid field, each with 12 references, against a baseline term like the evidence
//! recipe's (12 cells, 2 references). The fields are the first cells of row 0 (a 1 × 9
//! strip, a 1 × 12 strip, the grid): the gathers cost the same for any shape of the same
//! count. The 12 references cycle the three local previews with windows of 256, 255, …
//! 245 tokens, so their knots do not coincide: the union has about 3,000 knots, the most
//! the limits allow. The pool counters are sampled after each step (`memory_pool_usage`),
//! not an allocator high-water mark; the update time's maximum is trimmed (the two largest
//! of the samples dropped, which cover the first update's kernel compilation).
//!
//! Needs local/release (tools/local_release.py). Run from engine/:
//!   cargo run --release --features harness --example painting_cost
#![allow(non_snake_case)] // Tensor suffixes document axes.
use burn::tensor::Device;
use dinodreamer_engine::{
    calibration::Calibration,
    encoder::{Block, DEPTH, Dino},
    objective::{LookSpec, ObjectiveSpec, ReferenceSpec, RequestSpec},
    state::{Edit, Engine},
};
use std::{fs, path::Path, time::Instant};

const ENCODER: &str = "local/release/model/dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY: &str = "local/release/model/monet-dtd-seed9-20261004-pass-003";
const PREVIEWS: &str =
    "local/release/web/v2/assets/452ed7c3d3da3f1e26e5049db467eff46527627b37798e976d518b3da8105072/previews";
const IMAGES: [u64; 3] = [3106516868104010, 3287097372943863, 8878176028456224];
const UPDATES: usize = 25;
const CELLS: usize = 256;

fn load_engine(device: Device) -> Result<Engine, Box<dyn std::error::Error>> {
    let encoder_root = Path::new(ENCODER);
    let mut encoder = Dino::load_stem(&fs::read(encoder_root.join("encoder-stem.safetensors"))?, &device)?;
    for layer in 0..DEPTH {
        let path = encoder_root.join(format!("encoder-layer-{layer:02}.safetensors"));
        encoder.blocks.push(Block::load(&fs::read(path)?, &device)?);
    }
    let calibration = Calibration::load(&fs::read(Path::new(DICTIONARY).join("calibration.safetensors"))?, &device)?;
    Ok(Engine::new(encoder, calibration, device))
}

/// A Look term over the first `cells` cells at full strength with `references` references
/// of distinct window sizes.
fn look(cells: usize, references: usize) -> ObjectiveSpec {
    let references = (0..references)
        .map(|index| ReferenceSpec {
            image_id: IMAGES[index % IMAGES.len()],
            source: (0..CELLS).map(|cell| cell < CELLS - index).collect(),
        })
        .collect();
    let where_ = (0..CELLS).map(|cell| if cell < cells { 100 } else { 0 }).collect();
    ObjectiveSpec {
        requests: vec![RequestSpec { id: 1, respond: None, look: Some(LookSpec { weight: 1.0, where_, references }) }],
        tv: None,
        l2: None,
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let device = Device::wgpu_options().init()?.autodiff();
    let mut engine = load_engine(device.clone())?;
    for image_id in IMAGES {
        let png = fs::read(Path::new(PREVIEWS).join(format!("{image_id}.png")))?;
        pollster::block_on(engine.encode_reference(image_id, &png))?;
    }
    let memory = |device: &Device| {
        device
            .memory_pool_usage()
            .map(|usage| (usage.bytes_in_use as f64 / 2f64.powi(20), usage.bytes_reserved as f64 / 2f64.powi(20)))
            .unwrap_or((f64::NAN, f64::NAN))
    };
    println!("after the encoder and three reference encodes: pool live {:.1} MiB, reserved {:.1} MiB", memory(&device).0, memory(&device).1);
    for (name, cells, references) in [
        ("baseline: 12 cells (a 1 x 12 strip), 2 references", 12, 2),
        ("nine cells (a 1 x 9 strip), 12 references", 9, 12),
        ("full grid, 12 references", CELLS, 12),
    ] {
        let edit = Edit {
            objective: Some(look(cells, references)),
            probes: Some(Vec::new()),
            editable: Some(vec![true; CELLS]),
            motion: None,
            seed: Some(0),
            optimizer: None,
        };
        let prepare = Instant::now();
        engine.install(&edit)?;
        let prepare_ms = prepare.elapsed().as_secs_f64() * 1e3;
        let mut update_ms = Vec::with_capacity(UPDATES);
        let (mut peak_live, mut peak_reserved) = (0.0f64, 0.0f64);
        for _ in 0..UPDATES {
            let update = Instant::now();
            pollster::block_on(engine.step())?.expect("the term is active");
            update_ms.push(update.elapsed().as_secs_f64() * 1e3);
            let (live, reserved) = memory(&device);
            peak_live = peak_live.max(live);
            peak_reserved = peak_reserved.max(reserved);
        }
        let mut sorted = update_ms.clone();
        sorted.sort_by(f64::total_cmp);
        let trimmed = &sorted[..sorted.len() - 2]; // The two largest samples dropped: the first updates compile the kernels.
        println!(
            "{name}: prepare {prepare_ms:.0} ms; update median {:.1} ms (first {:.0} ms, trimmed max {:.1} ms); pool sampled after steps, largest: live {peak_live:.1} MiB, reserved {peak_reserved:.1} MiB",
            sorted[sorted.len() / 2],
            update_ms[0],
            trimmed[trimmed.len() - 1],
        );
    }
    Ok(())
}
