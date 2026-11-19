//! Optimized RGB pyramid, protected pixels and reflected shifts.
//! Each level is [1, 3, side, side].

use burn::tensor::{Bool, Device, Int, Tensor, TensorData, activation};

pub const SIZE: usize = 256;
pub const LEVELS: [usize; 5] = [16, 32, 64, 128, 256];
pub const INIT_STD: f32 = 0.05;
/// The largest shift of the second view, in pixels, in each direction.
pub const JITTER_RADIUS: usize = 2;
pub const GRID: usize = 16;
/// The largest zoom per update the engine accepts (MAX_ZOOM_PER_UPDATE in app/src/recipe.ts).
pub const MAX_ZOOM_PER_UPDATE: f32 = 0.05;
const PATCH: usize = SIZE / GRID;
/// `pyramid_from_image` clamps before the logit so saturated pixels stay finite.
const REBASE_CLAMP: f64 = 1e-5;

/// PyTorch bicubic, align_corners=false, cubic coefficient -0.75.
fn cubic(x: f32) -> f32 {
    let x = x.abs();
    if x <= 1.0 {
        (1.25 * x - 2.25) * x * x + 1.0
    } else if x < 2.0 {
        ((-0.75 * x + 3.75) * x - 6.0) * x + 3.0
    } else {
        0.0
    }
}

/// A = [output, input]. Clamped edge taps are added, not discarded or renormalized.
pub fn resize_coefficients(input: usize, output: usize) -> Vec<f32> {
    let mut coefficients_OI = vec![0.0; output * input];
    for dst in 0..output {
        let source = (dst as f32 + 0.5) * (input as f32 / output as f32) - 0.5;
        let base = source.floor() as isize;
        for tap in -1..=2 {
            let unclamped = base + tap;
            let index = unclamped.clamp(0, input as isize - 1) as usize;
            coefficients_OI[dst * input + index] += cubic(source - unclamped as f32);
        }
    }
    coefficients_OI
}

/// A square resampling, A × image × Aᵀ, for an [output, input] matrix A whose rows have
/// at most K non-zero entries (4 for bicubic, 2 for bilinear). Each output index is a
/// weighted sum of K gathered input indices, so the resampling is a gather, a product and
/// a sum over K per axis: ordinary tensor operations with their usual gradients. Burn's
/// `matmul` is not used; on WebGPU it is far slower than these few operations.
pub struct Resample {
    /// [O·K] input index of each tap, in (output, tap) order. Unused taps point at index 0.
    indices: Tensor<1, Int>,
    /// [O, K] weight of each tap; 0 for unused taps.
    weights_OK: Tensor<2>,
    /// The same for Aᵀ, [I·K'] and [I, K']: the GPU gradient gathers with them (`kernels/resample.rs`).
    transposed_indices: Tensor<1, Int>,
    transposed_weights_IK: Tensor<2>,
}

/// The non-zero entries of each row of a [rows, columns] matrix as (column, weight) taps,
/// padded with (0, 0.0) to the longest row: [rows · K] indices and [rows, K] weights.
fn taps(coefficients: &[f32], columns: usize, device: &Device) -> (Tensor<1, Int>, Tensor<2>) {
    let rows: Vec<Vec<(usize, f32)>> = coefficients
        .chunks_exact(columns)
        .map(|row| row.iter().copied().enumerate().filter(|&(_, weight)| weight != 0.0).collect())
        .collect();
    let count = rows.len();
    let taps = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let (indices, weights): (Vec<i64>, Vec<f32>) = rows
        .iter()
        .flat_map(|row| (0..taps).map(|tap| row.get(tap).map_or((0, 0.0), |&(index, weight)| (index as i64, weight))))
        .unzip();
    (
        Tensor::from_data(TensorData::new(indices, [count * taps]), device),
        Tensor::from_data(TensorData::new(weights, [count, taps]), device),
    )
}

impl Resample {
    pub fn new(coefficients_OI: &[f32], input: usize, device: &Device) -> Self {
        let output = coefficients_OI.len() / input;
        let coefficients_IO: Vec<f32> = (0..input * output).map(|index| coefficients_OI[(index % output) * input + index / output]).collect();
        let (indices, weights_OK) = taps(coefficients_OI, input, device);
        let (transposed_indices, transposed_weights_IK) = taps(&coefficients_IO, output, device);
        Self { indices, weights_OK, transposed_indices, transposed_weights_IK }
    }

