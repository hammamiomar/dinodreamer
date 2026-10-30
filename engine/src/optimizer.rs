//! Adam updates only the five image arrays. State stays on the device.

use burn::tensor::{Bool, Tensor};

pub const LEARNING_RATE: f64 = 0.025;
pub const BETA1: f64 = 0.9;
pub const BETA2: f64 = 0.999;
const EPSILON: f64 = 1e-8;

pub struct Adam {
    moments: Vec<(Tensor<4>, Tensor<4>)>,
    /// Per parameter and array, `1 − β₁ⁿ` and `1 − β₂ⁿ` for the n updates it has received
    /// since it was last fresh: Adam's bias corrections. A re-seed (Noise brush) sets them to
    /// zero, so the parameter's next steps are a fresh image's. They follow
    /// `d ← β d + (1 − β)`, which adds positive terms only; `1 − βⁿ` from βⁿ in FP32 would lose
    /// about four digits at n = 1.
    corrections: Vec<(Tensor<4>, Tensor<4>)>,
    /// Updates of the whole image since the last restart or install.
    pub updates: u32,
    pub learning_rate: f64,
    /// The moment decays. The app always uses BETA1 and BETA2; tests set others.
    pub beta1: f64,
    pub beta2: f64,
    /// One step multiplier per level, coarsest first: the recipe's `OptimizerSpec::level_rates`,
    /// 1 for every level by default.
    pub level_rates: Vec<f64>,
}

impl Adam {
    pub fn new(levels: &[Tensor<4>]) -> Self {
        let zeros = || -> Vec<(Tensor<4>, Tensor<4>)> {
            levels
                .iter()
                .map(|level| {
                    let zero = level.clone().inner().zeros_like();
                    (zero.clone(), zero)
                })
                .collect()
        };
        Self {
            moments: zeros(),
            corrections: zeros(),
            updates: 0,
            learning_rate: LEARNING_RATE,
            beta1: BETA1,
            beta2: BETA2,
            level_rates: vec![1.0; levels.len()],
        }
    }

    /// Zero the moments and bias corrections where `masks` (one per level) is true: those
    /// parameters start again as in a fresh image.
    pub fn reset(&mut self, masks: &[Tensor<4, Bool>]) {
        assert_eq!(masks.len(), self.moments.len());
        for (state, mask) in self.moments.iter_mut().chain(&mut self.corrections).zip(masks.iter().chain(masks)) {
            state.0 = state.0.clone().mask_fill(mask.clone(), 0.0);
            state.1 = state.1.clone().mask_fill(mask.clone(), 0.0);
        }
    }

    /// The moments and bias corrections of every level, [m, v, 1 − β₁ⁿ, 1 − β₂ⁿ]: what carries a run's
    /// optimizer into another (Train resume's measurement of continued runs).
    pub fn state(&self) -> Vec<[Tensor<4>; 4]> {
        self.moments
            .iter()
            .zip(&self.corrections)
            .map(|((first, second), (first_correction, second_correction))| {
                [first.clone(), second.clone(), first_correction.clone(), second_correction.clone()]
            })
            .collect()
    }

    /// Take another run's moments and bias corrections (`state`), level for level.
    pub fn set_state(&mut self, state: Vec<[Tensor<4>; 4]>) {
        assert_eq!(state.len(), self.moments.len());
        for ((moments, corrections), [first, second, first_correction, second_correction]) in
            self.moments.iter_mut().zip(&mut self.corrections).zip(state)
        {
            *moments = (first, second);
            *corrections = (first_correction, second_correction);
        }
    }

    pub fn update(&mut self, levels: &mut [Tensor<4>], gradients: Vec<Tensor<4>>) {
        assert_eq!(levels.len(), gradients.len());
        self.updates += 1;
        for ((((level, gradient), (first, second)), (first_correction, second_correction)), &rate) in
            levels.iter_mut().zip(gradients).zip(&mut self.moments).zip(&mut self.corrections).zip(&self.level_rates)
        {
            let gradient = gradient.inner();
            let (beta1, beta2) = (self.beta1, self.beta2);
            *first = first.clone() * beta1 + gradient.clone() * (1.0 - beta1);
            *second = second.clone() * beta2 + gradient.square() * (1.0 - beta2);
            *first_correction = first_correction.clone() * beta1 + (1.0 - beta1);
            *second_correction = second_correction.clone() * beta2 + (1.0 - beta2);
            let denominator = second.clone().sqrt() / second_correction.clone().sqrt() + EPSILON;
            let updated = level.clone().inner()
                - first.clone() / denominator / first_correction.clone() * (self.learning_rate * rate);
            *level = updated.autodiff().require_grad();
        }
    }
}

