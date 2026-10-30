//! The /how explorables' window into the engine:
//! one block's frame, one layer of DINO laid open, and one token through the gate. Read only;
//! no training or replay path calls them.
use super::{BrowserEngine, error, set};
use crate::{
    encoder::{DEPTH, HEADS, TOKENS, WIDTH},
    reader::{PASS_003_SCALE, RECONSTRUCTION_GAIN},
};
use burn::tensor::{Tensor, TensorData};
use js_sys::{Float32Array, Object, Uint16Array};
use wasm_bindgen::prelude::*;

async fn floats<const D: usize>(tensor: Tensor<D>) -> Result<Vec<f32>, JsValue> {
    tensor.into_data_async().await.map_err(error)?.try_to_vec::<f32>().map_err(error)
}

#[wasm_bindgen]
impl BrowserEngine {
    /// Block `block`'s three orthonormal directions, row-major [3, 768], in calibrated
    /// coordinates. Needs the whole reader.
    pub async fn frame(&self, block: u32) -> Result<Float32Array, JsValue> {
        let frame_RD = self.reader.frame(block as usize).map_err(error)?;
        Ok(Float32Array::from(floats(frame_RD).await?.as_slice()))
    }

    /// One full pass over a 256×256 opaque RGBA picture with layer `layer` (0–11) laid open:
    /// `before` and `after` [261 × 768], the residual stream entering and leaving the layer;
    /// `attention` [12 × 261 × 261], its softmax weights (row = query token, column = key
    /// token; token 0 the class token, 1–4 the registers, 5–260 the 16×16 patches row-major);
    /// `final` [261 × 768], the tokens after the final LayerNorm, the reader's input.
    pub async fn encode_probe(&self, rgba: &[u8], layer: u32) -> Result<JsValue, JsValue> {
        if layer as usize >= DEPTH {
            return Err(error("DINO has layers 0 to 11"));
        }
        let image_1CHW = self.opaque_picture(rgba)?;
        let probe = self.engine()?.encoder.probe(image_1CHW, layer as usize);
        let result = Object::new();
        set(&result, "layer", layer)?;
        set(&result, "tokens", TOKENS as u32)?;
        set(&result, "heads", HEADS as u32)?;
        set(&result, "before", Float32Array::from(floats(probe.before_1TD).await?.as_slice()))?;
        set(&result, "after", Float32Array::from(floats(probe.after_1TD).await?.as_slice()))?;
        set(&result, "attention", Float32Array::from(floats(probe.attention_1HTT).await?.as_slice()))?;
        set(&result, "final", Float32Array::from(floats(probe.native_1TD).await?.as_slice()))?;
        Ok(result.into())
    }

    /// One native token [768] (a row of `encode_probe().final`) through the gate: `calibrated`
    /// [768]; its 32 winners strongest first, `blocks`, with gain-free `codes` [32 × 3] and
    /// `norms` [32], as `read_image` ranks them; `gain`; `reconstruction` [768], gain · Σ F_k c_k
    /// in calibrated coordinates; and `residual`, ‖x − x̂‖ / ‖x‖. Needs the whole reader.
    pub async fn gate(&self, token: &[f32]) -> Result<JsValue, JsValue> {
        if token.len() != WIDTH || token.iter().any(|value| !value.is_finite()) {
            return Err(error("A token has 768 finite values"));
        }
        let engine = self.engine()?;
        if (engine.calibration.scale() - PASS_003_SCALE).abs() > 1e-6 * PASS_003_SCALE {
            return Err(error("The reconstruction gain belongs to the pass-003 dictionary"));
        }
        let native_11D = Tensor::<3>::from_data(TensorData::new(token.to_vec(), [1, 1, WIDTH]), &self.device);
        let calibrated_11D = engine.calibration.tokens(native_11D);
        let calibrated_D = floats(calibrated_11D.clone()).await?;
        let gate = self.reader.gate(calibrated_11D).await.map_err(error)?;
        let squared = |values: &mut dyn Iterator<Item = f32>| values.map(|value| value * value).sum::<f32>();
        let residual = squared(&mut calibrated_D.iter().zip(&gate.reconstruction_D).map(|(x, r)| x - r)).sqrt()
            / squared(&mut calibrated_D.iter().copied()).sqrt();
        let result = Object::new();
        set(&result, "calibrated", Float32Array::from(calibrated_D.as_slice()))?;
        set(&result, "blocks", Uint16Array::from(gate.addresses.blocks.as_slice()))?;
        set(&result, "codes", Float32Array::from(gate.addresses.codes.as_slice()))?;
        set(&result, "norms", Float32Array::from(gate.addresses.norms.as_slice()))?;
        set(&result, "gain", RECONSTRUCTION_GAIN)?;
        set(&result, "reconstruction", Float32Array::from(gate.reconstruction_D.as_slice()))?;
        set(&result, "residual", residual)?;
        Ok(result.into())
    }
}
