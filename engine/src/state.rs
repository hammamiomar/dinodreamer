//! One engine, one optimization state. No browser, files, network or cloud.
//!
//! The worker serializes every call. Each edit is built completely before it
//! replaces the current value, so a failed edit leaves the previous one in place.

use crate::{
    appearance::ReferenceCache,
    assets::decode_preview,
    encoder::{APPEARANCE_LAYERS, Dino},
    image::{Canvas, GRID, JITTER_RADIUS, Jitter, Resample, SIZE, Zoom, gaussian_coefficients},
    objective::{Calibration, Objective, ObjectiveSpec, ProbeSpec, Probes, load_frame},
    optimizer::{Adam, LEARNING_RATE},
    profiling::StepProfile,
};
use burn::tensor::{Device, Tensor, TensorData};
use std::collections::BTreeMap;

pub struct Engine {
    pub(crate) encoder: Dino,
    pub(crate) calibration: Calibration,
    pub(crate) objective: Objective,
    pub(crate) probes: Probes,
    pub(crate) canvas: Canvas,
    pub(crate) optimizer: Adam,
    pub(crate) jitter: Jitter,
    /// The recipe's motion, applied after every update.
    pub(crate) zoom: Zoom,
    /// The recipe's optimizer settings (`Edit::optimizer`); the engine's own defaults until an
    /// apply names them.
    settings: OptimizerSpec,
    /// The robust view's blur of the second view before the encoder (`OptimizerSpec::robust_view`).
    view_blur: Option<Resample>,
    pub(crate) steps: u32,
    /// Block frames by block number, loaded by the worker before an edit names them.
    pub(crate) frames: BTreeMap<u32, Tensor<2>>,
    pub(crate) references: ReferenceCache,
    pub(crate) device: Device,
}

/// The parts of a recipe that one apply changes; None keeps the current part.
/// `seed` makes a fresh image (the first apply); otherwise changed `editable` cells rebase.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edit {
    pub objective: Option<ObjectiveSpec>,
    pub probes: Option<Vec<ProbeSpec>>,
    pub editable: Option<Vec<bool>>,
    pub motion: Option<Motion>,
    pub seed: Option<u32>,
    pub optimizer: Option<OptimizerSpec>,
}

/// The recipe's Adam step, one multiplier per pyramid level coarsest first, and the robust
/// view (the shifted second view blurred by a Gaussian before the encoder; the measured
/// view stays sharp). Adam uses the configured step at every update. A harness that omits
/// these settings uses LEARNING_RATE, equal level rates and sharp views.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OptimizerSpec {
    pub step: f64,
    pub level_rates: Vec<f64>,
    pub robust_view: bool,
}

impl Default for OptimizerSpec {
    fn default() -> Self {
        Self { step: LEARNING_RATE, level_rates: vec![1.0; crate::image::LEVELS.len()], robust_view: false }
    }
}

/// The robust view's blur: sigma 1 px, taps to 3 px (the optimizer study's blur-view cell).
pub const ROBUST_VIEW_SIGMA: f32 = 1.0;
pub const ROBUST_VIEW_RADIUS: usize = 3;

fn check_optimizer(spec: &OptimizerSpec) -> Result<(), String> {
    if !(spec.step.is_finite() && spec.step > 0.0 && spec.step <= 1.0) {
        return Err("the optimizer step must be between 0 and 1".into());
    }
    if spec.level_rates.len() != crate::image::LEVELS.len() || spec.level_rates.iter().any(|rate| !(rate.is_finite() && *rate > 0.0)) {
        return Err(format!("the optimizer needs {} positive level rates", crate::image::LEVELS.len()));
    }
    Ok(())
}

/// Motion applied to the image once per update, outside the objective (recipe `motion`).
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Motion {
    /// Each update scales the image about its centre by 1 + this fraction; 0 is off.
    pub zoom_per_update: f32,
}