#[cfg(all(test, feature = "cpu"))]
mod tests {
    use super::*;
    use burn::tensor::{Device, TensorData};

    /// The four public step sizes and two level profiles.
    const PUBLIC_STEPS: [f64; 4] = [0.0125, 0.025, 0.05, 0.1];
    const PROFILES: [[f64; 5]; 2] = [[1.0; 5], [4.0, 2.83, 2.0, 1.41, 1.0]];

    /// Adam as the textbook writes it, in f64: m ← β₁ m + (1 − β₁) g, v ← β₂ v + (1 − β₂) g²,
    /// x ← x − lr × (m / (1 − β₁ᵗ)) / (√(v / (1 − β₂ᵗ)) + ε). The engine's EPSILON goes
    /// outside the bias correction of √v, as PyTorch's does.
    fn textbook_adam(x: &mut [f64], g: &[f64], m: &mut [f64], v: &mut [f64], t: u32, lr: f64) {
        for i in 0..x.len() {
            m[i] = BETA1 * m[i] + (1.0 - BETA1) * g[i];
            v[i] = BETA2 * v[i] + (1.0 - BETA2) * g[i] * g[i];
            let m_hat = m[i] / (1.0 - BETA1.powi(t as i32));
            let v_hat = v[i] / (1.0 - BETA2.powi(t as i32));
            x[i] -= lr * m_hat / (v_hat.sqrt() + EPSILON);
        }
    }

