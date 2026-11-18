//! Browser measurement of figure training and replay operations.
use crate::{
    grow::figure::{self, FigureGrid, FigureRequest, FigureRule, FigureTraining},
    profiling::{BroadProfile, KernelProfile},
    web::{BrowserEngine, error},
};
use burn::tensor::Tensor;
use js_sys::Float32Array;
use serde_json::json;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct HarnessFigure {
    training: FigureTraining,
}

#[wasm_bindgen]
impl HarnessFigure {
    pub async fn values(&self) -> Result<Float32Array, JsValue> {
        Ok(Float32Array::from(
            self.training.rule.values().await.map_err(error)?.as_slice(),
        ))
    }
}

#[wasm_bindgen]
impl BrowserEngine {
    /// Counter kernels must reproduce CPU float32 noise and masks exactly, including wraparound.
    pub async fn harness_figure_draws_qualify(&self) -> Result<String, JsValue> {
        use crate::{grow::draws::pcg, kernels::draws};
        let mut checks = Vec::new();
        for key in [0u32, u32::MAX, 0x80000000] {
            for count in [7usize, 257, 65539] {
                let uniform: Vec<f32> = (0..count)
                    .map(|index| (pcg(key.wrapping_add(index as u32)) >> 8) as f32 / 16777216.0)
                    .collect();
                let noise = draws::noise(key, count, 1, &self.device)
                    .into_data_async()
                    .await
                    .map_err(error)?
                    .try_to_vec::<f32>()
                    .map_err(error)?;
                let noise_errors = noise
                    .iter()
                    .zip(&uniform)
                    .filter(|(actual, value)| **actual != **value - 0.5)
                    .count();
                checks.push(json!({"key": key, "count": count, "quantity": "noise",
                    "mismatches": noise_errors, "pass": noise_errors == 0}));
                for rate in [0.0f32, 0.3, 0.5, 1.0] {
                    let fired = draws::fire_mask(key, count, rate, &self.device)
                        .into_data_async()
                        .await
                        .map_err(error)?
                        .try_to_vec::<f32>()
                        .map_err(error)?;
                    let mask_errors = fired
                        .iter()
                        .zip(&uniform)
                        .filter(|(actual, value)| {
                            **actual != if **value < rate { 1.0 } else { 0.0 }
                        })
                        .count();
                    checks.push(
                        json!({"key": key, "count": count, "quantity": "mask", "rate": rate,
                        "mismatches": mask_errors, "pass": mask_errors == 0}),
                    );
                }
            }
        }
        Ok(
            json!({"pass": checks.iter().all(|row| row["pass"] == true), "checks": checks,
            "tolerance": 0})
            .to_string(),
        )
    }

    pub fn harness_create_figure(&self, specification: &str) -> Result<HarnessFigure, JsValue> {
        let request: FigureRequest = serde_json::from_str(specification).map_err(error)?;
        let frame_DR = self
            .engine()?
            .frames
            .get(&request.block)
            .ok_or_else(|| error("Load the selected dictionary frame first"))?
            .clone();
        Ok(HarnessFigure {
            training: FigureTraining::new(request, None, frame_DR, self.device.clone()).map_err(error)?,
        })
    }

    /// Mode 0: completed update. Mode 1: the update's broad stages (`profiling::broad`). Mode 2:
    /// the kernel-family windows (`profiling::detail`). The two passes are separate updates.
    pub async fn harness_figure_update(
        &self,
        training: &mut HarnessFigure,
        mode: u32,
    ) -> Result<String, JsValue> {
        if mode > 2 || (mode != 0 && !self.has_timestamps()) {
            return Err(error(
                "Use mode 0 without timestamp support, or modes 1/2 with it",
            ));
        }
        let engine = self.engine()?;
        let broad = (mode == 1).then(|| BroadProfile::start(&self.device));
        let detail = (mode == 2).then(|| KernelProfile::start(&self.device));
        // Compute the gradient, then apply it. Apply's async metrics readback is
        // outside every window and is covered by the completion time.
        let gradient = training
            .training
            .gradient(&engine.encoder, &engine.calibration)
            .map_err(error)?;
        let update = training.training.apply(gradient).await.map_err(error)?;
        self.wait_completed().await?;
        let stages = match (broad, detail) {
            (Some(broad), _) => broad.resolve().await,
            (_, Some(detail)) => detail.resolve().await,
            _ => Vec::new(),
        };
        Ok(json!({"update": update, "stages": stages}).to_string())
    }

    /// Read the same parity quantities as the native figure oracle harness.
    pub async fn harness_figure_gradient(
        &self,
        training: &mut HarnessFigure,
    ) -> Result<String, JsValue> {
        let engine = self.engine()?;
        let gradient = training
            .training
            .gradient(&engine.encoder, &engine.calibration)
            .map_err(error)?;
        let normalized_P = Tensor::<1>::cat(
            gradient
                .normalized
                .iter()
                .map(|value| value.clone().inner().flatten(0, 3))
                .collect(),
            0,
        );
        let normalized = normalized_P
            .into_data_async()
            .await
            .map_err(error)?
            .try_to_vec::<f32>()
            .map_err(error)?;
        // Every 257th value of the grown fine grids and, for the pyramid, of the coarse grids,
        // as the native parity example samples them.
        let sample = |state: Tensor<3>| async move {
            let values = state.flatten::<1>(0, 2).into_data_async().await.map_err(error)?.try_to_vec::<f32>().map_err(error)?;
            Ok::<Vec<f32>, JsValue>(values.into_iter().step_by(257).collect())
        };
        let grown_sample = sample(gradient.grown.fine_1NC.clone()).await?;
        let grown_coarse_sample = match gradient.grown.coarse_1MC.clone() {
            Some(coarse) => Some(sample(coarse).await?),
            None => None,
        };
        let update = training.training.apply(gradient).await.map_err(error)?;
        Ok(json!({
            "update": update,
            "normalized": normalized,
            "grownSample": grown_sample,
            "grownCoarseSample": grown_coarse_sample,
        })
        .to_string())
    }

    /// A fresh replay grid, seed 9317 and 600 ticks in the published winner gate.
    pub async fn harness_figure_readout(
        &self,
        specification: &str,
        values: &[f32],
        seed: u32,
        ticks: u32,
        direction: &[f32],
    ) -> Result<String, JsValue> {
        let request: FigureRequest = serde_json::from_str(specification).map_err(error)?;
        request.validate().map_err(error)?;
        let direction: [f32; 3] = direction
            .try_into()
            .map_err(|_| error("Three direction values required"))?;
        let engine = self.engine()?;
        let rule = FigureRule::fixed(request.rule, values, &self.device).map_err(error)?;
        let mut grid = FigureGrid::new(seed, request.rule, request.start, &self.device);
        // Bound dispatch buffering while keeping the exact replay ticks and draws.
        for start in (0..ticks).step_by(32) {
            grid.advance(&rule, (ticks - start).min(32));
            self.wait_completed().await?;
        }
        let reading = figure::read(
            &engine.encoder,
            &engine.calibration,
            &self.reader,
            grid.picture(),
            request.block,
            direction,
            request.median_norm,
            grid.patches(),
        )
        .await
        .map_err(error)?;
        serde_json::to_string(&reading).map_err(error)
    }
}
