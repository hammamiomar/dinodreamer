//! Explicit numerical audit against PyTorch fixtures (tools/reference.py).
//! No files, browser APIs, or checks in the update loop. The harness supplies the bytes.

mod attention;
mod linear;
mod plain;

use crate::{
    appearance::LAYERS as LAYERS_OF_APPEARANCE,
    assets::{Weights, decode_preview},
    encoder::{PATCHES, WIDTH},
    image::{Canvas, JITTER_RADIUS, Jitter, LEVELS, Pyramid, Resample, SIZE, Zoom, resize_coefficients},
    objective::{CodeSpec, FULL_STRENGTH, Objective, ObjectiveSpec, ProbeSpec, RequestSpec, RespondSpec},
    optimizer::Adam,
    profiling::StepProfile,
    state::{Edit, Engine, OptimizerSpec},
};
use burn::tensor::Tensor;
use serde::Serialize;

pub use crate::state::read_values;

/// The zoom per update and the shifts of the three zoomed updates in tools/reference.py.
const ZOOM_FIXTURE: f32 = 0.01;
const ZOOM_SHIFTS: [(i32, i32); 3] = [(1, -2), (-1, 2), (2, 0)];

#[derive(Debug, Serialize)]
pub struct Comparison {
    pub name: String,
    pub shape: Vec<usize>,
    pub relative_rms: f64,
    pub max_absolute: f64,
    pub tolerance: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub absolute_tolerance: Option<f64>,
    pub passed: bool,
}

#[derive(Debug, Serialize)]
pub struct Qualification {
    pub passed: bool,
    pub checks: Vec<Comparison>,
}

/// What the harness reads from disk or the network: the fixture file, the evidence
/// recipe as the worker would send it, its protected cells and its reference previews.
pub struct Inputs<'a> {
    pub reference: &'a [u8],
    pub objective: ObjectiveSpec,
    pub probes: Vec<ProbeSpec>,
    pub editable: Vec<bool>,
    pub previews: Vec<(u64, &'a [u8])>,
    /// The recipe's optimizer settings (the step, the level rates, the robust view); the engine's defaults when None.
    pub optimizer: Option<OptimizerSpec>,
}

pub fn compare_values(
    name: &str,
    shape: &[usize],
    actual: &[f32],
    expected: &[f32],
    tolerance: f64,
) -> Result<Comparison, String> {
    let count = shape.iter().product::<usize>();
    if count == 0 || actual.len() != count || expected.len() != count {
        return Err(format!("{name}: tensor shape/length mismatch"));
    }
    if !tolerance.is_finite() || tolerance <= 0.0 {
        return Err(format!("{name}: invalid tolerance"));
    }
    if actual
        .iter()
        .chain(expected)
        .any(|value| !value.is_finite())
    {
        return Err(format!("{name}: non-finite tensor value"));
    }
    let mut squared_error = 0.0_f64;
    let mut energy = 0.0_f64;
    let mut max_absolute = 0.0_f64;
    for (&actual, &expected) in actual.iter().zip(expected) {
        let difference = (actual as f64 - expected as f64).abs();
        squared_error += difference * difference;
        energy += (expected as f64).powi(2);
        max_absolute = max_absolute.max(difference);
    }
    let relative_rms = (squared_error / energy.max(1e-20)).sqrt();
    Ok(Comparison {
        name: name.into(),
        shape: shape.to_vec(),
        relative_rms,
        max_absolute,
        tolerance,
        absolute_tolerance: None,
        passed: relative_rms < tolerance,
    })
}

struct Checks<'a, F> {
    reference: Weights<'a>,
    rows: Vec<Comparison>,
    progress: F,
}

