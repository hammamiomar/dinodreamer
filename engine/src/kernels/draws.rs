//! Exact counter-based PCG draws. Arithmetic wraps modulo 2^32, as in grow::draws.
use burn::{
    backend::{
        AutodiffBackend, Backend, Dispatch,
        autodiff::{Autodiff, checkpoint::strategy::CheckpointStrategy},
        backend_extension,
        tensor::FloatTensor,
        wgpu::{CubeBackend, CubeTensor},
    },
    tensor::{Device, Tensor as BurnTensor},
};
use cubecl::{CubeCount, CubeDim, prelude::*};

const THREADS: u32 = 256;

#[backend_extension(Autodiff, Cube)]
pub trait CounterDrawBackend: Backend {
    fn counter_draws(
        output: FloatTensor<Self>,
        key: u32,
        rate: f32,
        noise: bool,
    ) -> FloatTensor<Self>;
}

#[cube(launch)]
fn counter_draws(output: &mut Tensor<f32>, key: u32, rate: f32, #[comptime] noise: bool) {
    let index = ABSOLUTE_POS;
    if index >= output.len() {
        terminate!();
    }
    let state = (key + index as u32) * 747796405u32 + 2891336453u32;
    let word = ((state >> ((state >> 28u32) + 4u32)) ^ state) * 277803737u32;
    let hash = (word >> 22u32) ^ word;
    let uniform = (hash >> 8u32) as f32 / 16777216.0f32;
    output[index as usize] = if noise {
        uniform - 0.5f32
    } else if uniform < rate {
        1.0f32
    } else {
        0.0f32
    };
}

impl CounterDrawBackend for CubeBackend {
    fn counter_draws(output: CubeTensor, key: u32, rate: f32, noise: bool) -> CubeTensor {
        let count = output.meta.shape().num_elements();
        counter_draws::launch(
            &output.client,
            CubeCount::Static(count.div_ceil(THREADS as usize) as u32, 1, 1),
            CubeDim::new_1d(THREADS),
            output.clone().into_tensor_arg(),
            key,
            rate,
            noise,
        );
        output
    }
}

impl<C: CheckpointStrategy> CounterDrawBackend for Autodiff<CubeBackend, C> {
    fn counter_draws(
        output: FloatTensor<Self>,
        key: u32,
        rate: f32,
        noise: bool,
    ) -> FloatTensor<Self> {
        Self::from_inner(CubeBackend::counter_draws(
            output.into_primitive(),
            key,
            rate,
            noise,
        ))
    }
}

/// N cells, C state channels. Each value is in [−0.5, 0.5), with 24 random bits.
pub fn noise(key: u32, cells: usize, channels: usize, device: &Device) -> BurnTensor<3> {
    let output_1NC = BurnTensor::<3>::empty([1, cells, channels], device);
    BurnTensor::from_dispatch(Dispatch::counter_draws(
        output_1NC.into_dispatch(),
        key,
        0.0,
        true,
    ))
}

/// One frozen binary draw per cell, with the same float32 threshold as Stream::fired.
pub fn fire_mask(key: u32, cells: usize, rate: f32, device: &Device) -> BurnTensor<3> {
    let output_1N1 = BurnTensor::<3>::empty([1, cells, 1], device);
    BurnTensor::from_dispatch(Dispatch::counter_draws(
        output_1N1.into_dispatch(),
        key,
        rate,
        false,
    ))
}