/// One probe's codes in the unshifted view.
pub struct ProbeReading {
    pub request_id: u32,
    pub slots: Vec<u16>,
    /// [P, R]
    pub codes: Vec<f32>,
    /// [P] squared distance to the cell target, or nearest region target.
    pub errors: Vec<f32>,
    /// [P] target squared lengths, or the region mean squared length about the origin.
    pub normalizers: Vec<f32>,
}

/// Read back after an update or a measurement. `step` counts the updates completed
/// before the evaluated image. Every term is reported in every view: [N, B] row-major.
pub struct Evaluation {
    pub step: u32,
    pub views: usize,
    pub ids: Vec<String>,
    pub weights: Vec<f32>,
    pub raws: Vec<f32>,
    pub probes: Vec<ProbeReading>,
    /// 256 × 256 RGBA, the evaluated image before any update.
    pub rgba: Vec<u8>,
}

/// Device tensors of one evaluation, not yet read back. Splitting the readback lets
/// the harness time GPU work alone.
pub struct Pending {
    step: u32,
    views: usize,
    raws_NB: Option<Tensor<2>>,
    codes_PR: Option<Tensor<2>>,
    image_1CHW: Tensor<4>,
}

impl Pending {
    /// Updates completed before the evaluated image.
    pub fn step(&self) -> u32 {
        self.step
    }
}

impl Engine {
    pub fn new(encoder: Dino, calibration: Calibration, device: Device) -> Self {
        let canvas = Canvas::from_seed(0, vec![true; GRID * GRID], &device);
        Self {
            optimizer: Adam::new(&canvas.pyramid.levels),
            canvas,
            encoder,
            calibration,
            objective: Objective::default(),
            probes: Probes::default(),
            jitter: Jitter::new(0, JITTER_RADIUS, &device),
            zoom: Zoom::off(),
            settings: OptimizerSpec::default(),
            view_blur: None,
            steps: 0,
            frames: BTreeMap::new(),
            references: ReferenceCache::default(),
            device,
        }
    }

    /// Fresh noise image, Adam and shift RNG from `seed`. Keeps the objective and protected cells.
    pub fn restart(&mut self, seed: u32) {
        self.fresh_image(seed, self.canvas.editable().to_vec());
    }

    /// Restore: continue from a stored picture, `rgb_CHW` in
    /// [0, 1] as `assets::decode_preview` gives it, saved after `step` updates. The picture
    /// becomes the image and the base of protected cells, Adam starts fresh and the update
    /// count continues from `step`; the objective, the protected cells and the shift RNG stay.
    pub fn restore_picture(&mut self, rgb_CHW: Vec<f32>, step: u32) -> Result<(), String> {
        if rgb_CHW.len() != 3 * SIZE * SIZE {
            return Err(format!("a picture needs 3 × {SIZE} × {SIZE} values"));
        }
        let picture_1CHW = Tensor::from_data(TensorData::new(rgb_CHW, [1, 3, SIZE, SIZE]), &self.device);
        self.canvas = Canvas::from_picture(picture_1CHW, self.canvas.editable().to_vec());
        self.fresh_adam();
        self.steps = step;
        Ok(())
    }

    /// A fresh Adam with the recipe's step and level rates.
    pub(crate) fn fresh_adam(&mut self) {
        let mut adam = Adam::new(&self.canvas.pyramid.levels);
        adam.learning_rate = self.settings.step;
        adam.level_rates = self.settings.level_rates.clone();
        self.optimizer = adam;
    }

    /// Noise brush: fresh noise from `seed` under the painted
    /// cells, protected cells excepted, and zero Adam moments there. The objective, the step
    /// count and the shift RNG do not change, so a replay with the same sequence repeats it.
    pub fn reseed(&mut self, painted: &[bool], seed: u32) -> Result<(), String> {
        if painted.len() != GRID * GRID {
            return Err(format!("a re-seed needs {} cells", GRID * GRID));
        }
        let masks = self.canvas.reseed(painted, seed);
        self.optimizer.reset(&masks);
        Ok(())
    }

    fn fresh_image(&mut self, seed: u32, editable: Vec<bool>) {
        self.canvas = Canvas::from_seed(seed, editable, &self.device);
        self.fresh_adam();
        self.jitter = Jitter::new(seed, JITTER_RADIUS, &self.device);
        self.steps = 0;
    }