    /// The same resampling for tensors outside autodiff.
    pub fn untracked(self) -> Self {
        Self {
            indices: self.indices.inner(),
            weights_OK: self.weights_OK.inner(),
            transposed_indices: self.transposed_indices.inner(),
            transposed_weights_IK: self.transposed_weights_IK.inner(),
        }
    }

    /// Resample the height, then the width, of [B, C, I, I] into [B, C, O, O]. On the GPU
    /// the gradient gathers with Aᵀ (`kernels/resample.rs`).
    #[cfg(feature = "gpu")]
    pub fn apply(&self, images_BCII: Tensor<4>) -> Tensor<4> {
        let axis = |images: Tensor<4>, axis: usize| {
            crate::kernels::resample_axis(
                images,
                self.indices.clone(),
                self.weights_OK.clone(),
                self.transposed_indices.clone(),
                self.transposed_weights_IK.clone(),
                axis,
            )
        };
        axis(axis(images_BCII, 2), 3)
    }

    #[cfg(not(feature = "gpu"))]
    pub fn apply(&self, images_BCII: Tensor<4>) -> Tensor<4> {
        self.plain_apply(images_BCII)
    }

    /// Plain Burn, whose gradient scatters: the CPU path, and the oracle that qualifies the GPU path.
    #[cfg_attr(all(feature = "gpu", not(feature = "harness")), allow(dead_code))]
    pub(crate) fn plain_apply(&self, images_BCII: Tensor<4>) -> Tensor<4> {
        let [batch, channels, _, input] = images_BCII.dims();
        let [output, taps] = self.weights_OK.dims();
        let rows_BCOKI = images_BCII
            .select(2, self.indices.clone())
            .reshape([batch, channels, output, taps, input]);
        let weights_11OK1 = self.weights_OK.clone().reshape([1, 1, output, taps, 1]);
        let height_BCOI = (rows_BCOKI * weights_11OK1).sum_dim(3).reshape([batch, channels, output, input]);
        let columns_BCOOK = height_BCOI
            .select(3, self.indices.clone())
            .reshape([batch, channels, output, output, taps]);
        let weights_111OK = self.weights_OK.clone().reshape([1, 1, 1, output, taps]);
        (columns_BCOOK * weights_111OK).sum_dim(4).reshape([batch, channels, output, output])
    }
}

/// Reflect a 1D index across `[0, side - 1]`: `-1 -> 1`, `side -> side - 2`.
fn reflect_index(position: i32, side: usize) -> usize {
    if position < 0 {
        (-position) as usize
    } else if position >= side as i32 {
        (2 * side as i32 - 2 - position) as usize
    } else {
        position as usize
    }
}

/// The optimizer's robust view: a Gaussian blur of `sigma` pixels with taps at
/// −radius..=radius, as a [side, side] matrix. Taps past a border fold
/// back by the reflection of `Jitter` (position −1 reads 1; position side reads side − 2),
/// so every row sums to 1. Applied to an axis at a time by `Resample`, it is the separable
/// two-dimensional blur.
pub fn gaussian_coefficients(side: usize, sigma: f32, radius: usize) -> Vec<f32> {
    assert!(sigma > 0.0 && radius >= 1 && radius < side);
    let weights: Vec<f32> = (-(radius as i32)..=radius as i32)
        .map(|tap| (-(tap * tap) as f32 / (2.0 * sigma * sigma)).exp())
        .collect();
    let total: f32 = weights.iter().sum();
    let mut coefficients_OI = vec![0.0; side * side];
    for output in 0..side {
        for (tap, weight) in (-(radius as i32)..=radius as i32).zip(&weights) {
            let reflected = reflect_index(output as i32 + tap, side);
            coefficients_OI[output * side + reflected] += weight / total;
        }
    }
    coefficients_OI
}

