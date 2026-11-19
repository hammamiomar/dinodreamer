use super::{BrowserEngine, error, set};
use crate::{
    encoder::{PREFIX, TOKENS, WIDTH},
    image::{GRID, SIZE},
};
use burn::tensor::{Tensor, TensorData};
use js_sys::{Float32Array, Object, Uint16Array};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl BrowserEngine {
    pub fn load_reader_chunk(
        &mut self,
        first: usize,
        count: usize,
        bytes: &[u8],
    ) -> Result<(), JsValue> {
        self.reader
            .load(first, count, bytes, &self.device)
            .map_err(error)
    }
    /// Read exactly the opaque displayed image. No crop, jitter, objective, or update.
    pub async fn read_image(&self, rgba: &[u8]) -> Result<JsValue, JsValue> {
        let image_1CHW = self.opaque_picture(rgba)?;
        let engine = self.engine()?;
        let native_1TD = engine
            .encoder
            .forward(image_1CHW)
            .slice([0..1, PREFIX..TOKENS, 0..WIDTH]);
        let tokens_1TD = engine.calibration.tokens(native_1TD);
        let addresses = self.reader.read(tokens_1TD).await.map_err(error)?;
        let result = Object::new();
        set(&result, "grid", GRID as u32)?;
        set(
            &result,
            "blocks",
            Uint16Array::from(addresses.blocks.as_slice()),
        )?;
        set(
            &result,
            "codes",
            Float32Array::from(addresses.codes.as_slice()),
        )?;
        set(
            &result,
            "norms",
            Float32Array::from(addresses.norms.as_slice()),
        )?;
        Ok(result.into())
    }
}

impl BrowserEngine {
    /// A 256×256 opaque RGBA picture as the encoder reads it, [1, 3, 256, 256] in [0, 1].
    pub(super) fn opaque_picture(&self, rgba: &[u8]) -> Result<Tensor<4>, JsValue> {
        let pixels = SIZE * SIZE;
        if rgba.len() != pixels * 4 || rgba.chunks_exact(4).any(|p| p[3] != 255) {
            return Err(error("Reader input must be 256×256 opaque RGBA"));
        }
        let rgb_CHW: Vec<f32> = (0..3)
            .flat_map(|channel| {
                (0..pixels).map(move |pixel| rgba[pixel * 4 + channel] as f32 / 255.0)
            })
            .collect();
        Ok(Tensor::from_data(TensorData::new(rgb_CHW, [1, 3, SIZE, SIZE]), &self.device))
    }
}
