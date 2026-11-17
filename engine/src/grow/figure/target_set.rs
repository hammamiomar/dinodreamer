//! The target set of the set methods: the tokens of a basis group's strongest pictures that token
//! mean, basis-group distribution and token distribution matching compare the canvas with. The
//! numerical reference is the given-set tool (research/given-set: `given_set.build`,
//! `library.aligned_window`, `objective.PreparedLayer`, `objective.mmd`).
//!
//! Symbols. A set picture is a 256 px library picture and one patch of its 16 × 16 grid. Its window
//! is the aligned 128 px window that holds the patch nearest the window's centre; the dot is that
//! patch on the window's 8 × 8 grid. DINO reads each window at 128 px, the canvas's own size, and the
//! set keeps the 3 × 3 tokens around the dot, fewer at a window's edge: y_n, n = 1..N, N ≤ 9P for P
//! pictures. A layer's features are DINO's tokens there (D = 768) or, for basis-group distribution,
//! the codes z = Fᵀc of the calibrated final tokens (D = R = 3).
//!
//! Fixed at preparation, per layer (fitted to the set, never trained):
//!   μ = mean_n y_n,  σ = max(√(mean_n ‖y_n − μ‖²), 0.25 · √(mean_n ‖y_n‖²)),  ŷ_n = (y_n − μ) / σ,
//!   h = the median of the N(N−1)/2 distances ‖ŷ_i − ŷ_j‖ (the element at index ⌊N(N−1)/4⌋ of the sorted
//!   squared distances, then its root), the kernel widths w_b = b·h for b ∈ {0.5, 1, 2, 4},
//!   and the self-similarity E k(ŷ, ŷ') = mean over i ≠ j of k(ŷ_i, ŷ_j),
//! with the kernel k(a, b) = mean_b exp(−‖a − b‖² / (2 w_b²)). A member lies about 1 from μ in these units.
//!
//! Per update, the M canvas features x_m (the scored patches of every view, `region_features`) are
//! standardized by the same μ and σ, x̂ = (x − μ)/σ, and a layer's loss is
//!   mean matching:          ‖mean_m x̂_m‖²
//!   distribution matching:  E k(x̂, x̂') − 2 E k(x̂, ŷ) + E k(ŷ, ŷ')   (the unbiased MMD²: x̂ ≠ x̂', ŷ ≠ ŷ')
//! E k(x̂, x̂') rises when the canvas's patches gather, E k(x̂, ŷ) when they approach the set. The
//! method's loss is the mean over its layers. Example: a canvas whose 128 patches all equal the set's
//! mean has mean-matching loss 0, but E k(x̂, x̂') = 1, so its distribution loss stays positive.
use super::{FigureRequest, Layer, Method, PATCHES};
use crate::encoder::{Dino, PREFIX, WIDTH};
use crate::objective::Calibration;
use burn::tensor::{Int, Tensor, TensorData};

/// The research's standard set: the group's 33 strongest distinct public pictures.
pub const SET_PICTURES: usize = 33;
pub const WINDOW_SIDE: usize = 128;
/// Patches per side of a window, and of a 256 px library picture.
pub const WINDOW_PATCHES: usize = 8;
pub const PICTURE_PATCHES: usize = 16;
const PATCH_SIDE: usize = 16;
pub const BANDWIDTHS: [f32; 4] = [0.5, 1.0, 2.0, 4.0];
/// A set of one token has no spread: its unit falls back to this share of its raw size.
const RMS_FLOOR_SHARE: f32 = 0.25;
/// The research draws at most this many set tokens for the median and per update (`PAIRWISE_SAMPLE`,
/// `set_sample`). The engine's sets stay within it, so no draw is needed, and it refuses larger ones.
pub const MOST_TOKENS: usize = 1024;

/// Where a set picture's window lies on its 16 × 16 grid: the first patch row and column, and the
/// picture's patch on the window's 8 × 8 grid (`library.aligned_window`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Window {
    pub row: usize,
    pub column: usize,
    pub dot: usize,
}

