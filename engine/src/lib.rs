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

