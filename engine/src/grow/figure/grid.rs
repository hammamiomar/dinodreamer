//! Live cellular automaton grid for interactive replay and readout.
//!
//! One 128×128 torus grid (with the pyramid's 64×64 coarse grid) grown forward with a fixed rule.
//! The state at tick 0 uses `Stream::new(seed, NOISE)` (`COARSE_NOISE` for the coarse grid),
//! masked by the start; tick `t` fires cells from `Stream::new(seed, FIRE).at(t)` (`COARSE_FIRE`).
//! Each `(seed, tick)` pair therefore yields a reproducible picture.

use super::{
    CHANNELS, COARSE_SIDE, RuleKind, SIDE, Start, damage_disc,
    rule::{Cells, FigureRule},
};
use crate::{
    grow::draws::{self, Stream},
    state::read_values,
};
use burn::tensor::{Device, Tensor, TensorData};

/// One 128×128 torus grid (with a 64×64 coarse grid for pyramid rules) grown with a fixed rule.
pub struct FigureGrid {
    cells: Cells,
    pub rule: RuleKind,
    pub start: Start,
    pub seed: u32,
    pub tick: u32,
    /// Brush stamps since tick 0; stamp `k` draws from `Stream::new(seed, DAMAGE).at(k)`
    /// (`COARSE_DAMAGE` for the coarse grid).
    pub damages: u32,
}

impl FigureGrid {
    pub fn new(seed: u32, rule: RuleKind, start: Start, device: &Device) -> Self {
        let streams = (
            Stream::new(seed, draws::NOISE),
            Stream::new(seed, draws::COARSE_NOISE),
        );
        Self {
            cells: Cells::start(rule, start, streams.0, streams.1, &device.clone().inner()),
            rule,
            start,
            seed,
            tick: 0,
            damages: 0,
        }
    }

    /// Apply one brush stamp (`damage_disc`); the tick does not change. A pyramid rule stamps
    /// its coarse grid too, at half the centre and radius, with the same stamp count.
    pub fn damage(&mut self, x: f32, y: f32, radius: f32) {
        let stamp = |state_1NC: Tensor<3>, purpose: u32, side: usize, scale: f32| {
            let device = state_1NC.device();
            let key = Stream::new(self.seed, purpose).at(self.damages);
            let (weights, goals) = damage_disc(key, side, x * scale, y * scale, radius * scale);
            let weight_1N1 =
                Tensor::<3>::from_data(TensorData::new(weights, [1, side * side, 1]), &device);
            let goal_1NC = Tensor::<3>::from_data(
                TensorData::new(goals, [1, side * side, CHANNELS]),
                &device,
            );
            state_1NC.clone() + (goal_1NC - state_1NC) * weight_1N1
        };
        self.cells = Cells {
            fine_1NC: stamp(self.cells.fine_1NC.clone(), draws::DAMAGE, SIDE, 1.0),
            coarse_1MC: self
                .cells
                .coarse_1MC
                .clone()
                .map(|coarse| stamp(coarse, draws::COARSE_DAMAGE, COARSE_SIDE, 0.5)),
        };
        self.damages += 1;
    }

    /// Advance `steps` ticks using fixed parameters (`FigureRule::fixed`) of this grid's rule kind.
    pub fn advance(&mut self, rule: &FigureRule, steps: u32) {
        assert_eq!(rule.kind, self.rule, "a grid grows the rule kind it was made for");
        for _ in 0..steps {
            self.cells = rule.step_frozen(
                self.cells.clone(),
                Stream::new(self.seed, draws::FIRE).at(self.tick),
                Stream::new(self.seed, draws::COARSE_FIRE).at(self.tick),
            );
            self.tick += 1;
        }
    }

    /// The patches a reading of this grid counts: all 64, or the central 4 × 4 for a seeded start.
    pub fn patches(&self) -> &'static [usize] {
        self.start.patches()
    }

    /// The displayed byte levels 0–255, `[1, 3, 128, 128]`.
    fn levels(&self) -> Tensor<4> {
        let rgb_1CHW = (self.cells.colour() + 0.5)
            .clamp(0.0, 1.0)
            .reshape([1, SIDE, SIDE, 3])
            .permute([0, 3, 1, 2]);
        (rgb_1CHW * 255.0).round()
    }

    /// The displayed 8-bit picture in `[0, 1]` on the autodiff device, as the encoder reads it.
    pub fn picture(&self) -> Tensor<4> {
        (self.levels() / 255.0).autodiff()
    }

    /// Opaque RGBA bytes of the displayed picture, row-major.
    pub async fn rgba(&self) -> Result<Vec<u8>, String> {
        let rgb_HWC = self.levels().permute([0, 2, 3, 1]).flatten::<1>(0, 3);
        let values = read_values(rgb_HWC).await?;
        Ok(values
            .chunks_exact(3)
            .flat_map(|rgb| [rgb[0] as u8, rgb[1] as u8, rgb[2] as u8, 255])
            .collect())
    }

    /// The fine grid's state `[1, 128², C]`, then the coarse grid's for the pyramid, flattened.
    pub async fn state(&self) -> Result<Vec<Vec<f32>>, String> {
        let mut states = Vec::new();
        for state in self.cells.tensors() {
            states.push(read_values(state.flatten::<1>(0, 2)).await?);
        }
        Ok(states)
    }

    /// Whether every state value is finite. A sum propagates NaN and infinity, which a GPU max
    /// reduction may drop; a sum that overflows also means the grid left any useful range.
    pub async fn finite(&self) -> Result<bool, String> {
        let total = self
            .cells
            .tensors()
            .into_iter()
            .map(|state| state.abs().sum())
            .reduce(|total, part| total + part)
            .expect("a fine grid");
        Ok(read_values(total).await?[0].is_finite())
    }
}