/// The aligned window of `patch`, a row-major position on the 16 × 16 grid of a 256 px picture.
pub fn aligned_window(patch: usize) -> Window {
    let (row, column) = (patch / PICTURE_PATCHES, patch % PICTURE_PATCHES);
    let half = WINDOW_PATCHES / 2;
    let first = |position: usize| position.saturating_sub(half).min(PICTURE_PATCHES - WINDOW_PATCHES);
    let (row0, column0) = (first(row), first(column));
    Window { row: row0, column: column0, dot: (row - row0) * WINDOW_PATCHES + (column - column0) }
}

/// The window's pixels [3, 128, 128] from a picture's [3, 256, 256], both channel-major.
pub fn window_pixels(picture_CHW: &[f32], window: Window) -> Vec<f32> {
    let side = PICTURE_PATCHES * PATCH_SIDE;
    assert_eq!(picture_CHW.len(), 3 * side * side, "a 256 px RGB picture");
    let (top, left) = (window.row * PATCH_SIDE, window.column * PATCH_SIDE);
    let mut window_CHW = Vec::with_capacity(3 * WINDOW_SIDE * WINDOW_SIDE);
    for channel in 0..3 {
        for y in top..top + WINDOW_SIDE {
            let start = (channel * side + y) * side + left;
            window_CHW.extend_from_slice(&picture_CHW[start..start + WINDOW_SIDE]);
        }
    }
    window_CHW
}

/// The patches the dot brings on the window's 8 × 8 grid: the 3 × 3 around it, clipped at the
/// edges, row-major (`library.neighbourhood_patches(dot, "3x3", 8)`).
pub fn neighbourhood(dot: usize) -> Vec<usize> {
    let (row, column) = (dot / WINDOW_PATCHES, dot % WINDOW_PATCHES);
    let span = |centre: usize| centre.saturating_sub(1)..(centre + 2).min(WINDOW_PATCHES);
    span(row).flat_map(|r| span(column).map(move |c| r * WINDOW_PATCHES + c)).collect()
}

/// ‖a_m − b_n‖² for every pair, [M, N], by expansion, which has no square root to break the gradient;
/// clamped at zero against rounding.
pub fn squared_distances(a_MD: Tensor<2>, b_ND: Tensor<2>) -> Tensor<2> {
    let a_M1 = a_MD.clone().square().sum_dim(1);
    let b_1N = b_ND.clone().square().sum_dim(1).transpose();
    (a_M1 + b_1N - a_MD.matmul(b_ND.transpose()) * 2.0).clamp_min(0.0)
}

/// The kernel on squared distances: the mean over the widths of exp(−d / (2 w²)), same shape. All
/// widths in one expression, as the research writes it (`objective.kernel`): `scales_11W` holds
/// −2 w² per width.
pub fn kernel(distances_MN: Tensor<2>, scales_11W: &Tensor<3>) -> Tensor<2> {
    let [rows, columns] = distances_MN.dims();
    (distances_MN.reshape([rows, columns, 1]) / scales_11W.clone()).exp().mean_dim(2).reshape([rows, columns])
}

/// −2 w² for each kernel width, [1, 1, W]: the divisors of `kernel`.
fn kernel_scales(widths: &[f32; 4], device: &burn::tensor::Device) -> Tensor<3> {
    let scales: Vec<f32> = widths.iter().map(|width| -2.0 * width * width).collect();
    Tensor::from_data(TensorData::new(scales, [1, 1, widths.len()]), device)
}

/// The mean of a square matrix's off-diagonal entries, [1]; zero for a 1 × 1 matrix. The diagonal
/// is masked out, so it carries no gradient.
pub fn off_diagonal_mean(matrix_MM: Tensor<2>) -> Tensor<1> {
    let count = matrix_MM.dims()[0];
    let device = matrix_MM.device();
    if count < 2 {
        return Tensor::zeros([1], &device);
    }
    let rows_MM = Tensor::<1, Int>::arange(0..count as i64, &device).reshape([count, 1]).expand([count, count]);
    let columns_MM = Tensor::<1, Int>::arange(0..count as i64, &device).reshape([1, count]).expand([count, count]);
    let off_diagonal_MM = rows_MM.not_equal(columns_MM).float();
    (matrix_MM * off_diagonal_MM).sum().reshape([1]) / (count * (count - 1)) as f32
}

/// One layer's loss terms on the canvas: its value and, for a distribution, the kernel means
/// E k(x̂, x̂') and E k(x̂, ŷ). Each is [1].
#[derive(Clone)]
pub struct LayerTerms {
    pub value: Tensor<1>,
    pub kernel_means: Option<[Tensor<1>; 2]>,
}

