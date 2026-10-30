//! Small CPU oracles cover the linear kernel's tails, strides and input derivative.
use super::{Comparison, compare_values, read_values};
use burn::tensor::{Device, Tensor, TensorData};

pub(super) async fn check_linear(device: &Device) -> Result<Vec<Comparison>, String> {
    let mut checks = Vec::new();
    for [batch, tokens, input, output] in [
        [1, 1, 17, 7],
        [2, 33, 17, 65],
        [1, 65, 33, 63],
        [2, 261, 64, 96],
    ] {
        checks.extend(check_case(device, batch, tokens, input, output).await?);
    }
    Ok(checks)
}

async fn check_case(
    device: &Device,
    batch: usize,
    tokens: usize,
    input: usize,
    output: usize,
) -> Result<[Comparison; 2], String> {
    let name = format!("tiled-linear-{batch}x{tokens}x{input}x{output}");
    // Non-contiguous views at the kernel boundary. The CPU loops use the source
    // layouts, not a copy of the GPU indexing or its tiling algorithm.
    let values_BIT: Vec<f32> = (0..batch * input * tokens)
        .map(|index| ((index as f64 * 0.13).sin() * 0.2) as f32)
        .collect();
    let weight_IO: Vec<f32> = (0..input * output)
        .map(|index| ((index as f64 * 0.17).cos() * 0.3) as f32)
        .collect();
    let upstream_BTO: Vec<f32> = (0..batch * tokens * output)
        .map(|index| ((index as f64 * 0.19).sin() * 0.4) as f32)
        .collect();
    let values_BTI = Tensor::<3>::from_data(
        TensorData::new(values_BIT.clone(), [batch, input, tokens]),
        device,
    )
    .swap_dims(1, 2)
    .require_grad();
    let weight_OI =
        Tensor::<2>::from_data(TensorData::new(weight_IO.clone(), [input, output]), device)
            .transpose();
    let projected_BTO = crate::kernels::frozen_linear(values_BTI.clone(), weight_OI);
    let upstream = Tensor::<3>::from_data(
        TensorData::new(upstream_BTO.clone(), [batch, tokens, output]),
        device,
    );
    let mut gradients = (projected_BTO.clone() * upstream).sum().backward();

    let mut expected_BTO = vec![0.0f32; batch * tokens * output];
    let mut expected_gradient_BTI = vec![0.0f32; batch * tokens * input];
    for b in 0..batch {
        for t in 0..tokens {
            for o in 0..output {
                expected_BTO[(b * tokens + t) * output + o] = (0..input)
                    .map(|i| {
                        values_BIT[(b * input + i) * tokens + t] as f64
                            * weight_IO[i * output + o] as f64
                    })
                    .sum::<f64>()
                    as f32;
            }
            for i in 0..input {
                expected_gradient_BTI[(b * tokens + t) * input + i] = (0..output)
                    .map(|o| {
                        upstream_BTO[(b * tokens + t) * output + o] as f64
                            * weight_IO[i * output + o] as f64
                    })
                    .sum::<f64>()
                    as f32;
            }
        }
    }
    Ok([
        compare_values(
            &name,
            &[batch, tokens, output],
            &read_values(projected_BTO).await?,
            &expected_BTO,
            1e-5,
        )?,
        compare_values(
            &format!("{name}-gradient"),
            &[batch, tokens, input],
            &read_values(values_BTI.grad_remove(&mut gradients).unwrap()).await?,
            &expected_gradient_BTI,
            1e-5,
        )?,
    ])
}
