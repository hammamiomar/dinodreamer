//! The figure recipe: the archived trainer's cellular automaton (E9, E18), trained toward
//! one observed native code at the mean over patches. Training draws come from
//! `draws::Stream`, so `tools/prepare_grow_recipe.py` can replay them through the archived
//! trainer's own functions.
//!
//! Axes: B grids, N = B·H·W cells with H = W = 128 (one pixel per cell), C = 16 state
//! channels, V = 2B views, T = 64 patches of a 128 px picture, D = 768, R = 3. The pyramid adds
//! a coarse grid of M = B·64·64 cells at 2 px per cell.
//!
//! The loss of one update is
//!   L = mean_v ‖mean_{t∈P} c_vt − k‖² / m²  +  10 · mean |x − clamp(x, −1, 1)|,
//! where c_vt is the native code of patch t in view v (the calibrated DINO token projected on
//! the block's frozen 768×3 frame, no gate division), P the scored patches (all 64, or the
//! central 4 × 4 for the seeded centre), k is the Look anchor's native code, m the block's
//! median winning norm, and the second mean runs over every value x of the B grown states
//! (both grids of the pyramid). Each parameter gradient is divided by its own norm before Adam.
//!
//! Four kinds of material come from two independent choices: the rule (`RuleKind`), the cell rule or the two-level pyramid, and
//! the start (`Start`), noise or the seeded centre.
//!
//! This file holds what both builds share: the constants, the kinds, the request, the draws of
//! each update (`Plan`), the learning-rate schedule, the picture, the loss terms, the brush
//! stamp and the readout. The CPU test suite checks them. The rule, its training and the live
//! grid run WGPU kernels, so they compile with `gpu` only (`figure/rule.rs`).
use super::{
    draws::{self, Stream},
    views::{Distill, SCALES},
};
use crate::{
    encoder::{DEPTH, Dino, PREFIX},
    objective::Calibration,
    reader::{DictionaryReader, WINNERS},
};
use burn::tensor::{Tensor, TensorData};
use serde::{Deserialize, Serialize};

#[cfg(feature = "gpu")]
mod rule;
pub mod target_set;
#[cfg(feature = "gpu")]
pub use rule::{Cells, FigureGradient, FigureGrid, FigureReadings, FigureRule, FigureTraining, FigureUpdate, LayerLoss};

pub const SIDE: usize = 128;
pub const CELLS: usize = SIDE * SIDE;
/// The pyramid's coarse grid: 2 px per cell under the fine grid.
pub const COARSE_SIDE: usize = SIDE / 2;
pub const COARSE_CELLS: usize = COARSE_SIDE * COARSE_SIDE;
pub const CHANNELS: usize = 16;
pub const PATCHES: usize = 64;
/// 64 grids: the recipe sweep reaches the selection threshold sooner than with 256 grids.
pub const POOL: usize = 64;
pub const UPDATES: u32 = 1000;
pub const FIRE_RATE: f32 = 0.5;
pub const ROLLOUT_MIN: usize = 32;
pub const ROLLOUT_MAX: usize = 64;
pub const LEARNING_RATE: f64 = 2e-3;
pub const FINAL_LEARNING_RATE: f64 = 2e-4;
pub const OVERFLOW_WEIGHT: f32 = 10.0;
/// The archive resets the first sampled grid every update. At batch 1 that grid is the only
/// one, so batch 1 resets every fourth update: one reset per four sampled states, as batch 4.
pub const BATCH_1_RESET_EVERY: u32 = 4;
/// The seeded start's noise disc, in fine cells: 812 cells of the 128-cell grid, rows and columns
/// 48–79. The coarse grid's disc has half the radius, so both cover the same 32 px circle.
pub const START_RADIUS: f32 = 16.0;
/// The cell rule's values: fc1 [96, 64], its bias [96] and fc2 [16, 96].
pub const CELL_PARAMETERS: usize = 7776;
/// The pyramid's values: the coarse cell rule's 7,776, then the fine rule's fc1 [96, 80], its bias
/// [96] and fc2 [16, 96] (9,312). The fine rule's inputs 64–79 are the upsampled coarse state.
pub const PYRAMID_PARAMETERS: usize = CELL_PARAMETERS + 96 * 80 + 96 + 16 * 96;
/// The central 4 × 4 of the 8 × 8 patches, row-major: pixels 32–95 of a 128 px picture.
pub const CENTRE_PATCHES: [usize; 16] = [18, 19, 20, 21, 26, 27, 28, 29, 34, 35, 36, 37, 42, 43, 44, 45];
const ALL_PATCHES: [usize; PATCHES] = {
    let mut patches = [0; PATCHES];
    let mut patch = 0;
    while patch < PATCHES {
        patches[patch] = patch;
        patch += 1;
    }
    patches
};

/// The rule: the cell rule on one grid, or the two-level pyramid (`pyramid.py`): a coarse
/// grid of COARSE_SIDE cells steps first with its own cell rule; the fine rule then reads the
/// upsampled coarse state as 16 more inputs, and the picture sums both grids' colours.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuleKind {
    Cell,
    Pyramid,
}

impl RuleKind {
    pub fn parameters(self) -> usize {
        match self {
            Self::Cell => CELL_PARAMETERS,
            Self::Pyramid => PYRAMID_PARAMETERS,
        }
    }
}