/// One layer of the set, standardized once (`objective.PreparedLayer`).
#[derive(Clone)]
pub struct SetLayer {
    pub layer: Layer,
    /// μ, [1, D].
    pub mean_1D: Tensor<2>,
    /// σ, the unit of every distance.
    pub unit: f32,
    /// ŷ, [N, D].
    pub standardized_ND: Tensor<2>,
    /// h, the median pairwise distance of ŷ.
    pub median_distance: f32,
    pub widths: [f32; 4],
    /// E k(ŷ, ŷ') over distinct members.
    pub self_similarity: f32,
    /// Fixed with the set, so an update does not recompute them: −2 w² per width [1, 1, 4] and
    /// ‖ŷ_n‖² [1, N].
    kernel_scales_11W: Tensor<3>,
    squared_norms_1N: Tensor<2>,
}

impl SetLayer {
    /// Standardize the set's features [N, D] and fit the kernel. Reads back from the device.
    pub async fn prepare(layer: Layer, features_ND: Tensor<2>) -> Result<Self, String> {
        let count = features_ND.dims()[0];
        if !(2..=MOST_TOKENS).contains(&count) {
            return Err(format!("A target set needs 2 to {MOST_TOKENS} tokens, not {count}"));
        }
        let mean_1D = features_ND.clone().mean_dim(0);
        let centred_rms = (features_ND.clone() - mean_1D.clone()).square().sum_dim(1).mean().sqrt().reshape([1]);
        let raw_rms = features_ND.clone().square().sum_dim(1).mean().sqrt().reshape([1]);
        let spreads = read(Tensor::cat(vec![centred_rms, raw_rms], 0)).await?;
        let unit = spreads[0].max(RMS_FLOOR_SHARE * spreads[1]);
        if !(unit.is_finite() && unit > 0.0) {
            return Err("The target set has no finite spread".into());
        }
        let standardized_ND = (features_ND - mean_1D.clone()) / unit;
        let distances_NN = squared_distances(standardized_ND.clone(), standardized_ND.clone());
        let median_distance = median_pairwise(&read(distances_NN.clone().flatten(0, 1)).await?, count).sqrt();
        let widths = BANDWIDTHS.map(|bandwidth| bandwidth * median_distance);
        let kernel_scales_11W = kernel_scales(&widths, &standardized_ND.device());
        let self_similarity = read(off_diagonal_mean(kernel(distances_NN, &kernel_scales_11W))).await?[0];
        Ok(Self {
            layer,
            mean_1D,
            unit,
            squared_norms_1N: standardized_ND.clone().square().sum_dim(1).transpose(),
            standardized_ND,
            median_distance,
            widths,
            self_similarity,
            kernel_scales_11W,
        })
    }

    /// ‖x̂_m − ŷ_n‖² for standardized canvas features [M, D], [M, N]: `squared_distances` with the
    /// set's terms fixed at preparation.
    fn squared_distances_to_set(&self, canvas_MD: Tensor<2>) -> Tensor<2> {
        let [members, width] = canvas_MD.dims();
        let canvas_M1 = canvas_MD.clone().square().sum_dim(1);
        let products_MN = fixed_product(canvas_MD.reshape([1, members, width]), &self.standardized_ND).reshape([members, self.standardized_ND.dims()[0]]);
        (canvas_M1 + self.squared_norms_1N.clone() - products_MN * 2.0).clamp_min(0.0)
    }

    /// x̂ = (x − μ) / σ for canvas features [M, D].
    pub fn standardized(&self, features_MD: Tensor<2>) -> Tensor<2> {
        (features_MD - self.mean_1D.clone()) / self.unit
    }

    /// ‖mean_m x̂_m‖².
    pub fn mean_terms(&self, features_MD: Tensor<2>) -> LayerTerms {
        let value = self.standardized(features_MD).mean_dim(0).square().sum().reshape([1]);
        LayerTerms { value, kernel_means: None }
    }

