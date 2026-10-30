//! Head split with rotary position embedding (RoPE), and its transpose for the gradient.
//!
//! Forward: the qkv projection X W^T, [B, T, 3D] without its bias, gives queries, keys and
//! values, each [B, H, T, E] and contiguous for the attention products. The kernel adds the
//! bias and applies RoPE to the patch tokens of the queries and keys:
//! `rope(x)_e = x_e cos_e + r_e sin_e`, with `r_e = −x_{e+E/2}` for e < E/2 and
//! `r_e = x_{e−E/2}` above. The P = 5 prefix tokens and the values are not rotated.
//! Backward: the rotation is orthogonal, so `dx_e = g_e cos_e + g_{e+E/2} sin_{e+E/2}` for
//! e < E/2 and `dx_e = g_e cos_e − g_{e−E/2} sin_{e−E/2}` above.
//! One thread per output value; no reductions, so no order of additions to fix.

use burn::backend::wgpu::CubeTensor;
use burn::tensor::{DType, Shape};
use burn_cubecl::{kernel::into_contiguous, ops::numeric::empty_device_dtype};
use cubecl::{CubeCount, CubeDim, prelude::*};

const THREADS: u32 = 256;

/// Axes of the three outputs: B views, H heads, T tokens, E head width.
#[derive(Clone, Copy, Debug)]
pub(super) struct Heads {
    pub batch: usize,
    pub heads: usize,
    pub tokens: usize,
    pub width: usize,
    /// Leading tokens without a position: CLS and the storage tokens.
    pub prefix: usize,
}

#[cube(launch)]
fn split_heads(
    projected: &Tensor<f32>,
    bias: &Tensor<f32>,
    sin: &Tensor<f32>,
    cos: &Tensor<f32>,
    queries: &mut Tensor<f32>,
    keys: &mut Tensor<f32>,
    values: &mut Tensor<f32>,
    #[comptime] batch: usize,
    #[comptime] heads: usize,
    #[comptime] tokens: usize,
    #[comptime] width: usize,
    #[comptime] prefix: usize,
) {
    let index = ABSOLUTE_POS as usize;
    let per_part = comptime!(batch * heads * tokens * width);
    if index >= 3 * per_part {
        terminate!();
    }
    // Output order [part, b, h, t, e]; part 0 queries, 1 keys, 2 values.
    let e = index % width;
    let t = (index / width) % tokens;
    let h = (index / (width * tokens)) % heads;
    let b = (index / (width * tokens * heads)) % batch;
    let part = index / per_part;
    let model_width = comptime!(heads * width);
    let column = part * model_width + h * width + e;
    let row = (b * tokens + t) * 3 * model_width;
    let value = projected[row + column] + bias[column];
    let mut result = value;
    if part < 2 && t >= prefix {
        let half = comptime!(width / 2);
        let position = (t - prefix) * width + e;
        let rotated = if e < half {
            -(projected[row + column + half] + bias[column + half])
        } else {
            projected[row + column - half] + bias[column - half]
        };
        result = value * cos[position] + rotated * sin[position];
    }
    let target = index % per_part;
    if part == 0 {
        queries[target] = result;
    } else if part == 1 {
        keys[target] = result;
    } else {
        values[target] = result;
    }
}