/// How every grid starts, in training, in the readouts and on the live grid: noise everywhere,
/// or the seeded centre: zero outside a noise disc at the grid centre. A seeded start also
/// scores the loss and counts the reading on the central 4 × 4 patches only.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Start {
    Noise,
    CentreDisc,
}

impl Start {
    /// The patches the loss scores and the reading counts.
    pub fn patches(self) -> &'static [usize] {
        match self {
            Self::Noise => &ALL_PATCHES,
            Self::CentreDisc => &CENTRE_PATCHES,
        }
    }

    /// Per cell of a `side` grid, 1 where the start keeps its noise and 0 where it is zero; None
    /// for noise everywhere. The coarse grid (side COARSE_SIDE) has half the radius.
    pub fn mask(self, side: usize) -> Option<Vec<f32>> {
        match self {
            Self::Noise => None,
            Self::CentreDisc => Some(centre_disc(side, START_RADIUS * side as f32 / SIDE as f32)),
        }
    }
}

/// 1 for the cells whose centres lie within `radius` of the grid centre, else 0, row-major. The
/// offsets are half-integers, so the test is exact in float32 (the replay contract's
/// `trainer.centre_disc`).
pub fn centre_disc(side: usize, radius: f32) -> Vec<f32> {
    let offset = |index: usize| index as f32 - side as f32 / 2.0 + 0.5;
    (0..side * side)
        .map(|cell| {
            let (dx, dy) = (offset(cell % side), offset(cell / side));
            if dx * dx + dy * dy <= radius * radius { 1.0 } else { 0.0 }
        })
        .collect()
}

/// What training asks of the canvas: one choice of space and one of comparison (research/given-set,
/// "The four methods"). The space is the basis group, the 3 numbers it reads from a token, or the
/// token, DINO's 768 numbers for a patch. Mean matching asks for the canvas's average; distribution
/// matching asks the canvas's patches to be spread like the target set's (`target_set`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Method {
    /// mean_v ‖mean_{t∈P} c_vt − k‖² / m² (`mean_code_loss`); the research's `plain`.
    #[default]
    BasisGroupMean,
    /// ‖mean_m x_m‖² on the set-standardized tokens; the research's `point`.
    TokenMean,
    /// The unbiased MMD² on the set-standardized codes c = Fᵀ(calibrated token); `projection-mmd`.
    BasisGroupDistribution,
    /// The unbiased MMD² on the set-standardized tokens; the research's `mmd`.
    TokenDistribution,
}

impl Method {
    /// Whether the method compares the canvas with a target set.
    pub fn needs_set(self) -> bool {
        self != Self::BasisGroupMean
    }

    /// Whether the method reads DINO's tokens at the request's layers.
    pub fn reads_tokens(self) -> bool {
        matches!(self, Self::TokenMean | Self::TokenDistribution)
    }

    pub fn compares_distributions(self) -> bool {
        matches!(self, Self::BasisGroupDistribution | Self::TokenDistribution)
    }
}

/// A DINO readout that a token method compares: the patch tokens after zero-based block k under a
/// LayerNorm without learned parameters ("block-k"), or the final layer under DINO's own output
/// norm ("final"), the tokens the basis groups read. The names are the research's layer keys.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub enum Layer {
    Block(usize),
    Final,
}

impl TryFrom<String> for Layer {
    type Error = String;
    fn try_from(name: String) -> Result<Self, String> {
        if name == "final" {
            return Ok(Self::Final);
        }
        match name.strip_prefix("block-").and_then(|block| block.parse::<usize>().ok()) {
            Some(block) if block < DEPTH => Ok(Self::Block(block)),
            _ => Err(format!("A layer is \"final\" or \"block-k\" with k from 0 to {}, not {name:?}", DEPTH - 1)),
        }
    }
}