/// Bilinear zoom about the centre by `scale` ≥ 1, as an [output, input] = [side, side] matrix.
/// Output index o samples u = (o + 0.5 − side/2) / scale + side/2 − 0.5, clamped to the image:
/// PyTorch's grid_sample with bilinear weights, border padding and align_corners = false.
pub fn zoom_coefficients(side: usize, scale: f32) -> Vec<f32> {
    let mut coefficients_OI = vec![0.0; side * side];
    let centre = side as f32 / 2.0;
    for dst in 0..side {
        let source = ((dst as f32 + 0.5 - centre) / scale + centre - 0.5).clamp(0.0, (side - 1) as f32);
        let below = source.floor();
        let weight = source - below;
        let below = below as usize;
        coefficients_OI[dst * side + below] += 1.0 - weight;
        coefficients_OI[dst * side + (below + 1).min(side - 1)] += weight;
    }
    coefficients_OI
}

/// DeepDream's zoom, the recipe's `motion`: after every update, every pyramid level and the
/// base image are scaled about their centre by 1 + zoom per update. Adam's moments stay where
/// they are, so a changed zoom needs no reset.
pub struct Zoom {
    /// One resampling per pyramid level, coarsest first; empty when the zoom is off.
    levels: Vec<Resample>,
}

impl Zoom {
    pub fn off() -> Self {
        Self { levels: Vec::new() }
    }

    pub fn new(per_update: f32, device: &Device) -> Result<Self, String> {
        if !(0.0..=MAX_ZOOM_PER_UPDATE).contains(&per_update) {
            return Err(format!("zoom per update must be between 0 and {MAX_ZOOM_PER_UPDATE}"));
        }
        if per_update == 0.0 {
            return Ok(Self::off());
        }
        let scale = 1.0 + per_update;
        let levels = LEVELS
            .iter()
            .map(|&side| Resample::new(&zoom_coefficients(side, scale), side, device).untracked())
            .collect();
        Ok(Self { levels })
    }
}

pub struct Pyramid {
    pub levels: Vec<Tensor<4>>,
    /// Bicubic upsampling of each level below SIZE to SIZE.
    upsampling: Vec<Resample>,
}

impl Pyramid {
    pub fn new(seed: u32, device: &Device) -> Self {
        let mut rng = Random::new(seed);
        let levels = LEVELS
            .iter()
            .map(|&side| {
                let values = (0..3 * side * side)
                    .map(|_| rng.normal() * INIT_STD)
                    .collect::<Vec<_>>();
                Tensor::from_data(TensorData::new(values, [1, 3, side, side]), device)
                    .require_grad()
            })
            .collect();
        Self::from_levels(levels, device)
    }

    /// Rebase: zero coarse levels and the logit of the image in the finest level, so
    /// `render` reproduces the image within about 1e-5 RGB (`pyramid_from_image`).
    pub fn from_image(image_1CHW: Tensor<4>, device: &Device) -> Self {
        let clamped_1CHW = image_1CHW.inner().clamp(REBASE_CLAMP, 1.0 - REBASE_CLAMP);
        let logit_1CHW = (clamped_1CHW.clone() / (clamped_1CHW.neg() + 1.0)).log();
        let mut levels: Vec<Tensor<4>> = LEVELS[..LEVELS.len() - 1]
            .iter()
            .map(|&side| Tensor::zeros([1, 3, side, side], device).require_grad())
            .collect();
        levels.push(
            (logit_1CHW * (LEVELS.len() as f64).sqrt())
                .autodiff()
                .require_grad(),
        );
        Self::from_levels(levels, device)
    }

    fn from_levels(levels: Vec<Tensor<4>>, device: &Device) -> Self {
        let upsampling = LEVELS[..LEVELS.len() - 1]
            .iter()
            .map(|&side| Resample::new(&resize_coefficients(side, SIZE), side, device))
            .collect();
        Self { levels, upsampling }
    }

    pub fn render(&self) -> Tensor<4> {
        let (finest, coarse) = self.levels.split_last().expect("the pyramid has levels");
        let mut upsampled = coarse
            .iter()
            .zip(&self.upsampling)
            .map(|(level, upsampling)| upsampling.apply(level.clone()));
        let sum = match upsampled.next() {
            Some(first) => upsampled
                .chain([finest.clone()])
                .fold(first, |total, level| total + level),
            None => finest.clone(),
        };
        activation::sigmoid(sum / (LEVELS.len() as f64).sqrt())
    }
}

