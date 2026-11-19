//! Distill-style view augmentations: integer torus roll, scale, and rotation with wrapped
//! bilinear resampling. `sample` runs GPU-only kernels, so it compiles with `gpu` only.
#[cfg(feature = "gpu")]
use burn::tensor::{Int, Tensor, TensorData};

pub const SCALES: [f32; 5] = [0.95, 0.975, 1.0, 1.025, 1.05];

/// One view transform: an integer torus roll of up to 16 px per axis, followed by a wrapped
/// bilinear resample with a scale from `SCALES` and a whole-degree rotation of up to 5 degrees
/// about the centre.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Distill {
    /// Roll in pixels, [rows, columns], each in −16..=16.
    pub shift: [i32; 2],
    pub scale: f32,
    pub degrees: i32,
}

impl Distill {
    /// Output pixel p reads the rolled picture at this matrix times p (normalized coordinates).
    pub fn matrix(&self) -> [f32; 4] {
        // torch.deg2rad multiplies by π/180 rounded to FP32.
        let radians = self.degrees as f32 * (std::f64::consts::PI / 180.0) as f32;
        let cos = radians.cos() / self.scale;
        let sin = radians.sin() / self.scale;
        [cos, -sin, sin, cos]
    }
}

#[cfg(feature = "gpu")]
pub fn sample(image_1CHW: Tensor<4>, matrix: [f32; 4], shift: [i32; 2]) -> Tensor<4> {
    let side = image_1CHW.dims()[2];
    let device = image_1CHW.device();
    let mut indices = Vec::with_capacity(side * side * 4);
    let mut weights = Vec::with_capacity(side * side * 4);
    for row in 0..side {
        for column in 0..side {
            let x = (column as f32 + 0.5) / side as f32 * 2.0 - 1.0;
            let y = (row as f32 + 0.5) / side as f32 * 2.0 - 1.0;
            let px = (matrix[0] * x + matrix[1] * y + 1.0) * 0.5 * side as f32 - 0.5;
            let py = (matrix[2] * x + matrix[3] * y + 1.0) * 0.5 * side as f32 - 0.5;
            let fx = px - px.floor();
            let fy = py - py.floor();
            for (dx, dy, weight) in [
                (0, 0, (1.0 - fx) * (1.0 - fy)),
                (1, 0, fx * (1.0 - fy)),
                (0, 1, (1.0 - fx) * fy),
                (1, 1, fx * fy),
            ] {
                let source_x = (px.floor() as i32 + dx - shift[1]).rem_euclid(side as i32);
                let source_y = (py.floor() as i32 + dy - shift[0]).rem_euclid(side as i32);
                indices.push(source_y * side as i32 + source_x);
                weights.push(weight);
            }
        }
    }
    // The view is one sparse linear map on flattened pixels. Its input gradient
    // gathers with the exact transpose instead of scattering through all pixels.
    let pixels = side * side;
    let (transposed_indices, transposed_weights, taps) =
        crate::kernels::transpose_taps(&indices, &weights, pixels, 4);
    crate::kernels::resample_pixels(
        image_1CHW.reshape([1, 3, 1, pixels]),
        Tensor::<1, Int>::from_data(TensorData::new(indices, [pixels * 4]), &device),
        Tensor::from_data(TensorData::new(weights, [pixels, 4]), &device),
        Tensor::<1, Int>::from_data(TensorData::new(transposed_indices, [pixels * taps]), &device),
        Tensor::from_data(TensorData::new(transposed_weights, [pixels, taps]), &device),
    ).reshape([1, 3, side, side])
}

#[cfg(all(test, feature = "gpu"))]
mod tests {
    use super::*;

    /// On the GPU: the view's resample runs a GPU-only kernel (kernels::resample).
    #[test]
    #[ignore = "requires a GPU adapter"]
    fn an_unrotated_unscaled_view_is_the_torus_roll() {
        let device = crate::test_gpu_device().autodiff();
        let side = 4;
        let values: Vec<f32> = (0..3 * side * side).map(|value| value as f32).collect();
        let image_1CHW = Tensor::<4>::from_data(TensorData::new(values.clone(), [1, 3, side, side]), &device);
        let view = Distill { shift: [1, -1], scale: 1.0, degrees: 0 };
        let rolled = sample(image_1CHW, view.matrix(), view.shift).into_data().try_to_vec::<f32>().unwrap();
        // torch.roll(shifts=(1, -1)): output (y, x) reads input (y − 1, x + 1), wrapping.
        for channel in 0..3 {
            for y in 0..side {
                for x in 0..side {
                    let source = channel * side * side + ((y + side - 1) % side) * side + (x + 1) % side;
                    assert_eq!(rolled[channel * side * side + y * side + x], values[source]);
                }
            }
        }
    }
}