    pub fn steps(&self) -> u32 {
        self.steps
    }

    pub fn has_frame(&self, block: u32) -> bool {
        self.frames.contains_key(&block)
    }

    pub fn load_frame(&mut self, block: u32, bytes: &[u8]) -> Result<(), String> {
        let frame_DR = load_frame(bytes, &self.device).map_err(|error| error.to_string())?;
        self.frames.insert(block, frame_DR);
        Ok(())
    }

    /// Keep the cached references a recipe needs; return the image ids still to encode.
    pub fn references_to_encode(&mut self, needed: &[u64]) -> Vec<u64> {
        self.references.retain_needed(needed)
    }

    /// Decode a preview, encode it once without gradients and cache its four appearance readouts.
    /// DINO reads the whole view; source windows select tokens later.
    pub async fn encode_reference(&mut self, image_id: u64, png: &[u8]) -> Result<(), String> {
        let rgb_CHW = decode_preview(png).map_err(|error| error.to_string())?;
        let image_1CHW = Tensor::from_data(TensorData::new(rgb_CHW, [1, 3, SIZE, SIZE]), &self.device);
        let readout = self.encoder.readout(image_1CHW, &APPEARANCE_LAYERS);
        let readout_LTD = read_values(Tensor::cat(readout.intermediate_BPD, 0)).await?;
        if readout_LTD.iter().any(|value| !value.is_finite()) {
            return Err(format!("Reference {image_id} produced non-finite features"));
        }
        self.references.put(image_id, readout_LTD);
        Ok(())
    }

    /// Install one apply completely or not at all. Every candidate is built and checked
    /// before anything changes, so a failure leaves the objective, probes, image and Adam.
    /// A changed motion takes effect from the next update and resets nothing.
    pub fn install(&mut self, edit: &Edit) -> Result<(), String> {
        let objective = edit
            .objective
            .as_ref()
            .map(|spec| Objective::build(spec, &self.frames, &mut self.references, &self.device))
            .transpose()?;
        let probes = edit
            .probes
            .as_deref()
            .map(|specs| Probes::build(specs, &self.frames, &self.device))
            .transpose()?;
        if edit.editable.as_ref().is_some_and(|cells| cells.len() != GRID * GRID) {
            return Err("protect must have 256 cells".into());
        }
        let zoom = edit
            .motion
            .as_ref()
            .map(|motion| Zoom::new(motion.zoom_per_update, &self.device))
            .transpose()?;
        if let Some(spec) = &edit.optimizer {
            check_optimizer(spec)?;
        }
        if let Some(spec) = &edit.optimizer {
            self.set_optimizer_settings(spec.clone());
        }
        if let Some(objective) = objective {
            self.set_objective(objective);
        }
        if let Some(probes) = probes {
            self.probes = probes;
        }
        if let Some(zoom) = zoom {
            self.zoom = zoom;
        }
        match (edit.seed, &edit.editable) {
            // The first image is fresh noise from the recipe's seed with its protected cells; no rebase.
            (Some(seed), editable) => {
                let editable = editable.clone().unwrap_or_else(|| self.canvas.editable().to_vec());
                self.fresh_image(seed, editable);
            }
            (None, Some(editable)) => self.set_editable(editable.clone()),
            (None, None) => {}
        }
        Ok(())
    }

    /// A changed objective keeps the image and resets Adam: its moments belong to the old one.
    pub(crate) fn set_objective(&mut self, objective: Objective) {
        self.objective = objective;
        self.fresh_adam();
    }

    /// Changed optimizer settings keep the image and Adam's moments: the step, the rates and
    /// the robust view take effect from the next update.
    fn set_optimizer_settings(&mut self, spec: OptimizerSpec) {
        self.optimizer.learning_rate = spec.step;
        self.optimizer.level_rates = spec.level_rates.clone();
        self.view_blur = spec
            .robust_view
            .then(|| Resample::new(&gaussian_coefficients(SIZE, ROBUST_VIEW_SIGMA, ROBUST_VIEW_RADIUS), SIZE, &self.device));
        self.settings = spec;
    }

