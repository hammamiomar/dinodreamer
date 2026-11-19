#![allow(non_snake_case)] // Tensor suffixes document axes, e.g. tokens_BTD.

pub mod appearance;
pub mod assets;
pub mod calibration;
pub mod curve;
pub mod encoder;
pub mod grow;
pub mod image;
pub mod objective;
pub mod optimizer;
pub mod profiling;
pub mod ranking;
pub mod reader;
pub mod state;

pub use calibration::{Calibration, load_frame};

#[cfg(feature = "harness")]
pub mod qualification;

#[cfg(feature = "gpu")]
pub mod kernels;
#[cfg(target_arch = "wasm32")]
mod web;

/// The wgpu device of the GPU unit tests. Burn initializes a wgpu runtime once per process and
/// refuses a second `init`, so every GPU test takes a clone of this one device.
#[cfg(all(test, feature = "gpu"))]
pub(crate) fn test_gpu_device() -> burn::tensor::Device {
    static DEVICE: std::sync::OnceLock<burn::tensor::Device> = std::sync::OnceLock::new();
    DEVICE
        .get_or_init(|| burn::tensor::Device::wgpu_options().init().expect("a GPU adapter"))
        .clone()
}
