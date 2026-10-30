//! Thin WASM adapter. The worker provides bytes and JSON specs and serializes commands.
use crate::{
    encoder::{Block, DEPTH, Dino},
    objective::Calibration,
    state::{Edit, Engine, Evaluation},
};
use burn::tensor::Device;
use js_sys::{Array, Float32Array, Function, Object, Reflect, Uint8ClampedArray, Uint16Array};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    /// The device-lost reason, once WebGPU reports it. WASM runs this worker on one thread.
    static LOST: RefCell<Option<String>> = const { RefCell::new(None) };
    /// The worker's handler. wgpu's callback must be Send, so it reaches the handler through here.
    static ON_LOST: RefCell<Option<Function>> = const { RefCell::new(None) };
}

fn report_device_lost() {
    let reason = LOST.with(|lost| lost.borrow().clone());
    let handler = ON_LOST.with(|handler| handler.borrow().clone());
    if let (Some(reason), Some(handler)) = (reason, handler) {
        let _ = handler.call1(&JsValue::NULL, &JsValue::from_str(&reason));
    }
}

#[cfg(feature = "harness")]
mod harness;
/// Figure measurement exports live under this module so they can
/// use its private engine handle and device without widening the public API.
#[cfg(feature = "harness")]
#[path = "../benchmarks/figure_training.rs"]
mod figure_training;
mod figure;
mod reader;
mod explain;

#[wasm_bindgen]
pub struct BrowserEngine {
    device: Device,
    loading: Option<Dino>,
    engine: Option<Engine>,
    reader: crate::reader::DictionaryReader,
    #[cfg(feature = "harness")]
    setup: burn::tensor::wgpu::WgpuSetup,
}

fn error(message: impl ToString) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn set(object: &Object, key: &str, value: impl Into<JsValue>) -> Result<(), JsValue> {
    Reflect::set(object, &key.into(), &value.into()).map(|_| ())
}

/// Image ids are int64 in the library; JavaScript numbers hold them exactly below 2^53.
fn image_id(value: f64) -> Result<u64, JsValue> {
    if value.fract() != 0.0 || !(0.0..9_007_199_254_740_992.0).contains(&value) {
        return Err(error("Image ids must be non-negative integers below 2^53"));
    }
    Ok(value as u64)
}

fn evaluation_object(evaluation: Evaluation, device: &Device) -> Result<JsValue, JsValue> {
    let object = Object::new();
    set(&object, "step", evaluation.step)?;
    set(&object, "views", evaluation.views as u32)?;
    let ids = Array::new();
    for id in &evaluation.ids {
        ids.push(&JsValue::from_str(id));
    }
    set(&object, "ids", ids)?;
    set(&object, "weights", Float32Array::from(evaluation.weights.as_slice()))?;
    set(&object, "raws", Float32Array::from(evaluation.raws.as_slice()))?;
    let probes = Array::new();
    for probe in evaluation.probes {
        let reading = Object::new();
        set(&reading, "requestId", probe.request_id)?;
        set(&reading, "slots", Uint16Array::from(probe.slots.as_slice()))?;
        set(&reading, "codes", Float32Array::from(probe.codes.as_slice()))?;
        set(&reading, "errors", Float32Array::from(probe.errors.as_slice()))?;
        set(&reading, "normalizers", Float32Array::from(probe.normalizers.as_slice()))?;
        probes.push(&reading);
    }
    set(&object, "probes", probes)?;
    set(&object, "pixels", Uint8ClampedArray::from(evaluation.rgba.as_slice()))?;
    if let Some(memory) = device.memory_pool_usage() {
        set(&object, "gpuUsedBytes", memory.bytes_in_use as f64)?;
        set(&object, "gpuReservedBytes", memory.bytes_reserved as f64)?;
    }
    Ok(object.into())
}

#[wasm_bindgen]
impl BrowserEngine {
    pub async fn create() -> Result<BrowserEngine, JsValue> {
        console_error_panic_hook::set_once();
        let (device, _setup) = Device::wgpu_options()
            .init_with_setup_async()
            .await
            .map_err(error)?;
        // A lost device can leave a readback unresolved, so the worker needs its own signal.
        // CubeCL keeps its own callback; WebGPU's `lost` promise accepts several.
        _setup.device.set_device_lost_callback(|reason, message| {
            LOST.with(|lost| *lost.borrow_mut() = Some(format!("The GPU device was lost ({reason:?}): {message}")));
            report_device_lost();
        });
        Ok(Self {
            device: device.autodiff(),
            loading: None,
            engine: None,
            reader: crate::reader::DictionaryReader::default(),
            #[cfg(feature = "harness")]
            setup: _setup,
        })
    }

    /// `handler(message)` runs once when WebGPU reports the device lost, also if that already happened.
    pub fn on_device_lost(&self, handler: Function) {
        ON_LOST.with(|slot| *slot.borrow_mut() = Some(handler));
        report_device_lost();
    }