    /// Changed editable cells rebase the current image and reset Adam.
    fn set_editable(&mut self, editable: Vec<bool>) {
        if editable.as_slice() == self.canvas.editable() {
            return;
        }
        self.canvas.rebase(editable);
        self.fresh_adam();
    }

    /// No update without an enabled term or an editable pixel.
    pub fn can_update(&self) -> bool {
        !self.objective.is_empty() && self.canvas.can_edit()
    }

    pub async fn step(&mut self) -> Result<Option<Evaluation>, String> {
        let Some(pending) = self.update(&mut StepProfile::default()).await? else {
            return Ok(None);
        };
        self.read(pending).await.map(Some)
    }

    /// One Adam update on the original and one reflected shift. The terms describe
    /// the image before the update. Appearance ranking stays on the device.
    pub async fn update(&mut self, profile: &mut StepProfile) -> Result<Option<Pending>, String> {
        if !self.can_update() {
            return Ok(None);
        }
        let (image_1CHW, views_BCHW) = profile.record("image_and_views", || {
            let image_1CHW = self.canvas.compose();
            let shifted_BCHW = self.jitter.views(image_1CHW.clone());
            let views_BCHW = self.robust_views(shifted_BCHW);
            (image_1CHW, views_BCHW)
        });
        self.descend(image_1CHW, views_BCHW, profile).await.map(Some)
    }

    /// The views as the encoder sees them: with the robust view, the second one blurred.
    /// The qualification prepares its fixed-shift views through this too.
    pub(crate) fn robust_views(&self, views_BCHW: Tensor<4>) -> Tensor<4> {
        match &self.view_blur {
            Some(blur) => blurred_second_view(views_BCHW, blur),
            None => views_BCHW,
        }
    }

    /// Evaluate the views of `image_1CHW`, backpropagate the weighted total, take one Adam
    /// step and apply the motion. The qualification calls it with fixed shifts.
    pub(crate) async fn descend(
        &mut self,
        image_1CHW: Tensor<4>,
        views_BCHW: Tensor<4>,
        profile: &mut StepProfile,
    ) -> Result<Pending, String> {
        let (raws_NB, codes_PR) = self.evaluate(views_BCHW, profile);
        let raws_NB = raws_NB.expect("can_update requires an enabled term");
        let total = profile.record("weighted_sum", || self.objective.total(raws_NB.clone()));
        let level_gradients = profile.record("backward", || {
            let mut gradients = total.backward();
            self.canvas
                .pyramid
                .levels
                .iter()
                .map(|level| {
                    level
                        .grad_remove(&mut gradients)
                        .expect("Image gradients must reach every pyramid level")
                })
                .collect()
        });
        profile.record("adam", || self.optimizer.update(&mut self.canvas.pyramid.levels, level_gradients));
        profile.record("motion", || self.canvas.zoom(&self.zoom));
        let step = self.steps;
        self.steps += 1;
        Ok(Pending {
            step,
            views: 2,
            raws_NB: Some(raws_NB.inner()),
            codes_PR: codes_PR.map(Tensor::inner),
            image_1CHW: image_1CHW.inner(),
        })
    }

    /// Unshifted readout of the current image, without an update or a tracked graph.
    pub async fn measure(&self) -> Result<Evaluation, String> {
        let image_1CHW = self.canvas.compose().detach();
        let (raws_NB, codes_PR) = self.evaluate(image_1CHW.clone(), &mut StepProfile::default());
        self.read(Pending {
            step: self.steps,
            views: 1,
            raws_NB,
            codes_PR,
            image_1CHW,
        })
        .await
    }