impl<F: FnMut(&Comparison)> Checks<'_, F> {
    fn push(&mut self, row: Comparison) {
        (self.progress)(&row);
        self.rows.push(row);
    }

    async fn compare<const D: usize>(
        &mut self,
        name: &str,
        actual: Tensor<D>,
        fixture: &str,
        tolerance: f64,
    ) -> Result<(), String> {
        let shape = actual.dims();
        self.compare_vec(name, &shape, &read_values(actual).await?, fixture, tolerance)
    }

    /// Expected values stay on the CPU.
    fn compare_vec(
        &mut self,
        name: &str,
        shape: &[usize],
        actual: &[f32],
        fixture: &str,
        tolerance: f64,
    ) -> Result<(), String> {
        let expected = self.fixture(fixture, shape)?;
        let row = compare_values(name, shape, actual, &expected, tolerance)?;
        self.push(row);
        Ok(())
    }

    fn fixture(&self, name: &str, shape: &[usize]) -> Result<Vec<f32>, String> {
        let values = match *shape {
            [a] => self.reference.values(name, [a]),
            [a, b] => self.reference.values(name, [a, b]),
            [a, b, c] => self.reference.values(name, [a, b, c]),
            [a, b, c, d] => self.reference.values(name, [a, b, c, d]),
            _ => return Err(format!("{name}: unsupported fixture rank")),
        };
        values.map_err(|error| error.to_string())
    }

    fn tensor<const D: usize>(&self, name: &str, shape: [usize; D]) -> Result<Tensor<D>, String> {
        self.reference
            .tensor(name, shape)
            .map_err(|error| error.to_string())
    }

    fn levels(&self, prefix: &str) -> Result<Vec<Tensor<4>>, String> {
        LEVELS
            .iter()
            .map(|&side| {
                Ok(self
                    .tensor(&format!("{prefix}-{side}"), [1, 3, side, side])?
                    .require_grad())
            })
            .collect()
    }
}

async fn check_resize<F: FnMut(&Comparison)>(checks: &mut Checks<'_, F>) -> Result<(), String> {
    for side in [3, 16, 32, 64, 128, 256] {
        let input_1CHW = checks
            .tensor::<4>(&format!("resize-input-{side}"), [1, 3, side, side])?
            .require_grad();
        let output_1CHW = Resample::new(&resize_coefficients(side, SIZE), side, &input_1CHW.device()).apply(input_1CHW.clone());
        checks
            .compare(
                &format!("resize-{side}"),
                output_1CHW.clone(),
                &format!("resize-output-{side}"),
                1e-5,
            )
            .await?;
        let upstream_1CHW =
            checks.tensor::<4>(&format!("resize-upstream-{side}"), [1, 3, SIZE, SIZE])?;
        let mut gradients = (output_1CHW * upstream_1CHW).sum().backward();
        checks
            .compare(
                &format!("resize-gradient-{side}"),
                input_1CHW.grad_remove(&mut gradients).unwrap(),
                &format!("resize-gradient-{side}"),
                1e-5,
            )
            .await?;
    }
    Ok(())
}

/// The legacy single-code fixtures, expressed as one Respond like term over the whole grid
/// or the central 8 × 8 cells.
fn legacy_objective(engine: &mut Engine, code: &CodeSpec, center: bool) -> Result<Objective, String> {
    // Full strength over the whole grid or the centre 8 × 8: equal masses and peak 1.
    let where_ = (0..PATCHES)
        .map(|cell| {
            let (row, column) = (cell / 16, cell % 16);
            if !center || ((4..12).contains(&row) && (4..12).contains(&column)) { FULL_STRENGTH } else { 0 }
        })
        .collect();
    let respond = RespondSpec {
        weight: 1.0,
        code: CodeSpec { where_: Some(where_), ..code.clone() },
    };
    let spec = ObjectiveSpec {
        requests: vec![RequestSpec { id: 0, respond: Some(respond), look: None }],
        ..Default::default()
    };
    Objective::build(&spec, &engine.frames, &mut engine.references, &engine.device)
}

/// One code term's raw value, averaged over views: the legacy `loss` fixtures.
fn legacy_loss(engine: &Engine, objective: &Objective, tokens_BTD: Tensor<3>) -> Tensor<1> {
    let readout = crate::encoder::Readout { native_BTD: tokens_BTD, intermediate_BPD: Vec::new() };
    let views = readout.native_BTD.dims()[0];
    let assigned = objective.assign(&[]);
    let zero_views_VCHW = Tensor::zeros([views, 3, 1, 1], &engine.device);
    objective.raws(&zero_views_VCHW, &readout, &assigned, &engine.calibration).mean_dim(1).reshape([1])
}