#[cube(launch)]
fn merge_heads(
    query_gradient: &Tensor<f32>,
    key_gradient: &Tensor<f32>,
    value_gradient: &Tensor<f32>,
    sin: &Tensor<f32>,
    cos: &Tensor<f32>,
    gradient: &mut Tensor<f32>,
    #[comptime] batch: usize,
    #[comptime] heads: usize,
    #[comptime] tokens: usize,
    #[comptime] width: usize,
    #[comptime] prefix: usize,
) {
    let index = ABSOLUTE_POS as usize;
    let model_width = comptime!(heads * width);
    if index >= comptime!(batch * tokens * 3 * heads * width) {
        terminate!();
    }
    // Output order [b, t, part, h, e], the layout of the qkv projection.
    let e = index % width;
    let h = (index / width) % heads;
    let part = (index / model_width) % 3;
    let t = (index / (3 * model_width)) % tokens;
    let b = index / (3 * model_width * tokens);
    let source = ((b * heads + h) * tokens + t) * width + e;
    let result = if part == 2 {
        value_gradient[source]
    } else if t < prefix {
        if part == 0 { query_gradient[source] } else { key_gradient[source] }
    } else {
        let half = comptime!(width / 2);
        let position = (t - prefix) * width + e;
        // The partner value sits E/2 further along the head, or E/2 back.
        let partner_source = if e < half { source + half } else { source - half };
        let own = if part == 0 { query_gradient[source] } else { key_gradient[source] };
        let partner = if part == 0 { query_gradient[partner_source] } else { key_gradient[partner_source] };
        if e < half {
            own * cos[position] + partner * sin[position + half]
        } else {
            own * cos[position] - partner * sin[position - half]
        }
    };
    gradient[index] = result;
}

fn groups(values: usize) -> CubeCount {
    CubeCount::Static(values.div_ceil(THREADS as usize) as u32, 1, 1)
}

/// `projected` [B, T, 3D] without its bias → queries, keys and values [B, H, T, E].
/// `sin` and `cos` are [patches, E].
pub(super) fn split(
    projected: CubeTensor,
    bias: CubeTensor,
    sin: CubeTensor,
    cos: CubeTensor,
    shape: Heads,
) -> [CubeTensor; 3] {
    let projected = into_contiguous(projected);
    let (bias, sin, cos) = (into_contiguous(bias), into_contiguous(sin), into_contiguous(cos));
    let Heads { batch, heads, tokens, width, prefix } = shape;
    assert_eq!(projected.meta.shape().dims::<3>(), [batch, tokens, 3 * heads * width]);
    let output = || {
        empty_device_dtype(
            projected.client.clone(),
            projected.device.clone(),
            Shape::new([batch, heads, tokens, width]),
            DType::F32,
        )
    };
    let [queries, keys, values] = [output(), output(), output()];
    split_heads::launch(
        &projected.client,
        groups(3 * batch * heads * tokens * width),
        CubeDim::new_1d(THREADS),
        projected.clone().into_tensor_arg(),
        bias.into_tensor_arg(),
        sin.into_tensor_arg(),
        cos.into_tensor_arg(),
        queries.clone().into_tensor_arg(),
        keys.clone().into_tensor_arg(),
        values.clone().into_tensor_arg(),
        batch,
        heads,
        tokens,
        width,
        prefix,
    );
    [queries, keys, values]
}

/// The gradients of queries, keys and values [B, H, T, E] → the gradient of `projected` [B, T, 3D].
pub(super) fn merge(gradients: [CubeTensor; 3], sin: CubeTensor, cos: CubeTensor, shape: Heads) -> CubeTensor {
    let [query_gradient, key_gradient, value_gradient] = gradients.map(into_contiguous);
    let (sin, cos) = (into_contiguous(sin), into_contiguous(cos));
    let Heads { batch, heads, tokens, width, prefix } = shape;
    let gradient = empty_device_dtype(
        query_gradient.client.clone(),
        query_gradient.device.clone(),
        Shape::new([batch, tokens, 3 * heads * width]),
        DType::F32,
    );
    merge_heads::launch(
        &gradient.client,
        groups(3 * batch * heads * tokens * width),
        CubeDim::new_1d(THREADS),
        query_gradient.into_tensor_arg(),
        key_gradient.into_tensor_arg(),
        value_gradient.into_tensor_arg(),
        sin.into_tensor_arg(),
        cos.into_tensor_arg(),
        gradient.clone().into_tensor_arg(),
        batch,
        heads,
        tokens,
        width,
        prefix,
    );
    gradient
}
