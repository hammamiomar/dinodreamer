//! The figure recipe's WASM boundary. The worker owns files, progress and scheduling.
use super::{BrowserEngine, error, set};
use crate::grow::figure::{
    self, FigureGrid, FigureRequest, FigureRule, FigureTraining, RuleKind, Start,
    target_set::{self, TargetSet, WINDOW_SIDE},
};
use burn::tensor::{Device, Tensor, TensorData};
use js_sys::{Array, Float32Array, Object, Uint8Array, Uint8ClampedArray, Uint16Array};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct BrowserFigure {
    training: FigureTraining,
}

/// The target set of a set method, prepared once on the GPU and shared by the trainings that use it.
#[wasm_bindgen]
pub struct BrowserFigureSet {
    set: TargetSet,
}

/// The live grid on the Keep replay contract, with the rule it currently grows.
#[wasm_bindgen]
pub struct BrowserFigureGrid {
    grid: FigureGrid,
    rule: Option<FigureRule>,
    device: Device,
}

impl BrowserEngine {
    fn loaded_frame(&self, block: u32) -> Result<Tensor<2>, JsValue> {
        Ok(self.engine()?.frames.get(&block).ok_or_else(|| error("Load the selected dictionary frame first"))?.clone())
    }

    /// A training of `request` (JSON of a FigureRequest), fresh or continued from a saved rule.
    fn figure_training(&self, request: &str, target: Option<TargetSet>, continued: Option<(&[f32], u32)>) -> Result<BrowserFigure, JsValue> {
        let request: FigureRequest = serde_json::from_str(request).map_err(error)?;
        let frame_DR = self.loaded_frame(request.block)?;
        let training = match continued {
            None => FigureTraining::new(request, target, frame_DR, self.device.clone()),
            Some((values, from_update)) => FigureTraining::continued(request, target, values, from_update, frame_DR, self.device.clone()),
        };
        Ok(BrowserFigure { training: training.map_err(error)? })
    }
}

#[wasm_bindgen]
impl BrowserEngine {
    /// A basis-group mean training. `request` is the JSON of a FigureRequest; the block's frame must be loaded.
    pub fn create_figure(&self, request: &str) -> Result<BrowserFigure, JsValue> {
        self.figure_training(request, None, None)
    }

    /// A run continued from a saved definition: `values` its rule, `from_update` its update count;
    /// `request` as in `create_figure`, with the definition's seed (Train resume, case 2).
    pub fn create_figure_continued(&self, request: &str, values: &[f32], from_update: u32) -> Result<BrowserFigure, JsValue> {
        self.figure_training(request, None, Some((values, from_update)))
    }

    /// A set method's training on its prepared set; `request` names the same method, layers and block.
    pub fn create_figure_on_set(&self, request: &str, set: &BrowserFigureSet) -> Result<BrowserFigure, JsValue> {
        self.figure_training(request, Some(set.set.clone()), None)
    }

    /// A set method's run continued from a saved definition, as `create_figure_continued`.
    pub fn create_figure_continued_on_set(&self, request: &str, set: &BrowserFigureSet, values: &[f32], from_update: u32) -> Result<BrowserFigure, JsValue> {
        self.figure_training(request, Some(set.set.clone()), Some((values, from_update)))
    }

    /// Prepare the target set of a set method (`target_set`): `request` is the JSON of the
    /// FigureRequest it serves (method, layers and block), `pictures` the set's 256 px library
    /// preview PNGs, decoded without colour management, and `patches` the patch of each on its 16 × 16
    /// grid. DINO reads each picture's aligned 128 px window. The block's frame must be loaded.
    pub async fn prepare_figure_set(&self, request: &str, pictures: Array, patches: &[u32]) -> Result<BrowserFigureSet, JsValue> {
        let request: FigureRequest = serde_json::from_str(request).map_err(error)?;
        if pictures.length() as usize != patches.len() || patches.iter().any(|&patch| patch >= 256) {
            return Err(error("A target set needs one patch of the 16 × 16 grid for each picture"));
        }
        let mut windows_CHW = Vec::with_capacity(patches.len() * 3 * WINDOW_SIDE * WINDOW_SIDE);
        let mut dots = Vec::with_capacity(patches.len());
        for (png, &patch) in pictures.iter().zip(patches) {
            let picture_CHW = crate::assets::decode_preview(&Uint8Array::new(&png).to_vec()).map_err(error)?;
            let window = target_set::aligned_window(patch as usize);
            windows_CHW.extend(target_set::window_pixels(&picture_CHW, window));
            dots.push(window.dot);
        }
        let windows_P3HW = Tensor::<4>::from_data(TensorData::new(windows_CHW, [dots.len(), 3, WINDOW_SIDE, WINDOW_SIDE]), &self.device);
        let engine = self.engine()?;
        let frame_RD = self.loaded_frame(request.block)?.transpose();
        let set = TargetSet::prepare(&engine.encoder, &engine.calibration, &frame_RD, &request, windows_P3HW, &dots)
            .await
            .map_err(error)?;
        Ok(BrowserFigureSet { set })
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
impl BrowserFigureSet {
    /// The prepared set as JSON: its method, basis group and pictures, and per compared layer its
    /// tokens, unit σ, median distance h and self-similarity E k(ŷ, ŷ') (`target_set`).
    pub fn summary(&self) -> String {
        let layers: Vec<serde_json::Value> = self.set.layers.iter().map(|layer| serde_json::json!({
            "layer": layer.layer,
            "tokens": layer.standardized_ND.dims()[0],
            "unit": layer.unit,
            "medianDistance": layer.median_distance,
            "selfSimilarity": layer.self_similarity,
        })).collect();
        serde_json::json!({"method": self.set.method, "block": self.set.block, "pictures": self.set.pictures, "layers": layers}).to_string()
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
