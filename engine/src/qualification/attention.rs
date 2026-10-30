//! Dense FP64 CPU oracle, independent of the GPU tiling and row reductions.
use super::{Comparison, compare_values, read_values};
use burn::tensor::{Device, Tensor, TensorData};

pub(super) async fn check_attention(device: &Device) -> Result<Vec<Comparison>, String> {
    let mut checks = Vec::new();
    for (shape, amplitude) in [
        ([1, 1, 7, 3], 0.7),
        ([2, 2, 33, 16], 5.0),
        ([1, 1, 261, 64], 0.7),
    ] {
        let [batch, heads, tokens, width] = shape;
        let count = shape.iter().product::<usize>();
        let values = |frequency: f64, scale: f64| -> Vec<f32> {
            (0..count)
                .map(|index| ((index as f64 * frequency + 0.23).sin() * scale) as f32)
                .collect()
        };
        let q = values(0.17, amplitude);
        let k = values(0.31, amplitude);
        let v = values(0.23, 0.8);
        let dy = values(0.43, 0.4);
        // Construct a non-contiguous B/H/T/E view while preserving oracle values.
        let tensor = |data: &[f32]| {
            let mut transposed = vec![0.0; count];
            for bh in 0..batch * heads {
                for t in 0..tokens {
                    for e in 0..width {
                        transposed[(bh * width + e) * tokens + t] =
                            data[(bh * tokens + t) * width + e];
                    }
                }
            }
            Tensor::<4>::from_data(
                TensorData::new(transposed, [batch, heads, width, tokens]),
                device,
            )
            .swap_dims(2, 3)
            .require_grad()
        };
        let query = tensor(&q);
        let key = tensor(&k);
        let value = tensor(&v);
        let output = crate::kernels::scaled_attention(query.clone(), key.clone(), value.clone());
        let mut gradients = (output.clone()
            * Tensor::<4>::from_data(TensorData::new(dy.clone(), shape), device))
        .sum()
        .backward();
        let expected = oracle(shape, &q, &k, &v, &dy);
        let actual = [
            output,
            query.grad_remove(&mut gradients).unwrap(),
            key.grad_remove(&mut gradients).unwrap(),
            value.grad_remove(&mut gradients).unwrap(),
        ];
        for ((label, actual), expected) in ["output", "dQ", "dK", "dV"]
            .into_iter()
            .zip(actual)
            .zip(expected)
        {
            let mut check = compare_values(
                &format!("attention-{batch}x{heads}x{tokens}x{width}-{label}"),
                &shape,
                &read_values(actual).await?,
                &expected,
                1e-5,
            )?;
            // Some oscillatory inputs nearly cancel dK. An absolute bound avoids
            // rejecting FP32 roundoff divided by that near-zero reference energy.
            check.absolute_tolerance = Some(1e-8);
            check.passed |= check.max_absolute <= 1e-8;
            checks.push(check);
        }
    }
    Ok(checks)
}

fn oracle(shape: [usize; 4], q: &[f32], k: &[f32], v: &[f32], dy: &[f32]) -> [Vec<f32>; 4] {
    let [batch, heads, tokens, width] = shape;
    let mut output = vec![0.0f64; q.len()];
    let mut dq = output.clone();
    let mut dk = output.clone();
    let mut dv = output.clone();
    let scale = 1.0 / (width as f64).sqrt();
    for bh in 0..batch * heads {
        let index = |token: usize, channel: usize| (bh * tokens + token) * width + channel;
        for i in 0..tokens {
            let mut probability: Vec<f64> = (0..tokens)
                .map(|j| {
                    (0..width)
                        .map(|e| q[index(i, e)] as f64 * k[index(j, e)] as f64)
                        .sum::<f64>()
                        * scale
                })
                .collect();
            let maximum = probability
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max);
            for value in &mut probability {
                *value = (*value - maximum).exp();
            }
            let total = probability.iter().sum::<f64>();
            for value in &mut probability {
                *value /= total;
            }
            let dp: Vec<f64> = (0..tokens)
                .map(|j| {
                    (0..width)
                        .map(|e| dy[index(i, e)] as f64 * v[index(j, e)] as f64)
                        .sum()
                })
                .collect();
            let mean_dp = probability.iter().zip(&dp).map(|(p, g)| p * g).sum::<f64>();
            for j in 0..tokens {
                let ds = scale * probability[j] * (dp[j] - mean_dp);
                for e in 0..width {
                    output[index(i, e)] += probability[j] * v[index(j, e)] as f64;
                    dq[index(i, e)] += ds * k[index(j, e)] as f64;
                    dk[index(j, e)] += ds * q[index(i, e)] as f64;
                    dv[index(j, e)] += probability[j] * dy[index(i, e)] as f64;
                }
            }
        }
    }
    [output, dq, dk, dv].map(|values| values.into_iter().map(|value| value as f32).collect())
}

#[cfg(test)]
mod tests {
    #[test]
    fn attention_outputs_and_input_gradients() {
        let device = burn::tensor::Device::wgpu_options().init().unwrap().autodiff();
        let checks = pollster::block_on(super::check_attention(&device)).unwrap();
        for check in checks {
            assert!(check.passed, "{check:?}");
        }
    }
}