impl From<Layer> for String {
    fn from(layer: Layer) -> String {
        match layer {
            Layer::Block(block) => format!("block-{block}"),
            Layer::Final => "final".into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigureRequest {
    pub block: u32,
    /// k: the anchor's native code.
    pub code: [f32; 3],
    /// m: the loss denominator, the block's median winning norm.
    pub median_norm: f32,
    pub seed: u32,
    /// 4 as in the archive; 1 is the measured fallback.
    pub batch: usize,
    pub rule: RuleKind,
    pub start: Start,
    #[serde(default)]
    pub method: Method,
    /// The token methods' layers, averaged in the loss; empty for the basis-group methods, which
    /// read the final layer.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layers: Vec<Layer>,
}

impl FigureRequest {
    pub fn validate(&self) -> Result<(), String> {
        let squared: f32 = self.code.iter().map(|value| value * value).sum();
        if self.block >= 16384
            || !squared.is_finite()
            || squared <= 0.0
            || !self.median_norm.is_finite()
            || self.median_norm <= 0.0
            || ![1, 4].contains(&self.batch)
        {
            return Err("The figure recipe needs a block, a finite nonzero anchor code, a positive median norm and batch 1 or 4".into());
        }
        let distinct = self.layers.iter().enumerate().all(|(index, layer)| !self.layers[..index].contains(layer));
        if self.method.reads_tokens() != !self.layers.is_empty() || !distinct {
            return Err("A token method needs one or more distinct layers; a basis-group method takes none".into());
        }
        Ok(())
    }

    /// The layers whose features the method compares: the request's for a token method, the final
    /// layer's codes for basis-group distribution, none for basis-group mean.
    pub fn compared_layers(&self) -> Vec<Layer> {
        match self.method {
            Method::BasisGroupMean => Vec::new(),
            Method::BasisGroupDistribution => vec![Layer::Final],
            Method::TokenMean | Method::TokenDistribution => self.layers.clone(),
        }
    }

    /// The zero-based DINO blocks whose intermediate tokens the method reads, increasing.
    pub fn intermediate_blocks(&self) -> Vec<usize> {
        let mut blocks: Vec<usize> = self.layers.iter().filter_map(|layer| match layer {
            Layer::Block(block) => Some(*block),
            Layer::Final => None,
        }).collect();
        blocks.sort_unstable();
        blocks
    }
}

/// Everything one update draws, before any tensor work.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    /// Distinct pool entries, in draw order (a partial Fisher–Yates shuffle).
    pub entries: Vec<usize>,
    /// The first sampled grid restarts from a fresh start.
    pub reset: bool,
    pub steps: usize,
    /// Two per grid: grid 0 view 0, grid 0 view 1, grid 1 view 0, …
    pub views: Vec<Distill>,
}

impl Plan {
    pub fn draw(seed: u32, update: u32, batch: usize) -> Self {
        let pick = Stream::new(seed, draws::PICK).at(update);
        let mut order: Vec<usize> = (0..POOL).collect();
        for slot in 0..batch {
            let chosen = slot + pick.below(slot as u32, POOL - slot);
            order.swap(slot, chosen);
        }
        let roll = Stream::new(seed, draws::ROLL).at(update);
        let view = Stream::new(seed, draws::VIEW).at(update);
        let views = (0..2 * batch as u32)
            .map(|index| Distill {
                shift: [
                    view.below(4 * index, 33) as i32 - 16,
                    view.below(4 * index + 1, 33) as i32 - 16,
                ],
                scale: SCALES[view.below(4 * index + 2, SCALES.len())],
                degrees: view.below(4 * index + 3, 11) as i32 - 5,
            })
            .collect();
        Self {
            entries: order[..batch].to_vec(),
            reset: batch == 4 || update % BATCH_1_RESET_EVERY == 0,
            steps: ROLLOUT_MIN + roll.below(0, ROLLOUT_MAX - ROLLOUT_MIN + 1),
            views,
        }
    }
}

/// Completed optimizer updates and the count at which training stops. The next update draws its
/// plan and firing at index `completed` and takes that index's learning rate. The target starts
/// at the schedule's 1,000; Resume past it raises it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UpdateCount {
    pub completed: u32,
    pub target: u32,
}

impl Default for UpdateCount {
    fn default() -> Self {
        Self { completed: 0, target: UPDATES }
    }
}

impl UpdateCount {
    /// A run continued from a definition saved at `from` updates (Train resume, case 2): the schedule
    /// goes on from there, to update 1,000, or no further when the definition is at or past it.
    pub fn continued(from: u32) -> Self {
        Self { completed: from, target: UPDATES.max(from) }
    }

    /// The index of the next update, or why there is none.
    pub fn next(&self) -> Result<u32, String> {
        if self.completed >= self.target {
            return Err(format!("This figure training has completed its {} updates", self.target));
        }
        Ok(self.completed)
    }