async fn check_encoder<F: FnMut(&Comparison)>(
    checks: &mut Checks<'_, F>,
    engine: &mut Engine,
    code: &CodeSpec,
) -> Result<(), String> {
    // Inspect layer outputs without keeping an unused autodiff graph.
    let image_1CHW = checks.tensor::<4>("image", [1, 3, SIZE, SIZE])?;
    let mut tokens_BTD = engine.encoder.embed(image_1CHW);
    checks
        .compare("patch embedding", tokens_BTD.clone(), "embedding", 1e-5)
        .await?;
    for (index, block) in engine.encoder.blocks.iter().enumerate() {
        tokens_BTD = block.forward(tokens_BTD, &engine.encoder.rope);
        let name = format!("layer-{index:02}");
        checks.compare(&name, tokens_BTD.clone(), &name, 0.002).await?;
    }
    drop(tokens_BTD);
    let image_1CHW = checks
        .tensor::<4>("image", [1, 3, SIZE, SIZE])?
        .require_grad();
    let tokens_BTD = engine.encoder.forward(image_1CHW.clone());
    checks
        .compare("final native tokens", tokens_BTD.clone(), "tokens", 0.002)
        .await?;
    let objective = legacy_objective(engine, code, false)?;
    let loss = legacy_loss(engine, &objective, tokens_BTD);
    checks.compare("code loss", loss.clone(), "loss", 0.002).await?;
    let mut gradients = loss.backward();
    checks
        .compare(
            "image gradient",
            image_1CHW.grad_remove(&mut gradients).unwrap(),
            "image_gradient",
            0.02,
        )
        .await
}

async fn check_views_and_regions<F: FnMut(&Comparison)>(
    checks: &mut Checks<'_, F>,
    engine: &mut Engine,
    code: &CodeSpec,
) -> Result<(), String> {
    let jitter = Jitter::new(0, JITTER_RADIUS, &engine.device);
    for (name, two_views, center) in [
        ("whole-two-view", true, false),
        ("center-one-view", false, true),
        ("center-two-view", true, true),
    ] {
        let image_1CHW = checks
            .tensor::<4>("image", [1, 3, SIZE, SIZE])?
            .require_grad();
        let views_VCHW = if two_views {
            jitter.fixed_views(image_1CHW.clone(), 1, -2)
        } else {
            image_1CHW.clone()
        };
        if name == "whole-two-view" {
            checks
                .compare("fixed reflection views", views_VCHW.clone(), "fixed_views", 1e-7)
                .await?;
        }
        let objective = legacy_objective(engine, code, center)?;
        let loss = legacy_loss(engine, &objective, engine.encoder.forward(views_VCHW));
        checks
            .compare(&format!("{name}-loss"), loss.clone(), &format!("{name}-loss"), 0.002)
            .await?;
        let mut gradients = loss.backward();
        checks
            .compare(
                &format!("{name}-gradient"),
                image_1CHW.grad_remove(&mut gradients).unwrap(),
                &format!("{name}-gradient"),
                0.02,
            )
            .await?;
    }
    Ok(())
}

async fn check_pyramid_and_adam<F: FnMut(&Comparison)>(
    checks: &mut Checks<'_, F>,
    engine: &mut Engine,
    code: &CodeSpec,
) -> Result<(), String> {
    let mut pyramid = Pyramid::new(7, &engine.device);
    pyramid.levels = checks.levels("level")?;
    let image_1CHW = pyramid.render();
    checks
        .compare("pyramid image", image_1CHW.clone(), "noise_image", 1e-5)
        .await?;
    let objective = legacy_objective(engine, code, false)?;
    let loss = legacy_loss(engine, &objective, engine.encoder.forward(image_1CHW));
    checks
        .compare("noise code loss", loss.clone(), "noise_loss", 0.002)
        .await?;
    let mut gradients = loss.backward();
    let mut level_gradients = Vec::new();
    for (&side, level) in LEVELS.iter().zip(&pyramid.levels) {
        let gradient = level.grad_remove(&mut gradients).unwrap();
        checks
            .compare(
                &format!("pyramid-gradient-{side}"),
                gradient.clone(),
                &format!("gradient-{side}"),
                0.02,
            )
            .await?;
        level_gradients.push(gradient);
    }
    Adam::new(&pyramid.levels).update(&mut pyramid.levels, level_gradients);
    for (&side, level) in LEVELS.iter().zip(&pyramid.levels) {
        checks
            .compare(
                &format!("adam-update-{side}"),
                level.clone(),
                &format!("updated-{side}"),
                0.025,
            )
            .await?;
    }
    // Isolate Adam from small encoder gradient differences near zero.
    let mut levels = checks.levels("level")?;
    let gradients = LEVELS
        .iter()
        .map(|&side| {
            Ok(checks
                .tensor::<4>(&format!("gradient-{side}"), [1, 3, side, side])?
                .inner())
        })
        .collect::<Result<Vec<_>, String>>()?;
    Adam::new(&levels).update(&mut levels, gradients);
    for (&side, level) in LEVELS.iter().zip(&levels) {
        checks
            .compare(
                &format!("adam-fixed-gradient-{side}"),
                level.clone(),
                &format!("updated-{side}"),
                1e-5,
            )
            .await?;
    }

    // The update rule at the four public steps and both level profiles, three
    // updates from the noise levels with identical fixed gradients that cover positive,
    // negative, zero, near-epsilon and tiny entries (tools/reference.py adam-grid-*).
    let grid_gradients: Vec<Tensor<4>> = LEVELS
        .iter()
        .map(|&side| checks.tensor::<4>(&format!("adam-grid-gradient-{side}"), [1, 3, side, side]))
        .collect::<Result<_, _>>()?;
    for step in [0.0125f64, 0.025, 0.05, 0.1] {
        for (profile, rates) in [("even", [1.0f64; 5]), ("coarse", [4.0, 2.83, 2.0, 1.41, 1.0])] {
            let mut levels = checks.levels("level")?;
            let mut adam = Adam::new(&levels);
            adam.learning_rate = step;
            adam.level_rates = rates.to_vec();
            for _ in 0..3 {
                adam.update(&mut levels, grid_gradients.iter().map(|gradient| gradient.clone().inner()).collect());
            }
            for (&side, level) in LEVELS.iter().zip(&levels) {
                checks
                    .compare(
                        &format!("adam fixed gradient step {step} {profile} {side}"),
                        level.clone(),
                        &format!("adam-grid-step-{step}-{profile}-{side}"),
                        1e-5,
                    )
                    .await?;
            }
        }
    }
    Ok(())
}

