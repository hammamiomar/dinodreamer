//! One-time loading boundary. All browser numerical tensors are FP32.

use burn::tensor::{Device, Tensor, TensorData};
use safetensors::{Dtype, SafeTensors};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LoadError {
    #[error("Cannot read tensor file: {0}")]
    File(#[from] safetensors::SafeTensorError),
    #[error("Tensor {name} has shape {actual:?}; expected {expected:?}")]
    Shape {
        name: String,
        actual: Vec<usize>,
        expected: Vec<usize>,
    },
    #[error("Tensor {0} must contain finite FP32 values")]
    Values(String),
    #[error("Invalid model asset: {0}")]
    Contract(String),
}

/// The exporter casts checkpoint values once. This loader never silently changes dtype.
pub struct Weights<'a> {
    tensors: SafeTensors<'a>,
    device: &'a Device,
}

impl<'a> Weights<'a> {
    pub fn new(bytes: &'a [u8], device: &'a Device) -> Result<Self, LoadError> {
        Ok(Self {
            tensors: SafeTensors::deserialize(bytes)?,
            device,
        })
    }

    pub fn tensor<const D: usize>(
        &self,
        name: &str,
        shape: [usize; D],
    ) -> Result<Tensor<D>, LoadError> {
        Ok(Tensor::from_data(
            TensorData::new(self.values(name, shape)?, shape),
            self.device,
        ))
    }

    /// Read a fixture or scalar without uploading it to the GPU first.
    pub fn values<const D: usize>(
        &self,
        name: &str,
        shape: [usize; D],
    ) -> Result<Vec<f32>, LoadError> {
        let tensor = self.tensors.tensor(name)?;
        if tensor.shape() != shape {
            return Err(LoadError::Shape {
                name: name.into(),
                actual: tensor.shape().to_vec(),
                expected: shape.to_vec(),
            });
        }
        if tensor.dtype() != Dtype::F32 {
            return Err(LoadError::Values(name.into()));
        }
        let values: Vec<f32> = tensor
            .data()
            .chunks_exact(4)
            .map(|v| f32::from_le_bytes(v.try_into().unwrap()))
            .collect();
        if values.iter().any(|v| !v.is_finite()) {
            return Err(LoadError::Values(name.into()));
        }
        Ok(values)
    }
}

/// Decode a 256 × 256 preview PNG to FP32 RGB in [0, 1], [3, H, W] row-major.
///
/// No color management: gAMA, cHRM, sRGB and iCCP chunks are ignored, as PIL's
/// `convert("RGB")` ignores them. Previews are the exact prepared views, so an 8-bit
/// RGB or opaque RGBA file is expected; anything else is refused rather than guessed.
pub fn decode_preview(bytes: &[u8]) -> Result<Vec<f32>, LoadError> {
    let invalid = |message: &str| LoadError::Contract(format!("Preview PNG: {message}"));
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().map_err(|error| invalid(&error.to_string()))?;
    let (size, pixels) = (crate::image::SIZE, crate::image::SIZE * crate::image::SIZE);
    if reader.info().width as usize != size || reader.info().height as usize != size {
        return Err(invalid("expected 256 × 256 pixels"));
    }
    let mut buffer = vec![0; reader.output_buffer_size().ok_or_else(|| invalid("too large"))?];
    let info = reader.next_frame(&mut buffer).map_err(|error| invalid(&error.to_string()))?;
    if info.bit_depth != png::BitDepth::Eight {
        return Err(invalid("expected 8-bit samples"));
    }
    let channels = match info.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        _ => return Err(invalid("expected RGB or RGBA")),
    };
    let samples = &buffer[..pixels * channels];
    if channels == 4 && samples.chunks_exact(4).any(|pixel| pixel[3] != 255) {
        return Err(invalid("transparent pixels have no defined background"));
    }
    let mut rgb_CHW = vec![0.0; 3 * pixels];
    for (pixel, sample) in samples.chunks_exact(channels).enumerate() {
        for channel in 0..3 {
            rgb_CHW[channel * pixels + pixel] = sample[channel] as f32 / 255.0;
        }
    }
    Ok(rgb_CHW)
}

#[cfg(test)]
mod tests {
    use super::decode_preview;

    fn png(width: u32, height: u32, color: png::ColorType, pixels: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(color);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(pixels).unwrap();
        }
        bytes
    }

    #[test]
    fn refuses_wrong_dimensions_before_decoding_image_data() {
        let mut bytes = png(257, 1, png::ColorType::Rgb, &vec![0; 257 * 3]);
        // Keep the PNG header and the IDAT header, but no compressed image data.
        bytes.truncate(41);
        let error = decode_preview(&bytes).unwrap_err().to_string();
        assert!(error.contains("expected 256 × 256 pixels"), "{error}");
    }

    #[test]
    fn decodes_opaque_rgba_to_channel_first_rgb_and_refuses_transparency() {
        let mut pixels = [51, 102, 153, 255].repeat(256 * 256);
        let bytes = png(256, 256, png::ColorType::Rgba, &pixels);
        let rgb_CHW = decode_preview(&bytes).unwrap();
        for (channel, values) in rgb_CHW.chunks_exact(256 * 256).enumerate() {
            assert!(values.iter().all(|&value| value == (channel + 1) as f32 / 5.0));
        }
        pixels[3] = 0;
        let error = decode_preview(&png(256, 256, png::ColorType::Rgba, &pixels)).unwrap_err().to_string();
        assert!(error.contains("transparent pixels"), "{error}");
    }
}