    /// Allow `updates` more past the current target.
    pub fn extend(&mut self, updates: u32) {
        self.target += updates;
    }
}

/// The archive's cosine schedule over 1,000 updates: 0.002 at update 0, 0.0002 at update 999.
/// Training resumed past update 999 stays at 0.0002.
pub fn learning_rate(update: u32) -> f64 {
    let progress = update.min(UPDATES - 1) as f64 / (UPDATES - 1) as f64;
    FINAL_LEARNING_RATE
        + 0.5 * (LEARNING_RATE - FINAL_LEARNING_RATE) * (1.0 + (std::f64::consts::PI * progress).cos())
}

/// The picture DINO reads from the colour of each fine cell, [1, B·H·W, 3]: plus 0.5, clamped,
/// as [B, 3, H, W], rounded to 8 bits with a straight-through gradient (round half to even, as
/// torch.round). The colour is the state's first three channels, plus the upsampled coarse
/// colour for the pyramid.
pub fn picture(colour_1N3: Tensor<3>, grids: usize) -> Tensor<4> {
    let rgb_BCHW = (colour_1N3 + 0.5)
        .clamp(0.0, 1.0)
        .reshape([grids, SIDE, SIDE, 3])
        .permute([0, 3, 1, 2]);
    let rounded_BCHW = (rgb_BCHW.clone().inner() * 255.0).round() / 255.0;
    let correction_BCHW = (rounded_BCHW - rgb_BCHW.clone().inner()).autodiff();
    rgb_BCHW + correction_BCHW
}

/// `upsample_torus`: bilinear by 2 with wrap-around, from B coarse grids of `side` cells
/// [1, B·side², C] to [1, B·4·side², C]. Along each axis, fine cell j reads coarse position
/// j/2 − 0.25: for k = ⌊j/2⌋, an even j weighs cells k − 1 and k by 0.25 and 0.75, an odd j cells
/// k and k + 1 by 0.75 and 0.25. The width weights apply inside the height weights, in the
/// operand order of the replay runtime's `upsampled`.
pub fn upsample_torus(coarse_1MC: Tensor<3>, grids: usize, side: usize) -> Tensor<3> {
    let channels = coarse_1MC.dims()[2];
    let coarse_BHWC = coarse_1MC.reshape([grids, side, side, channels]);
    let wide_BHWC = upsample_axis(coarse_BHWC, 2);
    upsample_axis(wide_BHWC, 1).reshape([1, grids * 4 * side * side, channels])
}

/// Doubles one axis on the torus: output 2k is 0.25·x[k − 1] + 0.75·x[k], output 2k + 1 is
/// 0.75·x[k] + 0.25·x[k + 1].
fn upsample_axis(values: Tensor<4>, axis: usize) -> Tensor<4> {
    let length = values.dims()[axis];
    let previous = Tensor::cat(
        vec![values.clone().narrow(axis, length - 1, 1), values.clone().narrow(axis, 0, length - 1)],
        axis,
    );
    let next = Tensor::cat(vec![values.clone().narrow(axis, 1, length - 1), values.clone().narrow(axis, 0, 1)], axis);
    let even = previous * 0.25 + values.clone() * 0.75;
    let odd = values * 0.75 + next * 0.25;
    let mut doubled = even.dims();
    doubled[axis] *= 2;
    Tensor::stack::<5>(vec![even, odd], axis + 1).reshape(doubled)
}

/// E18's mean arm: mean_v ‖m_v − k‖² / m², for the views' mean codes m_v = mean_{t∈P} c_vt, [V, R].
pub fn mean_code_loss(mean_codes_VR: Tensor<2>, code: [f32; 3], median_norm: f32) -> Tensor<1> {
    let target_1R = Tensor::<2>::from_data(TensorData::new(code.to_vec(), [1, 3]), &mean_codes_VR.device());
    (mean_codes_VR - target_1R).square().sum_dim(1).mean_dim(0).reshape([1]) / (median_norm * median_norm)
}

/// The values of the patches the start scores, [V, T, X] → [V, P, X]: all 64, or the central 4 × 4.
fn scored_patches(values_VTX: Tensor<3>, start: Start) -> Tensor<3> {
    match start {
        Start::Noise => values_VTX,
        Start::CentreDisc => {
            let centre: Vec<i64> = CENTRE_PATCHES.iter().map(|&patch| patch as i64).collect();
            let indices = Tensor::<1, burn::tensor::Int>::from_data(TensorData::new(centre, [CENTRE_PATCHES.len()]), &values_VTX.device());
            values_VTX.select(1, indices)
        }
    }
}

/// The mean code of each view over the patches the start scores, [V, T, R] → [V, R].
pub fn region_mean_codes(codes_VTR: Tensor<3>, start: Start) -> Tensor<2> {
    let views = codes_VTR.dims()[0];
    scored_patches(codes_VTR, start).mean_dim(1).reshape([views, 3])
}

/// The scored patches of all views as one set of canvas features, [V, T, X] → [M, X] with
/// M = V·P, view by view: what a set method compares with the target set (`recipe.Trainer`'s region).
pub fn region_features(values_VTX: Tensor<3>, start: Start) -> Tensor<2> {
    let scored_VPX = scored_patches(values_VTX, start);
    let [views, patches, width] = scored_VPX.dims();
    scored_VPX.reshape([views * patches, width])
}

/// The archive's state overflow: mean |x − clamp(x, −1, 1)| over every value of the grown states.
/// For the pyramid the states are both grids, equivalent to the reference's packed 20-channel state.
pub fn overflow(states: &[Tensor<3>]) -> Tensor<1> {
    let values: usize = states.iter().map(|state| state.dims().iter().product::<usize>()).sum();
    let excess = states
        .iter()
        .map(|state| (state.clone() - state.clone().clamp(-1.0, 1.0)).abs().sum())
        .reduce(|total, part| total + part)
        .expect("at least one state");
    excess / values as f32
}

/// One brush stamp of the Keep replay runtime (`damage_disc` in app/src/replay/figure-shaders.ts)
/// on a grid of `side` cells: a soft disc on the torus centred at (x, y) in cell coordinates, a
/// cell at its column and row index. Within `radius` the weight rises from the edge as a
/// smoothstep over a quarter radius (at least one cell). Each value moves toward a goal by that
/// weight: the 13 hidden channels toward fresh noise U(−0.5, 0.5), the three colour channels
/// toward one small grey value per cell, 0.2 × U(−0.5, 0.5). `key` is stamp k's stream,
/// `Stream::new(seed, DAMAGE).at(k)` (COARSE_DAMAGE for the pyramid's coarse grid). Returns the
/// per-cell weights [side²] and goals [side² × C].
pub fn damage_disc(key: Stream, side: usize, x: f32, y: f32, radius: f32) -> (Vec<f32>, Vec<f32>) {
    let wrap = |offset: f32| offset.min(side as f32 - offset);
    let edge = (radius / 4.0).max(1.0);
    let cells = side * side;
    let mut weights = vec![0.0; cells];
    let mut goals = vec![0.0; cells * CHANNELS];
    for cell in 0..cells {
        let dx = wrap(((cell % side) as f32 - x).abs());
        let dy = wrap(((cell / side) as f32 - y).abs());
        let t = ((radius - (dx * dx + dy * dy).sqrt()) / edge).clamp(0.0, 1.0);
        weights[cell] = t * t * (3.0 - 2.0 * t);
        let grey = 0.2 * (key.uniform((cell * CHANNELS) as u32) - 0.5);
        for channel in 0..CHANNELS {
            let index = cell * CHANNELS + channel;
            goals[index] = if channel < 3 { grey } else { key.uniform(index as u32) - 0.5 };
        }
    }
    (weights, goals)
}

/// The two readouts of a displayed picture, untransformed, at one pixel per fine cell, over the
/// start's patches (all 64, or the central 4 × 4 for the seeded centre).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigureReading {
    /// mean_t (u · c_t) / m over the read patches: u the unit lobe direction, m the median
    /// winning norm. 2.0 means twice the median winning norm along the lobe.
    pub strength: f32,
    /// The share of the read patches where fewer than 32 of the 16,384 blocks have strictly larger energy.
    pub winner_fraction: f32,
    /// The co-selected basis groups of the read patches (`co_selection`).
    pub co_selected: Vec<CoSelected>,
    /// Per patch of the 8 × 8 grid, all 64 of them, whether the requested group is selected there
    /// by the selection fraction's rule: the panel's map. The read region is the caller's `patches`.
    pub selected_T: Vec<bool>,
}