    #[test]
    fn adam_matches_the_textbook_at_every_public_step_and_profile_with_fixed_gradients() {
        // Gradients that cover the cases: positive, negative, zero, near the epsilon and tiny.
        let gradient = [1.0f64, -1.0, 0.0, 1e-8, -1e-12, 0.3];
        let device = Device::flex().autodiff();
        for step in PUBLIC_STEPS {
            for rates in PROFILES {
                let start = [0.5f64, -1.0, 2.0, 0.0, 0.25, -0.75];
                let mut levels: Vec<Tensor<4>> = (0..5)
                    .map(|_| Tensor::<4>::from_data(TensorData::new(start.map(|v| v as f32).to_vec(), [1, 1, 1, 6]), &device).require_grad())
                    .collect();
                let mut adam = Adam::new(&levels);
                assert_eq!(adam.updates, 0);
                adam.learning_rate = step;
                adam.level_rates = rates.to_vec();
                let mut expected: Vec<[f64; 6]> = vec![start; 5];
                let (mut m, mut v) = (vec![[0.0f64; 6]; 5], vec![[0.0f64; 6]; 5]);
                for t in 1..=3 {
                    let gradients = (0..5)
                        .map(|_| Tensor::<4>::from_data(TensorData::new(gradient.map(|g| g as f32).to_vec(), [1, 1, 1, 6]), &device).inner())
                        .collect();
                    adam.update(&mut levels, gradients);
                    assert_eq!(adam.updates, t);
                    for level in 0..5 {
                        textbook_adam(&mut expected[level], &gradient, &mut m[level], &mut v[level], t, step * rates[level]);
                        let actual = levels[level].clone().into_data().try_to_vec::<f32>().unwrap();
                        for i in 0..6 {
                            assert!(
                                (actual[i] as f64 - expected[level][i]).abs() < 2e-6,
                                "step {step}, rates {rates:?}, update {t}, level {level}, entry {i}: {} vs {}",
                                actual[i],
                                expected[level][i]
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn level_rates_scale_the_step_of_each_level() {
        let device = Device::flex().autodiff();
        let mut levels = vec![
            Tensor::<4>::from_floats([[[[0.0]]]], &device).require_grad(),
            Tensor::<4>::from_floats([[[[0.0]]]], &device).require_grad(),
        ];
        let mut adam = Adam::new(&levels);
        adam.level_rates = vec![4.0, 1.0];
        adam.update(&mut levels, vec![Tensor::<4>::from_floats([[[[1.0]]]], &device).inner(), Tensor::<4>::from_floats([[[[1.0]]]], &device).inner()]);
        let read = |tensor: &Tensor<4>| tensor.clone().into_data().try_to_vec::<f32>().unwrap()[0];
        assert!((read(&levels[0]) + 4.0 * LEARNING_RATE as f32).abs() < 1e-6);
        assert!((read(&levels[1]) + LEARNING_RATE as f32).abs() < 1e-6);
    }

    #[test]
    fn reset_zeroes_both_moments_only_where_masked() {
        let device = Device::flex().autodiff();
        let mut levels = vec![Tensor::<4>::from_floats([[[[1.0, 2.0, 3.0]]]], &device).require_grad()];
        let mut adam = Adam::new(&levels);
        adam.update(&mut levels, vec![Tensor::<4>::from_floats([[[[1.0, -2.0, 3.0]]]], &device).inner()]);
        let mask = Tensor::<4, Bool>::from_bool(TensorData::new(vec![false, true, false], [1, 1, 1, 3]), &device.clone().inner());
        adam.reset(&[mask]);
        let read = |tensor: &Tensor<4>| tensor.clone().into_data().try_to_vec::<f32>().unwrap();
        let (first, second) = &adam.moments[0];
        assert_eq!(read(first), [0.1, 0.0, 0.3]);
        assert_eq!(read(second)[1], 0.0);
        assert!(read(second)[0] > 0.0 && read(second)[2] > 0.0);
        assert_eq!(read(&adam.corrections[0].0)[1], 0.0);
        assert!(read(&adam.corrections[0].0)[0] > 0.0);
    }

    #[test]
    fn without_momentum_the_step_follows_the_latest_gradient() {
        // Two updates with opposite gradients. Bias-corrected Adam's first step is the
        // learning rate either way. With beta1 = 0.9 the second step is small, because the
        // first moment still remembers the first gradient; with beta1 = 0 it is a full step.
        let device = Device::flex().autodiff();
        let second_step = |beta1: f64| {
            let mut levels = vec![Tensor::<4>::from_floats([[[[0.0]]]], &device).require_grad()];
            let mut adam = Adam::new(&levels);
            assert_eq!((adam.beta1, adam.beta2), (BETA1, BETA2));
            adam.beta1 = beta1;
            adam.update(&mut levels, vec![Tensor::<4>::from_floats([[[[1.0]]]], &device).inner()]);
            let after_first = levels[0].clone().into_data().try_to_vec::<f32>().unwrap()[0];
            adam.update(&mut levels, vec![Tensor::<4>::from_floats([[[[-1.0]]]], &device).inner()]);
            let after_second = levels[0].clone().into_data().try_to_vec::<f32>().unwrap()[0];
            assert!((after_first + LEARNING_RATE as f32).abs() < 1e-6, "first step {after_first}");
            after_second - after_first
        };
        // beta1 = 0.9: m = 0.9 × 0.1 − 0.1 = −0.01, corrected by 1 − 0.9² = 0.19; v̂ = 1.
        assert!((second_step(BETA1) - LEARNING_RATE as f32 * 0.01 / 0.19).abs() < 1e-6);
        assert!((second_step(0.0) - LEARNING_RATE as f32).abs() < 1e-6);
    }

    #[test]
    fn a_fully_reset_parameter_steps_like_a_fresh_image() {
        // After five updates and a reset of every parameter, the next step equals a fresh
        // Adam's first step on the same values and gradient (about the learning rate).
        let device = Device::flex().autodiff();
        let start = || vec![Tensor::<4>::from_floats([[[[0.5, -1.0, 2.0]]]], &device).require_grad()];
        let gradient = || Tensor::<4>::from_floats([[[[0.3, -2.0, 0.01]]]], &device).inner();
        let mut levels = start();
        let mut adam = Adam::new(&levels);
        for _ in 0..5 {
            adam.update(&mut levels, vec![gradient()]);
        }
        let all = Tensor::<4, Bool>::from_bool(TensorData::new(vec![true; 3], [1, 1, 1, 3]), &device.clone().inner());
        adam.reset(&[all]);
        let mut reset_levels = start();
        adam.update(&mut reset_levels, vec![gradient()]);
        let mut fresh_levels = start();
        Adam::new(&fresh_levels).update(&mut fresh_levels, vec![gradient()]);
        let read = |tensor: &Tensor<4>| tensor.clone().into_data().try_to_vec::<f32>().unwrap();
        assert_eq!(read(&reset_levels[0]), read(&fresh_levels[0]));
        let step = read(&start()[0]).iter().zip(read(&reset_levels[0])).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
        assert!((step - LEARNING_RATE as f32).abs() < 1e-4, "first step {step}");
    }
}