/// The trainable pyramid, a fixed base image and the editable cells. A protected
/// pixel copies the base into both DINO's input and the display; it is a hard constraint.
pub struct Canvas {
    pub pyramid: Pyramid,
    base_1CHW: Tensor<4>,
    /// True on protected pixels, [1, 3, H, W]. None when every cell is editable.
    protected_1CHW: Option<Tensor<4, Bool>>,
    editable: Vec<bool>,
}

impl Canvas {
    /// Fresh noise. The base is the initial noise image.
    pub fn from_seed(seed: u32, editable: Vec<bool>, device: &Device) -> Self {
        let pyramid = Pyramid::new(seed, device);
        let base_1CHW = pyramid.render().inner();
        Self {
            pyramid,
            protected_1CHW: protected_pixels(&editable, device),
            base_1CHW,
            editable,
        }
    }

    /// A stored picture, [1, 3, H, W] in [0, 1], becomes the
    /// image. The finest array takes its logit and the others zero (`Pyramid::from_image`),
    /// so the first frame reproduces it; it is also the base that protected cells show.
    pub fn from_picture(picture_1CHW: Tensor<4>, editable: Vec<bool>) -> Self {
        let device = picture_1CHW.device();
        let base_1CHW = picture_1CHW.inner();
        Self {
            pyramid: Pyramid::from_image(base_1CHW.clone(), &device),
            protected_1CHW: protected_pixels(&editable, &device),
            base_1CHW,
            editable,
        }
    }

    /// Fixed levels and base from a fixture, for qualification only.
    #[cfg(feature = "harness")]
    pub fn from_parts(levels: Vec<Tensor<4>>, base_1CHW: Tensor<4>, editable: Vec<bool>) -> Self {
        let device = levels[0].device();
        Self {
            pyramid: Pyramid::from_levels(levels, &device),
            protected_1CHW: protected_pixels(&editable, &device),
            base_1CHW: base_1CHW.inner(),
            editable,
        }
    }

    pub fn editable(&self) -> &[bool] {
        &self.editable
    }

    pub fn can_edit(&self) -> bool {
        self.editable.iter().any(|&cell| cell)
    }

    /// The image DINO reads and the user sees. Tracks gradients to the pyramid.
    pub fn compose(&self) -> Tensor<4> {
        let rendered_1CHW = self.pyramid.render();
        match &self.protected_1CHW {
            Some(protected_1CHW) => {
                rendered_1CHW.mask_where(protected_1CHW.clone(), self.base_1CHW.clone().autodiff())
            }
            None => rendered_1CHW,
        }
    }

    /// Scale every level and the base image about the centre, outside autodiff.
    pub fn zoom(&mut self, zoom: &Zoom) {
        let Some(finest) = zoom.levels.last() else {
            return;
        };
        for (level, resample) in self.pyramid.levels.iter_mut().zip(&zoom.levels) {
            *level = resample.apply(level.clone().inner()).autodiff().require_grad();
        }
        self.base_1CHW = finest.apply(self.base_1CHW.clone());
    }

    /// Noise brush: the pyramid parameters whose centre lies in a painted, editable cell take
    /// new values from the fresh-image distribution, drawn from `seed` in the order of
    /// `Pyramid::new`. Returns each level's mask of new parameters, [1, 3, s, s], for Adam.
    /// The coarse levels are upsampled bicubically, so the change reaches past the cell edges.
    pub fn reseed(&mut self, painted: &[bool], seed: u32) -> Vec<Tensor<4, Bool>> {
        assert_eq!(painted.len(), GRID * GRID);
        let device = self.pyramid.levels[0].device();
        let fresh = Pyramid::new(seed, &device);
        let editable = &self.editable;
        let mut masks = Vec::with_capacity(LEVELS.len());
        for ((level, fresh_level), &side) in self.pyramid.levels.iter_mut().zip(fresh.levels).zip(&LEVELS) {
            // A parameter covers SIZE / side pixels per axis; its centre pixel names its cell.
            let footprint = SIZE / side;
            let cell = |index: usize| (index * footprint + footprint / 2) / PATCH;
            let selected: Vec<bool> = (0..3 * side * side)
                .map(|index| {
                    let (row, column) = ((index / side) % side, index % side);
                    let cell = cell(row) * GRID + cell(column);
                    painted[cell] && editable[cell]
                })
                .collect();
            let mask = Tensor::<4, Bool>::from_bool(TensorData::new(selected, [1, 3, side, side]), &device);
            *level = level
                .clone()
                .inner()
                .mask_where(mask.clone(), fresh_level.inner())
                .autodiff()
                .require_grad();
            masks.push(mask);
        }
        masks
    }