/// One basis group in a measurement's co-selection: the read patches on which it is among the 32
/// selected (`patches`), those on which it and the requested group are both selected (`joint`), and
/// the sum over its patches of its place among the 32 (`position_sum`: 1 for the largest squared
/// response of the patch; the requested group is at the cutoff, 32, where a tie alone selects it).
/// The panel orders tied shares by the mean position, `position_sum / patches`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CoSelected {
    pub group: u16,
    pub patches: u32,
    pub joint: u32,
    pub position_sum: u32,
}

/// The co-selected basis groups of the read patches: every group selected on at least
/// one read patch, by `patches` descending, then by group id. `selected_TK` holds the 32 selected
/// groups of every patch (`Addresses::blocks`). The requested group counts where it wins by the
/// selection fraction's rule (`requested_wins_T`, ties at the 32nd response included), so its
/// `patches` is the selection fraction's count; the others count where they are among the 32.
pub fn co_selection(selected_TK: &[u16], requested: u16, requested_wins_T: &[bool], patches: &[usize]) -> Vec<CoSelected> {
    let mut counts = std::collections::BTreeMap::<u16, (u32, u32, u32)>::new();
    for &patch in patches {
        let wins = requested_wins_T[patch];
        let slots = &selected_TK[patch * WINNERS..(patch + 1) * WINNERS];
        // The slots are in the patch's order of squared response (AddressAccumulator), so a slot is a place.
        let others = slots.iter().enumerate().filter(|&(_, &group)| group != requested).map(|(slot, &group)| (group, slot + 1));
        let requested_place = slots.iter().position(|&group| group == requested).map_or(WINNERS, |slot| slot + 1);
        for (group, place) in others.chain(wins.then_some((requested, requested_place))) {
            let (selected, joint, position_sum) = counts.entry(group).or_default();
            *selected += 1;
            *joint += u32::from(wins);
            *position_sum += place as u32;
        }
    }
    let mut groups: Vec<CoSelected> =
        counts.into_iter().map(|(group, (patches, joint, position_sum))| CoSelected { group, patches, joint, position_sum }).collect();
    groups.sort_by(|a, b| b.patches.cmp(&a.patches).then(a.group.cmp(&b.group)));
    groups
}

