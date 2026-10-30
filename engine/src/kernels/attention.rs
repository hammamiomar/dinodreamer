//! Exact noncausal attention for short sequences, with an explicit derivative.
//! This materializes P_BHTT. It is not the linear-memory FlashAttention algorithm.

use super::{AttentionBackend, GeluBackend, NormBackend, gelu, heads, heads::Heads, matmul::batched_product, norm};
use burn::backend::{
    tensor::FloatTensor,
    wgpu::{CubeBackend, CubeTensor},
};
use burn::tensor::DType;
use burn_cubecl::{kernel::into_contiguous, ops::numeric::empty_device_dtype};
use cubecl::{CubeCount, CubeDim, prelude::*};

const ROW_THREADS: usize = 128;

#[cube(launch)]
fn softmax_rows(scores: &Tensor<f32>, probabilities: &mut Tensor<f32>, #[comptime] columns: usize) {
    let threads = comptime!(ROW_THREADS);
    let row = CUBE_POS as usize;
    let thread = UNIT_POS as usize;
    let mut shared = Shared::<[f32]>::new_slice(threads);
    let mut maximum = f32::new(-f32::MAX);
    for chunk in 0..columns.div_ceil(threads) {
        let column = thread + chunk * threads;
        if column < columns {
            maximum = f32::max(maximum, scores[row * columns + column]);
        }
    }
    shared[thread] = maximum;
    sync_cube();
    let mut offset = (threads / 2).runtime();
    while offset > 0 {
        if thread < offset {
            shared[thread] = f32::max(shared[thread], shared[thread + offset]);
        }
        sync_cube();
        offset /= 2;
    }
    maximum = shared[0];
    // All threads must load the maximum before the reduction buffer is reused.
    sync_cube();
    let mut total = 0.0;
    for chunk in 0..columns.div_ceil(threads) {
        let column = thread + chunk * threads;
        if column < columns {
            total += (scores[row * columns + column] - maximum).exp();
        }
    }
    shared[thread] = total;
    sync_cube();
    let mut offset = (threads / 2).runtime();
    while offset > 0 {
        if thread < offset {
            shared[thread] = shared[thread] + shared[thread + offset];
        }
        sync_cube();
        offset /= 2;
    }
    total = shared[0];
    for chunk in 0..columns.div_ceil(threads) {
        let column = thread + chunk * threads;
        if column < columns {
            probabilities[row * columns + column] =
                (scores[row * columns + column] - maximum).exp() / total;
        }
    }
}

#[cube(launch)]
fn softmax_gradient(
    probability: &Tensor<f32>,
    upstream: &Tensor<f32>,
    output: &mut Tensor<f32>,
    #[comptime] columns: usize,
    scale: f32,
) {
    let threads = comptime!(ROW_THREADS);
    let row = CUBE_POS as usize;
    let thread = UNIT_POS as usize;
    let mut shared = Shared::<[f32]>::new_slice(threads);
    let mut total = 0.0;
    for chunk in 0..columns.div_ceil(threads) {
        let column = thread + chunk * threads;
        if column < columns {
            let index = row * columns + column;
            total += probability[index] * upstream[index];
        }
    }
    shared[thread] = total;
    sync_cube();
    let mut offset = (threads / 2).runtime();
    while offset > 0 {
        if thread < offset {
            shared[thread] = shared[thread] + shared[thread + offset];
        }
        sync_cube();
        offset /= 2;
    }
    total = shared[0];
    for chunk in 0..columns.div_ceil(threads) {
        let column = thread + chunk * threads;
        if column < columns {
            let index = row * columns + column;
            output[index] = scale * probability[index] * (upstream[index] - total);
        }
    }
}

