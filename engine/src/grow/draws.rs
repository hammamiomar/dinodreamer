//! Counter-based draws for the figure recipe and its live grid. Every random value is a
//! function of `(seed, purpose, counter, index)` through the PCG hash (Jarzynski and Olano
//! 2020), so offline verification tools and the replay page regenerate the same arrays
//! without sharing generator state. Arithmetic is modulo `2^32`.
//!
//! The live grid follows the replay contract:
//!   initial state  `u(pcg(pcg(seed ^ NOISE) + cell·16 + channel)) − 0.5`
//!   fire at tick t `u(pcg(pcg(pcg(seed ^ FIRE) + t) + cell)) < fire rate`
//! with `u(h) = (h >> 8) / 2^24`. Training uses the same form with its own purposes.

/// The live grid's purposes from the replay contract (`"nois"`, `"fire"`, `"damg"`).
pub const NOISE: u32 = 0x6e6f6973;
pub const FIRE: u32 = 0x66697265;
/// Brush stamp `k` since the grid's start uses `Stream::new(seed, DAMAGE).at(k)`.
pub const DAMAGE: u32 = 0x64616d67;
/// Training purposes: initial weights, pool states, reset states, batch choice, rollout
/// length, view transforms and per-step firing (`"init"`, `"pool"`, `"rset"`, `"pick"`, `"roll"`,
/// `"view"`, `"tfir"`).
pub const INIT: u32 = 0x696e6974;
pub const POOL: u32 = 0x706f6f6c;
pub const RESET: u32 = 0x72736574;
pub const PICK: u32 = 0x7069636b;
pub const ROLL: u32 = 0x726f6c6c;
pub const VIEW: u32 = 0x76696577;
pub const TRAIN_FIRE: u32 = 0x74666972;
/// The pyramid's coarse grid draws from its own streams, with the same formulas: on the live grid
/// the replay contract (`"cnoi"`, `"cfir"`, `"cdmg"`), in training the coarse pool, reset and
/// per-step firing (`"cpol"`, `"crst"`, `"ctfi"`).
pub const COARSE_NOISE: u32 = 0x636e6f69;
pub const COARSE_FIRE: u32 = 0x63666972;
pub const COARSE_DAMAGE: u32 = 0x63646d67;
pub const COARSE_POOL: u32 = 0x63706f6c;
pub const COARSE_RESET: u32 = 0x63727374;
pub const COARSE_TRAIN_FIRE: u32 = 0x63746669;

/// PCG hash constants shared by CPU streams and GPU counter kernels (`kernels::draws`).
pub(crate) const PCG_MULTIPLIER: u32 = 747_796_405;
pub(crate) const PCG_INCREMENT: u32 = 2_891_336_453;
pub(crate) const PCG_OUTPUT_MULTIPLIER: u32 = 277_803_737;
pub(crate) const UNIFORM_DIVISOR: f32 = 16_777_216.0;

pub fn pcg(value: u32) -> u32 {
    let state = value.wrapping_mul(PCG_MULTIPLIER).wrapping_add(PCG_INCREMENT);
    let word = ((state >> ((state >> 28) + 4)) ^ state).wrapping_mul(PCG_OUTPUT_MULTIPLIER);
    (word >> 22) ^ word
}

/// One keyed sequence of draws. `at` derives a sub-sequence, for example one per update.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stream(u32);

impl Stream {
    /// The mixed key for a GPU counter kernel. The next hash adds the value index.
    #[cfg(feature = "gpu")]
    pub(crate) fn key(self) -> u32 {
        self.0
    }

    pub fn new(seed: u32, purpose: u32) -> Self {
        Self(pcg(seed ^ purpose))
    }
    pub fn at(self, counter: u32) -> Self {
        Self(pcg(self.0.wrapping_add(counter)))
    }
    fn bits(self, index: u32) -> u32 {
        pcg(self.0.wrapping_add(index)) >> 8
    }
    /// Uniform in [0, 1) with 24 bits, exact in float32.
    pub fn uniform(self, index: u32) -> f32 {
        self.bits(index) as f32 / UNIFORM_DIVISOR
    }
    /// Uniform integer in [0, count), by integer arithmetic so float rounding cannot reach
    /// `count`. The bias is below count / 2^24.
    pub fn below(self, index: u32, count: usize) -> usize {
        ((self.bits(index) as u64 * count as u64) >> 24) as usize
    }
    /// `count` values uniform in [−0.5, 0.5): a noise state, index = cell·16 + channel.
    pub fn noise(self, count: usize) -> Vec<f32> {
        (0..count as u32).map(|index| self.uniform(index) - 0.5).collect()
    }
    /// 1 where a cell fires, else 0, for `cells` consecutive indices from 0.
    pub fn fired(self, cells: usize, rate: f32) -> Vec<f32> {
        (0..cells as u32)
            .map(|cell| if self.uniform(cell) < rate { 1.0 } else { 0.0 })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcg_matches_the_published_hash() {
        // Values from an independent Python evaluation of the published formula.
        assert_eq!(pcg(0), 129708002);
        assert_eq!(pcg(1), 2831084092);
        assert_eq!(pcg(u32::MAX), 3861530882);
    }

    #[test]
    fn replay_contract_keys_compose_as_documented() {
        let seed = 9317;
        let first = Stream::new(seed, NOISE).uniform(5);
        let manual = (pcg(pcg(seed ^ NOISE).wrapping_add(5)) >> 8) as f32 / 16777216.0;
        assert_eq!(first, manual);
        let tick = 600;
        let fire = Stream::new(seed, FIRE).at(tick).uniform(77);
        let manual = (pcg(pcg(pcg(seed ^ FIRE).wrapping_add(tick)).wrapping_add(77)) >> 8) as f32
            / 16777216.0;
        assert_eq!(fire, manual);
    }

    #[test]
    fn integer_draws_stay_below_their_count() {
        let stream = Stream::new(1, VIEW);
        let draws: Vec<usize> = (0..10_000).map(|index| stream.below(index, 33)).collect();
        assert!(draws.iter().all(|&draw| draw < 33));
        assert!((0..33).all(|value| draws.contains(&value)));
    }
}