/// The evidence recipe: decoding, reference readouts, templates, every term in each view,
/// the total, gradients, one Adam update, probe codes and the rebase. Uses the engine's
/// real install path (encode_reference, set_objective, set_probes, evaluate).
async fn check_evidence<F: FnMut(&Comparison)>(
    checks: &mut Checks<'_, F>,
    engine: &mut Engine,
    inputs: &Inputs<'_>,
) -> Result<(), String> {
    for &(image_id, png) in &inputs.previews {
        let pixels = decode_preview(png).map_err(|error| error.to_string())?;
        checks.compare_vec(
            &format!("evidence preview {image_id}"),
            &[3, SIZE, SIZE],
            &pixels,
            &format!("evidence-pixels-{image_id}"),
            1e-7,
        )?;
        engine.encode_reference(image_id, png).await?;
        let readout = engine.references.get(image_id).expect("just encoded").to_vec();
        checks.compare_vec(
            &format!("evidence readout {image_id}"),
            &[4, PATCHES, WIDTH],
            &readout,
            &format!("evidence-readout-{image_id}"),
            0.002,
        )?;
    }
    engine.install(&Edit {
        objective: Some(inputs.objective.clone()),
        probes: Some(inputs.probes.clone()),
        optimizer: inputs.optimizer.clone(),
        ..Default::default()
    })?;
    // The Look terms' prepared curves: ∫Q̄² per channel and each reference's prefix integrals
    // at its segment starts (src/curve.rs), both computed on the CPU at apply.
    let fixtures: Vec<(Vec<f32>, Vec<(usize, Vec<f32>)>)> = engine
        .objective
        .look_fixtures()
        .into_iter()
        .map(|look| (look.squared_LD.clone(), look.prefixes.clone()))
        .collect();
    for (term, (squared_LD, prefixes)) in fixtures.iter().enumerate() {
        for layer in 0..LAYERS_OF_APPEARANCE {
            checks.compare_vec(
                &format!("evidence curve squared integral {term} layer {layer}"),
                &[WIDTH],
                &squared_LD[layer * WIDTH..(layer + 1) * WIDTH],
                &format!("evidence-squared-{term}-{layer}"),
                0.002,
            )?;
            for (reference, (tokens, prefixes_LKD)) in prefixes.iter().enumerate() {
                let segments = tokens + 1;
                checks.compare_vec(
                    &format!("evidence curve prefix {term} reference {reference} layer {layer}"),
                    &[segments, WIDTH],
                    &prefixes_LKD[layer * segments * WIDTH..(layer + 1) * segments * WIDTH],
                    &format!("evidence-prefix-{term}-{reference}-{layer}"),
                    0.002,
                )?;
            }
        }
    }

    let levels = checks.levels("evidence-level")?;
    let base_1CHW = checks.tensor::<4>("evidence-base", [1, 3, SIZE, SIZE])?;
    engine.canvas = Canvas::from_parts(levels, base_1CHW, inputs.editable.clone());
    engine.fresh_adam(); // The installed optimizer settings, as a restore would apply them.
    let image_1CHW = engine.canvas.compose();
    checks
        .compare("evidence protected image", image_1CHW.clone(), "evidence-image", 1e-5)
        .await?;
    // The robust view, when the fixture's optimizer asks for it, blurs the second view here as in an update.
    let views_BCHW = engine.robust_views(Jitter::new(0, JITTER_RADIUS, &engine.device).fixed_views(image_1CHW.clone(), 1, -2));
    let (raws_NB, codes_PR) = engine.evaluate(views_BCHW, &mut StepProfile::default());
    let raws_NB = raws_NB.ok_or("the evidence recipe has active terms")?;
    checks
        .compare("evidence terms per view", raws_NB.clone().inner(), "evidence-raws", 0.002)
        .await?;
    let total = engine.objective.total(raws_NB);
    checks
        .compare("evidence total", total.clone().inner(), "evidence-total", 0.002)
        .await?;
    let codes = read_values(codes_PR.ok_or("the evidence recipe has probes")?).await?;
    let mut offset = 0;
    for probe in &engine.probes.0 {
        let count = probe.slots.len() * 3;
        checks.compare_vec(
            &format!("evidence codes of request {}", probe.request_id),
            &[probe.slots.len(), 3],
            &codes[offset..offset + count],
            &format!("evidence-codes-{}", probe.request_id),
            0.002,
        )?;
        offset += count;
    }
    let mut gradients = total.backward();
    let mut level_gradients = Vec::new();
    for (&side, level) in LEVELS.iter().zip(&engine.canvas.pyramid.levels) {
        let gradient = level.grad_remove(&mut gradients).unwrap();
        checks
            .compare(
                &format!("evidence gradient {side}"),
                gradient.clone(),
                &format!("evidence-gradient-{side}"),
                0.02,
            )
            .await?;
        level_gradients.push(gradient);
    }
    engine.optimizer.update(&mut engine.canvas.pyramid.levels, level_gradients);
    for (&side, level) in LEVELS.iter().zip(&engine.canvas.pyramid.levels) {
        checks
            .compare(
                &format!("evidence Adam update {side}"),
                level.clone(),
                &format!("evidence-updated-{side}"),
                0.025,
            )
            .await?;
    }
    let fixture_image = checks.tensor::<4>("evidence-image", [1, 3, SIZE, SIZE])?;
    let rebased = Pyramid::from_image(fixture_image, &engine.device);
    checks
        .compare("evidence rebased level", rebased.levels[4].clone(), "evidence-rebased-256", 1e-5)
        .await?;
    checks
        .compare("evidence rebased image", rebased.render(), "evidence-rebased-image", 1e-5)
        .await
}