    pub fn load_stem(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        if self.loading.is_some() || self.engine.is_some() {
            return Err(error("Encoder is already loaded"));
        }
        self.loading = Some(Dino::load_stem(bytes, &self.device).map_err(error)?);
        Ok(())
    }

    pub fn load_layer(&mut self, index: usize, bytes: &[u8]) -> Result<(), JsValue> {
        let model = self
            .loading
            .as_mut()
            .ok_or_else(|| error("Load the stem first"))?;
        if model.blocks.len() != index || index >= DEPTH {
            return Err(error("Encoder layers must load in order"));
        }
        model
            .blocks
            .push(Block::load(bytes, &self.device).map_err(error)?);
        Ok(())
    }

    /// The last load step: the shared calibration. Creates the engine with a seed-0 image.
    pub fn load_calibration(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        let model = self
            .loading
            .as_ref()
            .ok_or_else(|| error("Load the encoder first"))?;
        if model.blocks.len() != DEPTH {
            return Err(error("Encoder layers are missing"));
        }
        let calibration = Calibration::load(bytes, &self.device).map_err(error)?;
        let model = self.loading.take().expect("encoder checked above");
        self.engine = Some(Engine::new(model, calibration, self.device.clone()));
        Ok(())
    }

    fn engine(&self) -> Result<&Engine, JsValue> {
        self.engine.as_ref().ok_or_else(|| error("Load the model first"))
    }

    fn engine_mut(&mut self) -> Result<&mut Engine, JsValue> {
        self.engine.as_mut().ok_or_else(|| error("Load the model first"))
    }

    pub fn has_frame(&self, block: u32) -> Result<bool, JsValue> {
        Ok(self.engine()?.has_frame(block))
    }

    pub fn load_frame(&mut self, block: u32, bytes: &[u8]) -> Result<(), JsValue> {
        self.engine_mut()?.load_frame(block, bytes).map_err(error)
    }

    /// Keep the cached references among `image_ids`; return those still to encode.
    pub fn references_to_encode(&mut self, image_ids: Vec<f64>) -> Result<Vec<f64>, JsValue> {
        let needed = image_ids.into_iter().map(image_id).collect::<Result<Vec<_>, _>>()?;
        let missing = self.engine_mut()?.references_to_encode(&needed);
        Ok(missing.into_iter().map(|id| id as f64).collect())
    }

    pub async fn encode_reference(&mut self, image_id_value: f64, png: &[u8]) -> Result<(), JsValue> {
        let image_id = image_id(image_id_value)?;
        self.engine_mut()?.encode_reference(image_id, png).await.map_err(error)
    }

    /// `edit` is the JSON of an Edit. Installs it completely or not at all.
    pub fn install(&mut self, edit: &str) -> Result<(), JsValue> {
        let edit: Edit = serde_json::from_str(edit).map_err(error)?;
        self.engine_mut()?.install(&edit).map_err(error)
    }

    pub fn restart(&mut self, seed: u32) -> Result<(), JsValue> {
        self.engine_mut()?.restart(seed);
        Ok(())
    }

    /// Restore: continue from a stored picture saved after `step` updates, the PNG bytes of a
    /// 256 × 256 8-bit RGB or opaque RGBA image, decoded without colour management as
    /// previews are. A PNG that does not decode is refused before anything changes.
    pub fn restore_picture(&mut self, png: &[u8], step: u32) -> Result<(), JsValue> {
        let rgb_CHW = crate::assets::decode_preview(png).map_err(error)?;
        self.engine_mut()?.restore_picture(rgb_CHW, step).map_err(error)
    }

    /// Noise brush: `cells` is one byte per cell, row-major, non-zero where painted.
    pub fn reseed(&mut self, cells: &[u8], seed: u32) -> Result<(), JsValue> {
        let painted: Vec<bool> = cells.iter().map(|&cell| cell != 0).collect();
        self.engine_mut()?.reseed(&painted, seed).map_err(error)
    }

    pub fn steps(&self) -> Result<u32, JsValue> {
        Ok(self.engine()?.steps())
    }

    pub fn can_update(&self) -> Result<bool, JsValue> {
        Ok(self.engine()?.can_update())
    }

    /// One update; resolves to null when there is nothing to optimize.
    pub async fn step(&mut self) -> Result<JsValue, JsValue> {
        let device = self.device.clone();
        match self.engine_mut()?.step().await.map_err(error)? {
            Some(evaluation) => evaluation_object(evaluation, &device),
            None => Ok(JsValue::NULL),
        }
    }

    pub async fn measure(&self) -> Result<JsValue, JsValue> {
        let evaluation = self.engine()?.measure().await.map_err(error)?;
        evaluation_object(evaluation, &self.device)
    }
}