    /// E k(x̂, x̂'), [1], with the products x̂ x̂ᵀ on the fixed-product kernel. The distances
    /// d_ij = ‖x̂_i‖² + ‖x̂_j‖² − 2 x̂_i·x̂_j are symmetric and so is the off-diagonal mask, so the gradient
    /// through the second operand equals the gradient through the first. The second operand is
    /// therefore detached and the gradient doubled: 2g − stop(g) has the value g and twice its gradient.
    fn gathered_kernel_mean(&self, canvas_MD: Tensor<2>) -> Tensor<1> {
        let [members, width] = canvas_MD.dims();
        let fixed_MD = canvas_MD.clone().detach();
        let canvas_M1 = canvas_MD.clone().square().sum_dim(1);
        let fixed_1M = fixed_MD.clone().square().sum_dim(1).transpose();
        let products_MM = fixed_product(canvas_MD.reshape([1, members, width]), &fixed_MD).reshape([members, members]);
        let distances_MM = (canvas_M1 + fixed_1M - products_MM * 2.0).clamp_min(0.0);
        let half = off_diagonal_mean(kernel(distances_MM, &self.kernel_scales_11W));
        half.clone() * 2.0 - half.detach()
    }

    /// E k(x̂, x̂') − 2 E k(x̂, ŷ) + E k(ŷ, ŷ'), with its two canvas terms.
    pub fn distribution_terms(&self, features_MD: Tensor<2>) -> LayerTerms {
        let canvas_MD = self.standardized(features_MD);
        let gathered = self.gathered_kernel_mean(canvas_MD.clone());
        let approached = kernel(self.squared_distances_to_set(canvas_MD), &self.kernel_scales_11W).mean().reshape([1]);
        let value = gathered.clone() - approached.clone() * 2.0 + self.self_similarity;
        LayerTerms { value, kernel_means: Some([gathered, approached]) }
    }
}

/// The element at index ⌊K/2⌋ of the K = N(N−1)/2 sorted squared distances above the diagonal of
/// an [N, N] matrix (row-major), as the research takes its median.
fn median_pairwise(distances_NN: &[f32], count: usize) -> f32 {
    let mut upper: Vec<f32> = (0..count).flat_map(|row| (row + 1..count).map(move |column| (row, column)))
        .map(|(row, column)| distances_NN[row * count + column])
        .collect();
    let middle = upper.len() / 2;
    *upper.select_nth_unstable_by(middle, f32::total_cmp).1
}

async fn read(values: Tensor<1>) -> Result<Vec<f32>, String> {
    let values = values.into_data_async().await.map_err(|e| e.to_string())?.try_to_vec::<f32>().map_err(|e| e.to_string())?;
    if values.iter().any(|value| !value.is_finite()) {
        return Err("The target set's statistics are not finite".into());
    }
    Ok(values)
}

/// A method's loss on the canvas: the mean over the layers, and each layer's terms.
#[derive(Clone)]
pub struct SetLoss {
    pub value: Tensor<1>,
    pub layers: Vec<LayerTerms>,
}

/// The prepared set of one request's method, layers and basis group.
#[derive(Clone)]
pub struct TargetSet {
    pub method: Method,
    pub block: u32,
    pub pictures: usize,
    /// In the request's order of compared layers (`FigureRequest::compared_layers`).
    pub layers: Vec<SetLayer>,
}