/// The recipe's motion: the zoom of the evidence levels and base, then three updates of the
/// evidence objective at ZOOM_FIXTURE with fixed shifts through Engine::descend, which zooms
/// after every Adam step. Run after check_evidence, which installs the objective.
async fn check_zoom<F: FnMut(&Comparison)>(
    checks: &mut Checks<'_, F>,
    engine: &mut Engine,
    inputs: &Inputs<'_>,
) -> Result<(), String> {
    let zoom = Zoom::new(ZOOM_FIXTURE, &engine.device)?;
    let base_1CHW = checks.tensor::<4>("evidence-base", [1, 3, SIZE, SIZE])?;
    let mut canvas = Canvas::from_parts(checks.levels("evidence-level")?, base_1CHW.clone(), inputs.editable.clone());
    canvas.zoom(&zoom);
    // PyTorch builds its sample coordinates through linspace; they differ from the engine's
    // by about 1e-4 pixel. A wrong definition, such as a half-pixel offset, gives about 0.5.
    for (&side, level) in LEVELS.iter().zip(&canvas.pyramid.levels) {
        checks
            .compare(&format!("zoom of level {side}"), level.clone(), &format!("zoom-of-level-{side}"), 1e-4)
            .await?;
    }
    checks.compare("zoom of base", canvas.base(), "zoom-of-base", 1e-4).await?;

    engine.canvas = Canvas::from_parts(checks.levels("evidence-level")?, base_1CHW, inputs.editable.clone());
    engine.fresh_adam(); // The installed optimizer settings, as a restore would apply them.
    engine.zoom = zoom;
    let jitter = Jitter::new(0, JITTER_RADIUS, &engine.device);
    for (row_shift, column_shift) in ZOOM_SHIFTS {
        let image_1CHW = engine.canvas.compose();
        let views_BCHW = engine.robust_views(jitter.fixed_views(image_1CHW.clone(), row_shift, column_shift));
        engine.descend(image_1CHW, views_BCHW, &mut StepProfile::default()).await?;
    }
    engine.zoom = Zoom::off();
    // Adam turns tiny gradient differences near zero into ±lr steps: 0.008 on the finest
    // levels after one update, about 0.04 after three. The image is the tight check.
    for (&side, level) in LEVELS.iter().zip(&engine.canvas.pyramid.levels) {
        checks
            .compare(
                &format!("zoom, three updates: level {side}"),
                level.clone(),
                &format!("zoom-updated-{side}"),
                0.05,
            )
            .await?;
    }
    checks
        .compare("zoom, three updates: image", engine.canvas.compose(), "zoom-image", 0.002)
        .await
}