    /// The base image that protected cells show, for qualification only.
    #[cfg(feature = "harness")]
    pub fn base(&self) -> Tensor<4> {
        self.base_1CHW.clone()
    }

    /// The current image becomes the base and is inverted into fresh pyramid levels,
    /// so newly editable pixels do not expose stale hidden parameters.
    pub fn rebase(&mut self, editable: Vec<bool>) {
        let device = self.pyramid.levels[0].device();
        let base_1CHW = self.compose().inner();
        self.pyramid = Pyramid::from_image(base_1CHW.clone(), &device);
        self.protected_1CHW = protected_pixels(&editable, &device);
        self.base_1CHW = base_1CHW;
        self.editable = editable;
    }
}

/// Expand protected 16 × 16 cells to their pixel footprints.
fn protected_pixels(editable: &[bool], device: &Device) -> Option<Tensor<4, Bool>> {
    assert_eq!(editable.len(), GRID * GRID);
    if editable.iter().all(|&cell| cell) {
        return None;
    }
    let mut protected = Vec::with_capacity(3 * SIZE * SIZE);
    for _channel in 0..3 {
        for row in 0..SIZE {
            for column in 0..SIZE {
                protected.push(!editable[(row / PATCH) * GRID + column / PATCH]);
            }
        }
    }
    Some(Tensor::from_bool(
        TensorData::new(protected, [1, 3, SIZE, SIZE]),
        device,
    ))
}

/// Deterministic local RNG, independent of GPU scheduling. Not a security primitive.
pub struct Random(u32);

impl Random {
    pub fn new(seed: u32) -> Self {
        Self(seed.wrapping_add(1).max(1))
    }
    fn uniform(&mut self) -> f32 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 17;
        value ^= value << 5;
        self.0 = value;
        ((value >> 8) as f32 + 0.5) / 16_777_216.0
    }
    fn normal(&mut self) -> f32 {
        (-2.0 * self.uniform().ln()).sqrt() * (std::f32::consts::TAU * self.uniform()).cos()
    }
    /// A uniform integer in 0..=2 × radius.
    pub fn offset(&mut self, radius: usize) -> usize {
        let choices = 2 * radius + 1;
        // FP32 rounding can put the upper endpoint at 1.0.
        ((self.uniform() * choices as f32) as usize).min(choices - 1)
    }
}

/// Precomputed reflection indices for shifts of at most `radius` pixels. Index `radius`
/// is the identity; index `radius + s` shifts by s pixels.
pub struct Jitter {
    indices: Vec<Tensor<1, Int>>,
    random: Random,
    radius: usize,
}

impl Jitter {
    pub fn new(seed: u32, radius: usize, device: &Device) -> Self {
        assert!(radius < SIZE, "a reflected shift must be smaller than the image");
        let indices = (0..=2 * radius)
            .map(|offset| {
                let indices: Vec<i32> = (0..SIZE)
                    .map(|pixel| reflect_index(pixel as i32 + offset as i32 - radius as i32, SIZE) as i32)
                    .collect();
                Tensor::from_data(TensorData::new(indices, [SIZE]), device)
            })
            .collect();
        Self {
            indices,
            random: Random::new(seed),
            radius,
        }
    }

    pub fn views(&mut self, image_1CHW: Tensor<4>) -> Tensor<4> {
        let radius = self.radius as i32;
        let row_shift = self.random.offset(self.radius) as i32 - radius;
        let column_shift = self.random.offset(self.radius) as i32 - radius;
        self.fixed_views(image_1CHW, row_shift, column_shift)
    }

    /// Original plus reflected shift. Positive offsets read pixels below/right.
    pub fn fixed_views(
        &self,
        image_1CHW: Tensor<4>,
        row_shift: i32,
        column_shift: i32,
    ) -> Tensor<4> {
        let rows = self.indices[(row_shift + self.radius as i32) as usize].clone();
        let columns = self.indices[(column_shift + self.radius as i32) as usize].clone();
        let shifted_1CHW = image_1CHW.clone().select(2, rows).select(3, columns);
        Tensor::cat(vec![image_1CHW, shifted_1CHW], 0)
    }
}