impl TargetSet {
    /// Read the windows [P, 3, 128, 128] (values in [0, 1]) with DINO in one pass, keep the 3 × 3
    /// tokens around each window's dot and prepare every layer the request's method compares.
    /// `frame_RD` is the request block's frame, [3, 768].
    pub async fn prepare(
        encoder: &Dino,
        calibration: &Calibration,
        frame_RD: &Tensor<2>,
        request: &FigureRequest,
        windows_P3HW: Tensor<4>,
        dots: &[usize],
    ) -> Result<Self, String> {
        request.validate()?;
        let [pictures, channels, height, width] = windows_P3HW.dims();
        if !request.method.needs_set() || pictures != dots.len() || pictures == 0 || [channels, height, width] != [3, WINDOW_SIDE, WINDOW_SIDE] {
            return Err("A target set needs a set method and one 128 px RGB window per dot".into());
        }
        if dots.iter().any(|&dot| dot >= PATCHES) {
            return Err("A dot is a patch of the window's 8 × 8 grid".into());
        }
        let device = windows_P3HW.device();
        let kept: Vec<i64> = dots.iter().enumerate()
            .flat_map(|(picture, &dot)| neighbourhood(dot).into_iter().map(move |patch| (picture * PATCHES + patch) as i64))
            .collect();
        let kept_N = Tensor::<1, Int>::from_data(TensorData::new(kept.clone(), [kept.len()]), &device);
        let gathered = |tokens_PTX: Tensor<3>| {
            let width = tokens_PTX.dims()[2];
            tokens_PTX.reshape([pictures * PATCHES, width]).select(0, kept_N.clone())
        };
        let blocks = request.intermediate_blocks();
        let readout = encoder.readout(windows_P3HW, &blocks);
        let native_PTD = readout.native_BTD.slice([0..pictures, PREFIX..PREFIX + PATCHES, 0..WIDTH]);
        let mut layers = Vec::new();
        for layer in request.compared_layers() {
            let features_ND = match (request.method, layer) {
                (Method::BasisGroupDistribution, _) => gathered(fixed_product(calibration.tokens(native_PTD.clone()), frame_RD)),
                (_, Layer::Final) => gathered(native_PTD.clone()),
                (_, Layer::Block(block)) => {
                    let position = blocks.iter().position(|&read| read == block).expect("every block layer is read");
                    gathered(readout.intermediate_BPD[position].clone())
                }
            };
            layers.push(SetLayer::prepare(layer, features_ND).await?);
        }
        Ok(Self { method: request.method, block: request.block, pictures, layers })
    }

    /// Whether this set serves the request: the same method, basis group and layers.
    pub fn serves(&self, request: &FigureRequest) -> Result<(), String> {
        let layers: Vec<Layer> = self.layers.iter().map(|layer| layer.layer).collect();
        if self.method != request.method || self.block != request.block || layers != request.compared_layers() {
            return Err("The target set was prepared for another method, basis group or layers".into());
        }
        Ok(())
    }

    /// The method's loss on canvas features, one [M, D] per compared layer in the set's order.
    pub fn loss(&self, features: Vec<Tensor<2>>) -> SetLoss {
        assert_eq!(features.len(), self.layers.len(), "one feature matrix per compared layer");
        let layers: Vec<LayerTerms> = self.layers.iter().zip(features)
            .map(|(layer, features_MD)| match self.method.compares_distributions() {
                true => layer.distribution_terms(features_MD),
                false => layer.mean_terms(features_MD),
            })
            .collect();
        let count = layers.len() as f32;
        let value = layers.iter().map(|terms| terms.value.clone() / count).reduce(|total, part| total + part).expect("one layer or more");
        SetLoss { value, layers }
    }
}