impl Engine {
    /// Load the evidence recipe's block frames before calling: the harness owns all I/O.
    pub async fn qualify(
        &mut self,
        inputs: Inputs<'_>,
        progress: impl FnMut(&Comparison),
    ) -> Result<Qualification, String> {
        let device = self.device.clone();
        let mut checks = Checks {
            reference: Weights::new(inputs.reference, &device).map_err(|error| error.to_string())?,
            rows: Vec::new(),
            progress,
        };
        for row in linear::check_linear(&device).await? {
            checks.push(row);
        }
        for row in attention::check_attention(&device).await? {
            checks.push(row);
        }
        for row in plain::check_projected_attention(&device, &self.encoder.rope).await? {
            checks.push(row);
        }
        for row in plain::check_norms(&device).await? {
            checks.push(row);
        }
        for row in plain::check_resample(&device).await? {
            checks.push(row);
        }
        for row in plain::check_gelu(&device).await? {
            checks.push(row);
        }
        check_resize(&mut checks).await?;
        let code = inputs
            .probes
            .first()
            .ok_or("the evidence recipe needs a first request")?
            .code
            .clone();
        check_encoder(&mut checks, self, &code).await?;
        check_views_and_regions(&mut checks, self, &code).await?;
        check_pyramid_and_adam(&mut checks, self, &code).await?;
        check_evidence(&mut checks, self, &inputs).await?;
        check_zoom(&mut checks, self, &inputs).await?;
        Ok(Qualification {
            passed: checks.rows.iter().all(|row| row.passed),
            checks: checks.rows,
        })
    }

    /// A profiled update must apply the same update as a plain one.
    pub async fn check_profile_equivalence(&mut self) -> Result<Vec<Comparison>, String> {
        self.restart(0);
        self.update(&mut StepProfile::default()).await?.ok_or("nothing to optimize")?;
        let mut plain_levels = Vec::new();
        for level in &self.canvas.pyramid.levels {
            plain_levels.push(read_values(level.clone()).await?);
        }
        self.restart(0);
        let mut profile = StepProfile::gpu(&self.device);
        self.update(&mut profile).await?.ok_or("nothing to optimize")?;
        let mut checks = Vec::new();
        for ((&side, actual), expected) in LEVELS.iter().zip(&self.canvas.pyramid.levels).zip(plain_levels) {
            checks.push(compare_values(
                &format!("profile-updated-level-{side}"),
                &[1, 3, side, side],
                &read_values(actual.clone()).await?,
                &expected,
                1e-6,
            )?);
        }
        if self.steps != 1 || self.optimizer.updates != 1 {
            return Err("Profiled step did not apply exactly one update".into());
        }
        let _ = profile.resolve().await;
        self.restart(0);
        Ok(checks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_reject_nonfinite_and_wrong_shapes() {
        assert!(compare_values("nan", &[1], &[f32::NAN], &[0.0], 0.01).is_err());
        assert!(compare_values("inf", &[1], &[1.0], &[f32::INFINITY], 0.01).is_err());
        assert!(compare_values("shape", &[2], &[1.0], &[1.0], 0.01).is_err());
        let row = compare_values("known", &[2], &[2.0, 0.0], &[1.0, 0.0], 0.5).unwrap();
        assert_eq!(row.relative_rms, 1.0);
        assert_eq!(row.max_absolute, 1.0);
        assert!(!row.passed);
        assert!(
            compare_values("zeros", &[1], &[0.0], &[0.0], 1e-5)
                .unwrap()
                .passed
        );
    }
}
