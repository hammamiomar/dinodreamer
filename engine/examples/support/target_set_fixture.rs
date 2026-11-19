//! Target-set fixture helpers shared by `grow_recipe_parity` and `target_set_check`: loads a
//! target-set PNG window sheet and JSON metadata, and compares the prepared set with the oracle
//! record produced by `tools/prepare_grow_recipe.py`.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use dinodreamer_engine::grow::figure::{
    Layer,
    target_set::{TargetSet, WINDOW_SIDE},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{fs, path::Path};

/// The engine's prepared set against the oracle's, from the same windows: relative error of the
/// unit σ, the median distance h and the self-similarity, relative RMS of the mean μ and of the
/// standardized features. DINO runs in float32 on both sides with different kernels and summation
/// orders. Measured on 17 November 2026 (group 12002, native WGPU): at most 5.8e-7 for the scalars,
/// 7.0e-7 for the mean and 8.1e-6 for the standardized features. A wrong layer, window, or dot shows
/// at 1e-1 and above.
pub const SET_SCALAR_TOLERANCE: f64 = 1e-5;
pub const SET_VECTOR_TOLERANCE: f64 = 1e-4;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFile {
    pub block: u32,
    pub sheet: String,
    pub columns: usize,
    pub pictures: Vec<SetPicture>,
}

/// A set picture's dot on its window's 8 × 8 grid; the file also names its source and patch.
#[derive(Deserialize)]
pub struct SetPicture {
    pub dot: usize,
}

/// The oracle's prepared set (`SetMethod.record`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRecord {
    pub file: String,
    pub layers: Vec<LayerRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerRecord {
    pub layer: Layer,
    pub tokens: usize,
    pub width: usize,
    pub mean: String,
    pub rms: f64,
    pub median_distance: f64,
    pub yy: f64,
    pub standardized_step: usize,
    pub standardized: String,
}

pub fn floats(encoded: &str) -> Vec<f32> {
    STANDARD
        .decode(encoded)
        .expect("base64 float32 values")
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
        .collect()
}

/// The set file's windows [P, 3, 128, 128] in [0, 1], channel-major, and the dot of each.
pub fn load_windows(path: &Path) -> (Vec<f32>, Vec<usize>, SetFile) {
    let file: SetFile = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    let decoder = png::Decoder::new(std::io::BufReader::new(fs::File::open(path.with_file_name(&file.sheet)).unwrap()));
    let mut reader = decoder.read_info().unwrap();
    let mut sheet = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut sheet).unwrap();
    assert_eq!((info.color_type, info.bit_depth), (png::ColorType::Rgb, png::BitDepth::Eight), "an 8-bit RGB sheet");
    let width = info.width as usize;
    let mut windows = Vec::with_capacity(file.pictures.len() * 3 * WINDOW_SIDE * WINDOW_SIDE);
    for index in 0..file.pictures.len() {
        let (top, left) = (index / file.columns * WINDOW_SIDE, index % file.columns * WINDOW_SIDE);
        for channel in 0..3 {
            for y in top..top + WINDOW_SIDE {
                for x in left..left + WINDOW_SIDE {
                    windows.push(sheet[(y * width + x) * 3 + channel] as f32 / 255.0);
                }
            }
        }
    }
    let dots = file.pictures.iter().map(|picture| picture.dot).collect();
    (windows, dots, file)
}

fn relative(actual: f64, expected: f64) -> f64 {
    (actual - expected).abs() / expected.abs().max(1e-12)
}

fn relative_rms(actual: &[f32], expected: &[f32]) -> f64 {
    assert_eq!(actual.len(), expected.len(), "compared arrays differ in length");
    let error: f64 = actual.iter().zip(expected).map(|(a, e)| (*a as f64 - *e as f64).powi(2)).sum();
    let norm: f64 = expected.iter().map(|e| (*e as f64).powi(2)).sum();
    (error / norm.max(1e-30)).sqrt()
}

/// The engine's prepared set against the oracle's record, layer by layer: a report and whether it passes.
pub fn compare_set(target: &TargetSet, record: &SetRecord) -> (Value, bool) {
    assert_eq!(target.layers.len(), record.layers.len(), "the engine and the oracle compare the same layers");
    let mut pass = true;
    let layers: Vec<Value> = target.layers.iter().zip(&record.layers).map(|(layer, expected)| {
        assert_eq!(layer.layer, expected.layer, "the layers come in the request's order");
        let [tokens, width] = layer.standardized_ND.dims();
        let mean = pollster::block_on(layer.mean_1D.clone().flatten::<1>(0, 1).into_data_async()).unwrap().try_to_vec::<f32>().unwrap();
        let standardized = pollster::block_on(layer.standardized_ND.clone().flatten::<1>(0, 1).into_data_async()).unwrap().try_to_vec::<f32>().unwrap();
        let sample: Vec<f32> = standardized.iter().step_by(expected.standardized_step).copied().collect();
        let errors = json!({
            "unit": relative(layer.unit as f64, expected.rms),
            "medianDistance": relative(layer.median_distance as f64, expected.median_distance),
            "selfSimilarity": relative(layer.self_similarity as f64, expected.yy),
            "mean": relative_rms(&mean, &floats(&expected.mean)),
            "standardized": relative_rms(&sample, &floats(&expected.standardized)),
        });
        let scalars = ["unit", "medianDistance", "selfSimilarity"].iter().all(|key| errors[key].as_f64().unwrap() <= SET_SCALAR_TOLERANCE);
        let vectors = ["mean", "standardized"].iter().all(|key| errors[key].as_f64().unwrap() <= SET_VECTOR_TOLERANCE);
        let shape = (tokens, width) == (expected.tokens, expected.width);
        pass &= scalars && vectors && shape;
        json!({
            "layer": layer.layer,
            "tokens": [tokens, expected.tokens],
            "unit": [layer.unit, expected.rms],
            "medianDistance": [layer.median_distance, expected.median_distance],
            "selfSimilarity": [layer.self_similarity, expected.yy],
            "errors": errors,
        })
    }).collect();
    // Every token's code, against the oracle's where it recorded them: basis-group distribution's
    // features are the codes, standardized, so the codes are the unit times them plus the mean.
    let codes_error = record.layers.iter().find(|layer| layer.width == 3).map(|layer| {
        let mean = floats(&layer.mean);
        let expected: Vec<f32> = floats(&layer.standardized)
            .chunks_exact(3)
            .flat_map(|code| (0..3).map(|axis| code[axis] * layer.rms as f32 + mean[axis]).collect::<Vec<f32>>())
            .collect();
        relative_rms(&target.codes_NR, &expected)
    });
    pass &= target.codes_NR.len() == 3 * target.pictures_N.len() && codes_error.is_none_or(|error| error <= SET_VECTOR_TOLERANCE);
    (json!({"pictures": target.pictures, "layers": layers, "codes": codes_error, "pass": pass,
            "tolerances": {"scalars": SET_SCALAR_TOLERANCE, "vectors": SET_VECTOR_TOLERANCE}}), pass)
}