#[allow(clippy::too_many_arguments)]
pub async fn read(
    encoder: &Dino,
    calibration: &Calibration,
    reader: &DictionaryReader,
    picture_1CHW: Tensor<4>,
    block: u32,
    direction: [f32; 3],
    median_norm: f32,
    patches: &[usize],
) -> Result<FigureReading, String> {
    let native_1TD = encoder.forward(picture_1CHW).slice([0..1, PREFIX..PREFIX + PATCHES, 0..768]);
    let (addresses, codes_TR) = reader.read_block(calibration.tokens(native_1TD), block as usize).await?;
    let winners = addresses.winners(&codes_TR);
    let projection = |patch: usize| codes_TR[3 * patch..3 * patch + 3].iter().zip(direction).map(|(value, axis)| value * axis).sum::<f32>();
    let projections: f32 = patches.iter().map(|&patch| projection(patch)).sum();
    let wins = patches.iter().filter(|&&patch| winners[patch]).count();
    let co_selected = co_selection(&addresses.blocks, block as u16, &winners, patches);
    Ok(FigureReading {
        strength: projections / (patches.len() as f32 * median_norm),
        winner_fraction: wins as f32 / patches.len() as f32,
        co_selected,
        selected_T: winners,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "cpu")]
    use burn::tensor::Device;

    #[test]
    fn plans_follow_the_archive_ranges() {
        for update in 0..200 {
            let plan = Plan::draw(7, update, 4);
            let mut entries = plan.entries.clone();
            entries.sort();
            entries.dedup();
            assert_eq!(entries.len(), 4);
            assert!(plan.entries.iter().all(|&entry| entry < POOL));
            assert!(plan.reset);
            assert!((ROLLOUT_MIN..=ROLLOUT_MAX).contains(&plan.steps));
            assert_eq!(plan.views.len(), 8);
            for view in &plan.views {
                assert!(view.shift.iter().all(|shift| (-16..=16).contains(shift)));
                assert!(SCALES.contains(&view.scale));
                assert!((-5..=5).contains(&view.degrees));
            }
        }
    }

    #[test]
    fn batch_one_resets_one_sampled_state_in_four() {
        let resets: Vec<bool> = (0..8).map(|update| Plan::draw(7, update, 1).reset).collect();
        assert_eq!(resets, [true, false, false, false, true, false, false, false]);
    }

    #[test]
    fn co_selection_counts_the_read_patches_and_the_joint_ones() {
        // Three patches of 32 groups each: group 7 is requested; it wins on patches 0 and 2. Group 5
        // is selected on all three, group 9 on patch 1 only, group 3 on patches 0 and 2.
        let mut selected_TK = vec![0u16; 3 * WINNERS];
        for (patch, groups) in [[5u16, 3, 7], [5, 9, 100], [3, 5, 101]].iter().enumerate() {
            for (slot, value) in selected_TK[patch * WINNERS..(patch + 1) * WINNERS].iter_mut().enumerate() {
                // Fillers distinct per patch, so only the named groups repeat.
                *value = groups.get(slot).copied().unwrap_or(1000 + (patch * WINNERS + slot) as u16);
            }
        }
        // Patch 2 does not list 7 among its 32, but 7 wins there by a tie: the winner rule counts it.
        let wins = [true, false, true];
        let all = co_selection(&selected_TK, 7, &wins, &[0, 1, 2]);
        let row = |group: u16| all.iter().find(|entry| entry.group == group).cloned();
        // Places: 5 is first on patches 0 and 1 and second on patch 2; 3 is second on 0 and first on 2;
        // 7 is third on patch 0 and at the cutoff, 32, on patch 2, where the tie alone selects it.
        assert_eq!(row(5), Some(CoSelected { group: 5, patches: 3, joint: 2, position_sum: 4 }));
        assert_eq!(row(3), Some(CoSelected { group: 3, patches: 2, joint: 2, position_sum: 3 }));
        assert_eq!(row(7), Some(CoSelected { group: 7, patches: 2, joint: 2, position_sum: 35 }));
        assert_eq!(row(9), Some(CoSelected { group: 9, patches: 1, joint: 0, position_sum: 2 }));
        // By patches, then by group id: 5 (3), then 3 and 7 (2), then the groups on one patch.
        assert_eq!(all.iter().take(3).map(|entry| entry.group).collect::<Vec<_>>(), [5, 3, 7]);
        // Only the read patches count.
        let centre = co_selection(&selected_TK, 7, &wins, &[1]);
        assert_eq!(centre.iter().find(|entry| entry.group == 5).map(|entry| entry.joint), Some(0));
        assert!(centre.iter().all(|entry| entry.group != 7));
    }

    #[test]
    fn learning_rate_is_the_archive_cosine() {
        assert!((learning_rate(0) - 2e-3).abs() < 1e-12);
        assert!((learning_rate(999) - 2e-4).abs() < 1e-12);
        assert!((learning_rate(499) - 1.1e-3).abs() < 2e-6);
    }

    #[test]
    fn training_stops_at_its_target_until_extended() {
        let mut updates = UpdateCount::default();
        assert_eq!((updates.next(), updates.target), (Ok(0), UPDATES));
        updates.completed = UPDATES;
        assert!(updates.next().is_err());
        updates.extend(500);
        assert_eq!((updates.next(), updates.target), (Ok(UPDATES), UPDATES + 500));
        updates.completed = UPDATES + 500;
        assert!(updates.next().is_err());
    }

    #[test]
    fn a_continued_run_takes_the_schedule_from_its_update() {
        assert_eq!(UpdateCount::continued(450), UpdateCount { completed: 450, target: UPDATES });
        assert_eq!(UpdateCount::continued(450).next(), Ok(450));
        let finished = UpdateCount::continued(UPDATES);
        assert!(finished.next().is_err());
        assert_eq!(UpdateCount::continued(1500).target, 1500);
    }

    #[test]
    fn learning_rate_stays_final_past_the_schedule() {
        assert_eq!(learning_rate(1000), learning_rate(999));
        assert_eq!(learning_rate(4999), learning_rate(999));
    }

    #[test]
    fn the_pyramid_has_zeros_17088_values() {
        assert_eq!(RuleKind::Cell.parameters(), 7776);
        assert_eq!(RuleKind::Pyramid.parameters(), 17088);
    }

    #[test]
    fn the_seeded_start_is_trainer_centre_disc() {
        // trainer.centre_disc: 812 cells of the fine grid, rows and columns 48–79, and the
        // same 32 px circle on the coarse grid at half the radius (208 cells).
        let fine = Start::CentreDisc.mask(SIDE).unwrap();
        assert_eq!(fine.iter().filter(|&&kept| kept == 1.0).count(), 812);
        let kept_rows: Vec<usize> = (0..SIDE).filter(|row| fine[row * SIDE + 64] == 1.0).collect();
        assert_eq!((kept_rows[0], *kept_rows.last().unwrap()), (48, 79));
        assert_eq!(fine[64 * SIDE + 64], 1.0);
        assert_eq!(fine[0], 0.0);
        let coarse = Start::CentreDisc.mask(COARSE_SIDE).unwrap();
        assert_eq!(coarse.iter().filter(|&&kept| kept == 1.0).count(), 208);
        assert!(Start::Noise.mask(SIDE).is_none());
    }

    #[test]
    fn a_seeded_start_scores_the_central_four_by_four_patches() {
        assert_eq!(Start::Noise.patches().len(), 64);
        let centre = Start::CentreDisc.patches();
        // Pixels 32–95 of a 128 px picture: patch rows and columns 2–5 of 8.
        assert!(centre.iter().all(|patch| (2..6).contains(&(patch / 8)) && (2..6).contains(&(patch % 8))));
        assert_eq!(centre.len(), 16);
    }

    #[cfg(feature = "cpu")]
    #[test]
    fn region_mean_codes_average_only_the_scored_patches() {
        let device = Device::flex();
        // One view whose central patches hold code (1, 2, 3) and every other patch (9, 9, 9).
        let mut values = vec![9.0f32; PATCHES * 3];
        for &patch in &CENTRE_PATCHES {
            values[3 * patch..3 * patch + 3].copy_from_slice(&[1.0, 2.0, 3.0]);
        }
        let codes_VTR = Tensor::<3>::from_data(TensorData::new(values, [1, PATCHES, 3]), &device);
        let centre = region_mean_codes(codes_VTR.clone(), Start::CentreDisc).into_data().try_to_vec::<f32>().unwrap();
        assert_eq!(centre, [1.0, 2.0, 3.0]);
        let field = region_mean_codes(codes_VTR, Start::Noise).into_data().try_to_vec::<f32>().unwrap();
        let expected = |central: f32| (16.0 * central + 48.0 * 9.0) / 64.0;
        assert_eq!(field, [expected(1.0), expected(2.0), expected(3.0)]);
    }

    #[cfg(feature = "cpu")]
    #[test]
    fn upsampling_wraps_on_the_torus_with_quarter_weights() {
        let device = Device::flex();
        // Two coarse grids of 4 × 4 cells, two channels; grid g, cell (row, column), channel c
        // holds a distinct value, so every weight and wrap shows in the result.
        let (grids, side, channels) = (2, 4, 2);
        let value = |grid: usize, row: usize, column: usize, channel: usize| {
            (grid * 1000 + row * 100 + column * 10 + channel) as f32
        };
        let mut coarse = Vec::new();
        for grid in 0..grids {
            for cell in 0..side * side {
                for channel in 0..channels {
                    coarse.push(value(grid, cell / side, cell % side, channel));
                }
            }
        }
        let coarse_1MC = Tensor::<3>::from_data(TensorData::new(coarse, [1, grids * side * side, channels]), &device);
        let fine = upsample_torus(coarse_1MC, grids, side).into_data().try_to_vec::<f32>().unwrap();
        // The reference: along each axis the two cells and weights of the replay runtime's `axis`.
        let axis = |j: usize| {
            let k = j / 2;
            if j % 2 == 0 { ((k + side - 1) % side, k, 0.25f32, 0.75f32) } else { (k, (k + 1) % side, 0.75, 0.25) }
        };
        let fine_side = 2 * side;
        for grid in 0..grids {
            for y in 0..fine_side {
                for x in 0..fine_side {
                    let (w0, w1, wl0, wl1) = axis(x);
                    let (h0, h1, hl0, hl1) = axis(y);
                    for channel in 0..channels {
                        let top = value(grid, h0, w0, channel) * wl0 + value(grid, h0, w1, channel) * wl1;
                        let bottom = value(grid, h1, w0, channel) * wl0 + value(grid, h1, w1, channel) * wl1;
                        let expected = top * hl0 + bottom * hl1;
                        let actual = fine[((grid * fine_side + y) * fine_side + x) * channels + channel];
                        assert_eq!(actual, expected, "grid {grid}, fine cell ({x}, {y}), channel {channel}");
                    }
                }
            }
        }
    }

    #[cfg(feature = "cpu")]
    #[test]
    fn mean_code_loss_pulls_each_views_mean_to_the_anchor() {
        let device = Device::flex().autodiff();
        // Two views whose mean codes miss k = (2, 2, 2) by (−1, 0, 1) and (1, 0, −1); m = 2.
        let mean_codes_VR =
            Tensor::<2>::from_data(TensorData::new(vec![1.0f32, 2.0, 3.0, 3.0, 2.0, 1.0], [2, 3]), &device).require_grad();
        let loss = mean_code_loss(mean_codes_VR.clone(), [2.0, 2.0, 2.0], 2.0);
        let value = loss.clone().into_data().try_to_vec::<f32>().unwrap()[0];
        assert!((value - 0.5).abs() < 1e-6, "(2 + 2) / 2 / 4 = 0.5, got {value}");
        // d/dm_v = 2 (m_v − k) / (V m²) = (m_v − k) / 4.
        let gradient = mean_codes_VR.grad(&loss.backward()).unwrap().to_data().try_to_vec::<f32>().unwrap();
        assert_eq!(gradient, [-0.25, 0.0, 0.25, 0.25, 0.0, -0.25]);
    }

    #[cfg(feature = "cpu")]
    #[test]
    fn overflow_counts_only_values_beyond_one() {
        let device = Device::flex();
        let state_1NC = Tensor::<3>::from_data(TensorData::new(vec![-2.0f32, 0.5, 1.5, -1.0], [1, 1, 4]), &device);
        let value = overflow(&[state_1NC.clone()]).into_data().try_to_vec::<f32>().unwrap()[0];
        assert!((value - 0.375).abs() < 1e-6, "(1 + 0 + 0.5 + 0) / 4, got {value}");
        // The pyramid's two grids count as one state: (1.5 + 3) / 8 values.
        let coarse_1MC = Tensor::<3>::from_data(TensorData::new(vec![4.0f32, 0.0, 0.0, 0.0], [1, 1, 4]), &device);
        let both = overflow(&[state_1NC, coarse_1MC]).into_data().try_to_vec::<f32>().unwrap()[0];
        assert!((both - 4.5 / 8.0).abs() < 1e-6, "got {both}");
    }

    #[test]
    fn a_brush_stamp_is_a_soft_grey_disc_on_the_torus() {
        let key = |stamp| Stream::new(9317, draws::DAMAGE).at(stamp);
        let (weights, goals) = damage_disc(key(0), SIDE, 0.0, 0.0, 8.0);
        let at = |x: usize, y: usize| weights[y * SIDE + x];
        assert_eq!(at(0, 0), 1.0);
        // The disc wraps: (127, 0) is one cell from the centre, (8, 0) is on the rim.
        assert_eq!(at(127, 0), 1.0);
        assert_eq!(at(8, 0), 0.0);
        assert!(at(7, 0) > 0.0 && at(7, 0) < 1.0);
        assert_eq!(at(64, 64), 0.0);
        // Colour goals are one grey per cell within ±0.1; hidden goals span the start distribution.
        for cell in [0, 1, 129] {
            let base = cell * CHANNELS;
            assert!(goals[base] == goals[base + 1] && goals[base + 1] == goals[base + 2] && goals[base].abs() <= 0.1);
        }
        assert!(goals.iter().all(|goal| (-0.5..0.5).contains(goal)));
        // Each stamp draws afresh.
        assert_ne!(damage_disc(key(1), SIDE, 0.0, 0.0, 8.0).1[3], goals[3]);
        // The coarse grid wraps at its own side.
        let (coarse, _) = damage_disc(key(0), COARSE_SIDE, 0.0, 0.0, 4.0);
        assert_eq!((coarse.len(), coarse[COARSE_SIDE - 1]), (COARSE_CELLS, 1.0));
    }

    #[test]
    fn requests_need_a_code_a_scale_and_a_supported_batch() {
        let mut request = FigureRequest {
            block: 12002, code: [8.08, -9.04, 8.77], median_norm: 5.32, seed: 0, batch: 4,
            rule: RuleKind::Cell, start: Start::Noise, method: Method::BasisGroupMean, layers: Vec::new(),
        };
        assert!(request.validate().is_ok());
        request.batch = 2;
        assert!(request.validate().is_err());
        request.batch = 1;
        request.code = [0.0; 3];
        assert!(request.validate().is_err());
        request.code = [8.08, -9.04, 8.77];
        request.median_norm = 0.0;
        assert!(request.validate().is_err());
    }

    #[test]
    fn a_token_method_needs_its_layers_and_a_basis_group_method_none() {
        let mut request: FigureRequest = serde_json::from_str(
            r#"{"block": 12002, "code": [8.08, -9.04, 8.77], "medianNorm": 5.32, "seed": 0, "batch": 4,
                "rule": "pyramid", "start": "centre-disc", "method": "token-distribution",
                "layers": ["block-3", "block-6", "block-9", "final"]}"#,
        )
        .unwrap();
        assert!(request.validate().is_ok());
        assert_eq!(request.layers, [Layer::Block(3), Layer::Block(6), Layer::Block(9), Layer::Final]);
        assert_eq!(request.intermediate_blocks(), [3, 6, 9]);
        assert_eq!(request.compared_layers(), request.layers);
        assert_eq!(serde_json::to_value(&request).unwrap()["layers"], serde_json::json!(["block-3", "block-6", "block-9", "final"]));
        request.layers = vec![Layer::Final, Layer::Final];
        assert!(request.validate().is_err(), "repeated layers");
        request.layers.clear();
        assert!(request.validate().is_err(), "a token method without layers");
        request.method = Method::BasisGroupDistribution;
        assert!(request.validate().is_ok());
        assert_eq!(request.compared_layers(), [Layer::Final]);
        request.layers = vec![Layer::Final];
        assert!(request.validate().is_err(), "a basis-group method takes no layers");
        assert!(serde_json::from_str::<Layer>(r#""block-12""#).is_err());
        assert!(serde_json::from_str::<Layer>(r#""block 3""#).is_err());
    }

    #[test]
    fn requests_name_the_kind_as_the_material_file_does() {
        let request: FigureRequest = serde_json::from_str(
            r#"{"block": 12002, "code": [8.08, -9.04, 8.77], "medianNorm": 5.32, "seed": 0, "batch": 4,
                "rule": "pyramid", "start": "centre-disc"}"#,
        )
        .unwrap();
        assert_eq!((request.rule, request.start), (RuleKind::Pyramid, Start::CentreDisc));
        // A request without a method is basis-group mean matching, as every request before the set methods.
        assert_eq!((request.method, request.layers.len()), (Method::BasisGroupMean, 0));
    }
}
