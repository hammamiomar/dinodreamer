//! The figure recipe's WASM boundary. The worker owns files, progress and scheduling.
use super::{BrowserEngine, error, set};
use crate::grow::figure::{self, FigureGrid, FigureRequest, FigureRule, FigureTraining, RuleKind, Start};
use burn::tensor::Device;
use js_sys::{Float32Array, Object, Uint8Array, Uint8ClampedArray, Uint16Array};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct BrowserFigure {
    training: FigureTraining,
}

/// The live grid on the Keep replay contract, with the rule it currently grows.
#[wasm_bindgen]
pub struct BrowserFigureGrid {
    grid: FigureGrid,
    rule: Option<FigureRule>,
    device: Device,
}

#[wasm_bindgen]
impl BrowserEngine {
    /// `request` is the JSON of a FigureRequest; the block's frame must be loaded.
    pub fn create_figure(&self, request: &str) -> Result<BrowserFigure, JsValue> {
        let request: FigureRequest = serde_json::from_str(request).map_err(error)?;
        let frame_DR = self
            .engine()?
            .frames
            .get(&request.block)
            .ok_or_else(|| error("Load the selected dictionary frame first"))?
            .clone();
        Ok(BrowserFigure {
            training: FigureTraining::new(request, frame_DR, self.device.clone()).map_err(error)?,
        })
    }

    /// A run continued from a saved definition: `values` its rule, `from_update` its update count;
    /// `request` as in `create_figure`, with the definition's seed (Train resume, case 2).
    pub fn create_figure_continued(&self, request: &str, values: &[f32], from_update: u32) -> Result<BrowserFigure, JsValue> {
        let request: FigureRequest = serde_json::from_str(request).map_err(error)?;
        let frame_DR = self
            .engine()?
            .frames
            .get(&request.block)
            .ok_or_else(|| error("Load the selected dictionary frame first"))?
            .clone();
        Ok(BrowserFigure {
            training: FigureTraining::continued(request, values, from_update, frame_DR, self.device.clone()).map_err(error)?,
        })
    }

    pub async fn figure_update(&self, training: &mut BrowserFigure) -> Result<String, JsValue> {
        let engine = self.engine()?;
        let update = training
            .training
            .update(&engine.encoder, &engine.calibration)
            .await
            .map_err(error)?;
        let mut record = serde_json::to_value(update).map_err(error)?;
        if let Some(usage) = self.device.memory_pool_usage() {
            record["usedBytes"] = serde_json::json!(usage.bytes_in_use);
            record["reservedBytes"] = serde_json::json!(usage.bytes_reserved);
        }
        Ok(record.to_string())
    }

    /// `rule` is "cell" or "pyramid", `start` "noise" or "centre-disc", as in a FigureRequest.
    pub fn create_figure_grid(&self, seed: u32, rule: &str, start: &str) -> Result<BrowserFigureGrid, JsValue> {
        let rule: RuleKind = serde_json::from_value(serde_json::json!(rule)).map_err(error)?;
        let start: Start = serde_json::from_value(serde_json::json!(start)).map_err(error)?;
        Ok(BrowserFigureGrid {
            grid: FigureGrid::new(seed, rule, start, &self.device),
            rule: None,
            device: self.device.clone(),
        })
    }