pub(super) fn forward(
    query: CubeTensor,
    key: CubeTensor,
    value: CubeTensor,
) -> (CubeTensor, CubeTensor) {
    let [batch, heads, tokens, width] = query.meta.shape().dims::<4>();
    let scores = batched_product(query, key, false, true, 1.0 / (width as f32).sqrt());
    let probability = empty_device_dtype(
        scores.client.clone(),
        scores.device.clone(),
        scores.meta.shape().clone(),
        DType::F32,
    );
    softmax_rows::launch(
        &probability.client,
        CubeCount::Static((batch * heads * tokens) as u32, 1, 1),
        CubeDim::new_1d(ROW_THREADS as u32),
        scores.into_tensor_arg(),
        probability.clone().into_tensor_arg(),
        tokens,
    );
    let output = batched_product(probability.clone(), value, false, false, 1.0);
    (output, probability)
}

/// P = softmax(Q K^T / sqrt(E)); O = P V. All operations stay on the device.
pub(super) fn backward(
    query: CubeTensor,
    key: CubeTensor,
    value: CubeTensor,
    probability: CubeTensor,
    upstream: CubeTensor,
) -> [CubeTensor; 3] {
    let upstream = into_contiguous(upstream);
    let [batch, heads, tokens, width] = query.meta.shape().dims::<4>();
    let value_gradient = batched_product(probability.clone(), upstream.clone(), true, false, 1.0);
    let probability_gradient = batched_product(upstream, value, false, true, 1.0);
    let score_gradient = empty_device_dtype(
        probability.client.clone(),
        probability.device.clone(),
        probability.meta.shape().clone(),
        DType::F32,
    );
    softmax_gradient::launch(
        &score_gradient.client,
        CubeCount::Static((batch * heads * tokens) as u32, 1, 1),
        CubeDim::new_1d(ROW_THREADS as u32),
        probability.into_tensor_arg(),
        probability_gradient.into_tensor_arg(),
        score_gradient.clone().into_tensor_arg(),
        tokens,
        1.0 / (width as f32).sqrt(),
    );
    let query_gradient = batched_product(score_gradient.clone(), key, false, false, 1.0);
    let key_gradient = batched_product(score_gradient, query, true, false, 1.0);
    [query_gradient, key_gradient, value_gradient]
}

impl AttentionBackend for CubeBackend {
    fn scaled_attention(
        query: FloatTensor<Self>,
        key: FloatTensor<Self>,
        value: FloatTensor<Self>,
    ) -> FloatTensor<Self> {
        forward(query, key, value).0
    }

    fn projected_attention(
        projected: FloatTensor<Self>,
        bias: FloatTensor<Self>,
        sin: FloatTensor<Self>,
        cos: FloatTensor<Self>,
    ) -> FloatTensor<Self> {
        let shape = heads_shape(&projected, &sin);
        let [queries, keys, values] = heads::split(projected, bias, sin, cos, shape);
        forward(queries, keys, values).0
    }
}

impl GeluBackend for CubeBackend {
    fn bias_gelu(input: FloatTensor<Self>, bias: FloatTensor<Self>) -> FloatTensor<Self> {
        gelu::forward(input, bias)
    }
}

impl NormBackend for CubeBackend {
    fn layer_norm(input: FloatTensor<Self>, weight: FloatTensor<Self>, bias: FloatTensor<Self>) -> FloatTensor<Self> {
        norm::forward(input, Some((weight, bias))).output
    }

    fn affine_free_norm(input: FloatTensor<Self>) -> FloatTensor<Self> {
        norm::forward(input, None).output
    }
}

/// B, H, T, E and the prefix from the projection [B, T, 3HE] and a RoPE table [patches, E].
pub(super) fn heads_shape(projected: &CubeTensor, sin: &CubeTensor) -> Heads {
    let [batch, tokens, columns] = projected.meta.shape().dims::<3>();
    let [patches, width] = sin.meta.shape().dims::<2>();
    assert_eq!(columns % (3 * width), 0);
    Heads { batch, heads: columns / (3 * width), tokens, width, prefix: tokens - patches }
}