/// x Wᵀ for tokens [B, T, D] and a fixed matrix W [O, D], [B, T, O]: the codes on a frame, or the
/// products with the set. On the GPU the engine's `frozen_linear`: in Chrome, Burn's generic matmul
/// made token distribution's loss cost about 6 % of an update per layer (17 November 2026).
fn fixed_product(tokens_BTD: Tensor<3>, fixed_OD: &Tensor<2>) -> Tensor<3> {
    #[cfg(feature = "gpu")]
    return crate::kernels::frozen_linear(tokens_BTD, fixed_OD.clone());
    #[cfg(not(feature = "gpu"))]
    tokens_BTD.matmul(fixed_OD.clone().transpose().unsqueeze())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_follow_the_research_alignment() {
        // library.aligned_window: row0 = clamp(row − 4, 0, 8), the dot is the patch's place inside.
        assert_eq!(aligned_window(148), Window { row: 5, column: 0, dot: 36 });
        assert_eq!(aligned_window(0), Window { row: 0, column: 0, dot: 0 });
        assert_eq!(aligned_window(255), Window { row: 8, column: 8, dot: 63 });
        assert_eq!(aligned_window(5 * 16 + 9), Window { row: 1, column: 5, dot: 4 * 8 + 4 });
    }

    #[test]
    fn neighbourhoods_clip_at_the_window_edge() {
        assert_eq!(neighbourhood(36), vec![27, 28, 29, 35, 36, 37, 43, 44, 45]);
        assert_eq!(neighbourhood(0), vec![0, 1, 8, 9]);
        assert_eq!(neighbourhood(63), vec![54, 55, 62, 63]);
        assert_eq!(neighbourhood(7).len(), 4);
        assert_eq!(neighbourhood(8 * 3).len(), 6);
    }

    #[test]
    fn a_window_is_cut_from_its_picture_channel_by_channel() {
        let side = 256;
        let picture: Vec<f32> = (0..3 * side * side).map(|index| index as f32).collect();
        let window = aligned_window(255);
        let pixels = window_pixels(&picture, window);
        assert_eq!(pixels.len(), 3 * 128 * 128);
        // The window's first pixel is the picture's pixel (128, 128); channel 2 starts two planes on.
        assert_eq!(pixels[0], (128 * side + 128) as f32);
        assert_eq!(pixels[2 * 128 * 128 + 127], (2 * side * side + 128 * side + 255) as f32);
    }

    #[test]
    fn the_median_is_the_research_upper_middle_element() {
        // Four points: six distances above the diagonal, sorted 1, 2, 3, 4, 5, 6; index 3 holds 4.
        let distances = [0.0, 1.0, 2.0, 3.0, 1.0, 0.0, 4.0, 5.0, 2.0, 4.0, 0.0, 6.0, 3.0, 5.0, 6.0, 0.0];
        assert_eq!(median_pairwise(&distances, 4), 4.0);
    }

    /// The research's PreparedLayer and Objective on PCG-drawn tokens (tools/prepare_set_losses.py):
    /// the prepared set, the loss and its terms, and the gradient with respect to the raw canvas.
    #[cfg(feature = "cpu")]
    mod research_losses {
        use super::super::*;
        use crate::grow::draws::Stream;
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        use burn::tensor::Device;
        use serde::Deserialize;

        /// Float32 on both sides with different summation orders: relative error of the values, and
        /// relative RMS of the mean and the gradients. Measured on 2026-11-17: 7.4e-6 and 4.1e-7. The
        /// largest value errors are the MMD values, differences of kernel means near 0.7 that leave
        /// about 0.07, so 5e-7 of absolute rounding is 7e-6 of the value. A wrong formula shows at 1e-2.
        const VALUE_TOLERANCE: f64 = 3e-5;
        const VECTOR_TOLERANCE: f64 = 1e-5;

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Fixture {
            seed: u32,
            purpose_key: u32,
            cases: Vec<Case>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Case {
            name: String,
            layers: Vec<String>,
            tokens: usize,
            canvas: usize,
            width: usize,
            value: f64,
            terms: std::collections::BTreeMap<String, f64>,
            prepared: Vec<Prepared>,
            gradients: Vec<String>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Prepared {
            mean: String,
            unit: f64,
            median_distance: f64,
            widths: Vec<f64>,
            self_similarity: f64,
        }

        fn floats(encoded: &str) -> Vec<f32> {
            STANDARD.decode(encoded).unwrap().chunks_exact(4).map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap())).collect()
        }

        /// The largest error seen, printed at the end (`--nocapture`), so the tolerances stay measured.
        static LARGEST: std::sync::Mutex<[f64; 2]> = std::sync::Mutex::new([0.0, 0.0]);

        fn relative(actual: f64, expected: f64) -> f64 {
            let error = (actual - expected).abs() / expected.abs().max(1e-12);
            let mut largest = LARGEST.lock().unwrap();
            largest[0] = largest[0].max(error);
            error
        }

        fn relative_rms(actual: &[f32], expected: &[f32]) -> f64 {
            let error: f64 = actual.iter().zip(expected).map(|(a, e)| (*a as f64 - *e as f64).powi(2)).sum();
            let norm: f64 = expected.iter().map(|e| (*e as f64).powi(2)).sum();
            let error = (error / norm).sqrt();
            let mut largest = LARGEST.lock().unwrap();
            largest[1] = largest[1].max(error);
            error
        }

        /// prepare_set_losses.draw: y = 4 (u − 0.5) + 2 (v_d − 0.5), x = 3 (w − 0.5) + 0.25, in float32.
        fn draw(fixture: &Fixture, case: usize, layer: usize, count: usize, members: usize, width: usize) -> (Vec<f32>, Vec<f32>) {
            let stream = Stream::new(fixture.seed, fixture.purpose_key).at((case * 16 + layer) as u32);
            let uniform = |index: usize| stream.uniform(index as u32);
            let offsets: Vec<f32> = (0..width).map(|d| 2.0 * (uniform(count * width + d) - 0.5)).collect();
            let set = (0..count * width).map(|index| 4.0 * (uniform(index) - 0.5) + offsets[index % width]).collect();
            let canvas = (0..members * width).map(|index| 3.0 * (uniform(count * width + width + index) - 0.5) + 0.25).collect();
            (set, canvas)
        }

        #[test]
        fn the_losses_match_the_research_objective() {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tools/fixtures/target-set-losses.json");
            let fixture: Fixture = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let device = Device::flex().autodiff();
            for (index, case) in fixture.cases.iter().enumerate() {
                let method = serde_json::from_value::<Method>(serde_json::json!(case.name)).unwrap();
                let mut layers = Vec::new();
                let mut canvases = Vec::new();
                for (position, (name, expected)) in case.layers.iter().zip(&case.prepared).enumerate() {
                    let (set, canvas) = draw(&fixture, index, position, case.tokens, case.canvas, case.width);
                    let set_ND = Tensor::<2>::from_data(TensorData::new(set, [case.tokens, case.width]), &device);
                    let layer = pollster::block_on(SetLayer::prepare(Layer::try_from(name.clone()).unwrap(), set_ND)).unwrap();
                    let mean = pollster::block_on(read(layer.mean_1D.clone().flatten(0, 1))).unwrap();
                    assert!(relative_rms(&mean, &floats(&expected.mean)) <= VECTOR_TOLERANCE, "{} {name}: the mean", case.name);
                    assert!(relative(layer.unit as f64, expected.unit) <= VALUE_TOLERANCE, "{} {name}: the unit", case.name);
                    assert!(relative(layer.median_distance as f64, expected.median_distance) <= VALUE_TOLERANCE, "{} {name}: the median", case.name);
                    for (width, expected_width) in layer.widths.iter().zip(&expected.widths) {
                        assert!(relative(*width as f64, *expected_width) <= VALUE_TOLERANCE, "{} {name}: a width", case.name);
                    }
                    assert!(relative(layer.self_similarity as f64, expected.self_similarity) <= VALUE_TOLERANCE, "{} {name}: E k(y, y')", case.name);
                    layers.push(layer);
                    canvases.push(Tensor::<2>::from_data(TensorData::new(canvas, [case.canvas, case.width]), &device).require_grad());
                }
                let target = TargetSet { method, block: 0, pictures: 0, layers };
                let loss = target.loss(canvases.clone());
                let value = pollster::block_on(read(loss.value.clone())).unwrap()[0];
                assert!(relative(value as f64, case.value) <= VALUE_TOLERANCE, "{}: the loss {value} against {}", case.name, case.value);
                for (name, terms) in case.layers.iter().zip(&loss.layers) {
                    let layer_value = pollster::block_on(read(terms.value.clone())).unwrap()[0] as f64;
                    let key = if method.compares_distributions() { format!("mmd_{name}") } else { format!("point_{name}") };
                    assert!(relative(layer_value, case.terms[&key]) <= VALUE_TOLERANCE, "{}: {key}", case.name);
                    if let Some([gathered, approached]) = &terms.kernel_means {
                        let gathered = pollster::block_on(read(gathered.clone())).unwrap()[0] as f64;
                        let approached = pollster::block_on(read(approached.clone())).unwrap()[0] as f64;
                        assert!(relative(gathered, case.terms[&format!("mmd_xx_{name}")]) <= VALUE_TOLERANCE, "{}: E k(x, x')", case.name);
                        assert!(relative(approached, case.terms[&format!("mmd_xy_{name}")]) <= VALUE_TOLERANCE, "{}: E k(x, y)", case.name);
                    }
                }
                let gradients = loss.value.backward();
                for ((canvas, expected), name) in canvases.iter().zip(&case.gradients).zip(&case.layers) {
                    let gradient = canvas.grad(&gradients).unwrap().into_data().try_to_vec::<f32>().unwrap();
                    let error = relative_rms(&gradient, &floats(expected));
                    assert!(error <= VECTOR_TOLERANCE, "{} {name}: gradient relative RMS {error}", case.name);
                }
            }
            let [values, vectors] = *LARGEST.lock().unwrap();
            eprintln!("largest relative error of a value {values:.2e}, relative RMS of a vector {vectors:.2e}");
        }
    }
}