    /// Every term in every view, [N, B], and the probes' codes in view 0. None when absent.
    /// Submits GPU work only; nothing is read back.
    pub(crate) fn evaluate(&self, views_BCHW: Tensor<4>, profile: &mut StepProfile) -> (Option<Tensor<2>>, Option<Tensor<2>>) {
        let appearance = self.objective.needs_appearance();
        let readout = profile.record("encoder_forward", || {
            let intermediate: &[usize] = if appearance { &APPEARANCE_LAYERS } else { &[] };
            self.encoder.readout(views_BCHW.clone(), intermediate)
        });
        let assigned = profile.record("ranking", || self.objective.assign(&readout.intermediate_BPD));
        profile.record("objective", || {
            let raws_NB = (!self.objective.is_empty())
                .then(|| self.objective.raws(&views_BCHW, &readout, &assigned, &self.calibration));
            let codes_PR = self.probes.codes(&readout.native_BTD, &self.calibration);
            (raws_NB, codes_PR)
        })
    }

    /// One readback of terms, probe codes and the image.
    pub async fn read(&self, pending: Pending) -> Result<Evaluation, String> {
        let Pending { step, views, raws_NB, codes_PR, image_1CHW } = pending;
        let term_count = raws_NB.as_ref().map_or(0, |raws| raws.dims()[0] * views);
        let code_count = codes_PR.as_ref().map_or(0, |codes| codes.dims()[0] * 3);
        let mut pieces = vec![image_1CHW.reshape([3 * SIZE * SIZE])];
        pieces.extend(raws_NB.map(|raws| raws.reshape([term_count])));
        pieces.extend(codes_PR.map(|codes| codes.reshape([code_count])));
        let values = read_values(Tensor::cat(pieces, 0)).await?;
        if values.iter().any(|value| !value.is_finite()) {
            return Err("Optimization produced non-finite values. Restart before continuing.".into());
        }
        let (rgb_CHW, rest) = values.split_at(3 * SIZE * SIZE);
        let (raws, codes) = rest.split_at(term_count);
        Ok(Evaluation {
            step,
            views,
            ids: self.objective.ids(),
            weights: self.objective.weights(),
            raws: raws.to_vec(),
            probes: self.probe_readings(codes),
            rgba: rgba_bytes(rgb_CHW),
        })
    }

    fn probe_readings(&self, codes: &[f32]) -> Vec<ProbeReading> {
        let mut offset = 0;
        self.probes
            .0
            .iter()
            .map(|probe| {
                let count = probe.slots.len() * 3;
                let codes_PR = codes[offset..offset + count].to_vec();
                offset += count;
                let (errors_P, normalizers_P) = probe.errors(&codes_PR);
                ProbeReading {
                    request_id: probe.request_id,
                    slots: probe.slots.clone(),
                    codes: codes_PR,
                    errors: errors_P,
                    normalizers: normalizers_P,
                }
            })
            .collect()
    }

}

/// View 0 as it is, view 1 blurred: the blur-view cell of the optimizer study.
fn blurred_second_view(views_BCHW: Tensor<4>, blur: &crate::image::Resample) -> Tensor<4> {
    let [views, channels, height, width] = views_BCHW.dims();
    debug_assert_eq!(views, 2);
    let first_1CHW = views_BCHW.clone().slice([0..1, 0..channels, 0..height, 0..width]);
    let second_1CHW = views_BCHW.slice([1..2, 0..channels, 0..height, 0..width]);
    Tensor::cat(vec![first_1CHW, blur.apply(second_1CHW)], 0)
}

/// Display bytes: clamp to [0, 1], scale to 255, round. Display only; never fed back.
fn rgba_bytes(rgb_CHW: &[f32]) -> Vec<u8> {
    let pixels = SIZE * SIZE;
    let mut rgba = vec![255; 4 * pixels];
    for pixel in 0..pixels {
        for channel in 0..3 {
            rgba[4 * pixel + channel] = (rgb_CHW[channel * pixels + pixel].clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
    rgba
}

pub async fn read_values<const D: usize>(tensor: Tensor<D>) -> Result<Vec<f32>, String> {
    tensor
        .into_data_async()
        .await
        .map_err(|error| error.to_string())?
        .try_to_vec::<f32>()
        .map_err(|error| error.to_string())
}