    /// Strength and winner fraction of the grid's displayed picture, over the patches its start
    /// reads (all 64, or the central 4 × 4), and the co-selected basis groups of those patches as
    /// three parallel arrays by share (`figure::co_selection`). Needs the whole reader.
    pub async fn figure_reading(
        &self,
        live: &BrowserFigureGrid,
        block: u32,
        direction: &[f32],
        median_norm: f32,
    ) -> Result<JsValue, JsValue> {
        let direction: [f32; 3] = direction
            .try_into()
            .map_err(|_| error("The lobe direction needs three values"))?;
        if direction.iter().any(|value| !value.is_finite()) || !median_norm.is_finite() || median_norm <= 0.0 {
            return Err(error("Invalid lobe direction or median norm"));
        }
        let engine = self.engine()?;
        let reading = figure::read(
            &engine.encoder,
            &engine.calibration,
            &self.reader,
            live.grid.picture(),
            block,
            direction,
            median_norm,
            live.grid.patches(),
        )
        .await
        .map_err(error)?;
        let result = Object::new();
        set(&result, "strength", reading.strength)?;
        set(&result, "winnerFraction", reading.winner_fraction)?;
        let column = |value: fn(&figure::CoSelected) -> u16| Uint16Array::from(reading.co_selected.iter().map(value).collect::<Vec<u16>>().as_slice());
        set(&result, "coSelectedGroups", column(|entry| entry.group))?;
        set(&result, "coSelectedPatches", column(|entry| entry.patches as u16))?;
        set(&result, "coSelectedJoint", column(|entry| entry.joint as u16))?;
        set(&result, "coSelectedPositionSum", column(|entry| entry.position_sum as u16))?;
        set(&result, "selectedPatches", Uint8Array::from(reading.selected_T.iter().map(|&selected| u8::from(selected)).collect::<Vec<u8>>().as_slice()))?;
        set(&result, "readPatches", live.grid.patches().len() as u32)?;
        set(&result, "tick", live.grid.tick)?;
        set(&result, "seed", live.grid.seed)?;
        Ok(result.into())
    }
}

#[wasm_bindgen]
impl BrowserFigure {
    pub async fn values(&self) -> Result<Float32Array, JsValue> {
        Ok(Float32Array::from(self.training.rule.values().await.map_err(error)?.as_slice()))
    }
    pub fn completed(&self) -> u32 {
        self.training.completed()
    }
    /// The update count at which training stops: 1,000, or more after `extend`.
    pub fn target(&self) -> u32 {
        self.training.target()
    }
    /// Train `updates` more past the target (Resume after a run has ended).
    pub fn extend(&mut self, updates: u32) {
        self.training.extend(updates);
    }
}

#[wasm_bindgen]
impl BrowserFigureGrid {
    /// Grow with these values from now on: 7,776 for a cell rule, 17,088 for the pyramid, as the
    /// grid's rule kind. The state and tick continue.
    pub fn set_rule(&mut self, values: &[f32]) -> Result<(), JsValue> {
        self.rule = Some(FigureRule::fixed(self.grid.rule, values, &self.device).map_err(error)?);
        Ok(())
    }
    /// One brush stamp of the Keep replay runtime at (x, y) cells with a radius in cells.
    pub fn damage(&mut self, x: f32, y: f32, radius: f32) -> Result<(), JsValue> {
        if !x.is_finite() || !y.is_finite() || !radius.is_finite() || radius <= 0.0 || radius > 128.0 {
            return Err(error("A brush stamp needs finite cell coordinates and a radius of up to 128 cells"));
        }
        self.grid.damage(x, y, radius);
        Ok(())
    }
    /// Start again from the seed's start at tick 0, keeping the rule and the kind.
    pub fn restart(&mut self, seed: u32) {
        self.grid = FigureGrid::new(seed, self.grid.rule, self.grid.start, &self.device);
    }
    /// Advance `steps` ticks and return the displayed 128×128 RGBA picture.
    pub async fn advance(&mut self, steps: u32) -> Result<Uint8ClampedArray, JsValue> {
        let rule = self.rule.as_ref().ok_or_else(|| error("Set the grid's rule first"))?;
        self.grid.advance(rule, steps);
        Ok(Uint8ClampedArray::from(self.grid.rgba().await.map_err(error)?.as_slice()))
    }
    pub fn tick(&self) -> u32 {
        self.grid.tick
    }
    /// Whether the grid's state is still finite; a grid that left the finite range cannot be read.
    pub async fn finite(&self) -> Result<bool, JsValue> {
        self.grid.finite().await.map_err(error)
    }
    pub fn seed(&self) -> u32 {
        self.grid.seed
    }
}
