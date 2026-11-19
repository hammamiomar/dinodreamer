//! Shared dictionary calibration and per-block frame loading.
//!
//! Calibrated native tokens are computed as `(x − mean) × scale` before projecting
//! onto any dictionary block's `[D, R]` orthonormal frame.

use crate::{
    assets::{LoadError, Weights},
    encoder::WIDTH,
};
use burn::tensor::{Device, Tensor};

/// Shared by every block: subtract one mean, multiply by one positive scale.
pub struct Calibration {
    pub(crate) mean_D: Tensor<1>,
    pub(crate) scale: f32,
}

impl Calibration {
    /// The calibration multiplier of the loaded dictionary.
    pub fn scale(&self) -> f32 {
        self.scale
    }

    /// Calibrated native tokens, before projection into any dictionary block.
    pub fn tokens(&self, native_BTD: Tensor<3>) -> Tensor<3> {
        (native_BTD - self.mean_D.clone().reshape([1, 1, WIDTH])) * self.scale
    }

    pub fn load(bytes: &[u8], device: &Device) -> Result<Self, LoadError> {
        let weights = Weights::new(bytes, device)?;
        let scale = weights.values("scale", [1])?[0];
        if scale <= 0.0 {
            return Err(LoadError::Contract("Calibration scale must be positive".into()));
        }
        Ok(Self {
            mean_D: weights.tensor("mean", [WIDTH])?,
            scale,
        })
    }

    #[cfg(test)]
    pub fn new(mean_D: Tensor<1>, scale: f32) -> Self {
        Self { mean_D, scale }
    }
}

/// Load one `blocks/<block>.safetensors` file: a single `frame` `[D, R]`.
pub fn load_frame(bytes: &[u8], device: &Device) -> Result<Tensor<2>, LoadError> {
    Weights::new(bytes, device)?.tensor("frame", [WIDTH, 3])
}
