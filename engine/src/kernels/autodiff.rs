use crate::profiling::detail as profile_reader;
use super::{AttentionBackend, FrozenLinearBackend, GeluBackend, NormBackend, PixelResampleBackend, ResampleBackend, attention, gelu, heads, norm, resample};
use burn::backend::{
    autodiff::{
        Autodiff,
        checkpoint::{base::Checkpointer, strategy::CheckpointStrategy},
        grads::Gradients,
        ops::{Backward, Ops, OpsKind},
    },
    tensor::{FloatTensor, IntTensor},
    wgpu::{CubeBackend, CubeTensor},
};

impl<C: CheckpointStrategy> AttentionBackend for Autodiff<CubeBackend, C> {
    fn scaled_attention(
        query: FloatTensor<Self>,
        key: FloatTensor<Self>,
        value: FloatTensor<Self>,
    ) -> FloatTensor<Self> {
        #[derive(Debug)]
        struct AttentionBackward;
        impl Backward<CubeBackend, 3> for AttentionBackward {
            type State = (CubeTensor, CubeTensor, CubeTensor, CubeTensor);
            fn backward(
                self,
                ops: Ops<Self::State, 3>,
                grads: &mut Gradients,
                _: &mut Checkpointer,
            ) {
                let (query, key, value, probability) = ops.state;
                let upstream = grads.consume::<CubeBackend>(&ops.node);
                let derivatives = attention::backward(query, key, value, probability, upstream);
                for (parent, gradient) in ops.parents.iter().zip(derivatives) {
                    if let Some(parent) = parent {
                        grads.register::<CubeBackend>(parent.id, gradient);
                    }
                }
            }
        }
        let prepared = AttentionBackward
            .prepare::<C>([query.node(), key.node(), value.node()])
            .compute_bound()
            .stateful();
        let (query, key, value) = (
            query.into_primitive(),
            key.into_primitive(),
            value.into_primitive(),
        );
        match prepared {
            OpsKind::Tracked(prepared) => {
                let (output, probability) =
                    attention::forward(query.clone(), key.clone(), value.clone());
                prepared.finish((query, key, value, probability), output)
            }
            OpsKind::UnTracked(prepared) => prepared.finish(attention::forward(query, key, value).0),
        }
    }

    fn projected_attention(
        projected: FloatTensor<Self>,
        bias: FloatTensor<Self>,
        sin: FloatTensor<Self>,
        cos: FloatTensor<Self>,
    ) -> FloatTensor<Self> {
        #[derive(Debug)]
        struct ProjectedAttentionBackward;
        impl Backward<CubeBackend, 1> for ProjectedAttentionBackward {
            // Queries, keys, values, probabilities, the RoPE tables and the head shape.
            type State = (CubeTensor, CubeTensor, CubeTensor, CubeTensor, CubeTensor, CubeTensor, heads::Heads);
            fn backward(
                self,
                ops: Ops<Self::State, 1>,
                grads: &mut Gradients,
                _: &mut Checkpointer,
            ) {
                let (query, key, value, probability, sin, cos, shape) = ops.state;
                let upstream = grads.consume::<CubeBackend>(&ops.node);
                let gradients = profile_reader("attention backward", || attention::backward(query, key, value, probability, upstream));
                if let Some(parent) = &ops.parents[0] {
                    let merged = profile_reader("heads backward", || heads::merge(gradients, sin, cos, shape));
                    grads.register::<CubeBackend>(parent.id, merged);
                }
            }
        }
        let prepared = ProjectedAttentionBackward
            .prepare::<C>([projected.node()])
            .compute_bound()
            .stateful();
        let (projected, bias) = (projected.into_primitive(), bias.into_primitive());
        let (sin, cos) = (sin.into_primitive(), cos.into_primitive());
        let shape = attention::heads_shape(&projected, &sin);
        let [query, key, value] = heads::split(projected, bias, sin.clone(), cos.clone(), shape);
        match prepared {
            OpsKind::Tracked(prepared) => {
                let (output, probability) =
                    attention::forward(query.clone(), key.clone(), value.clone());
                prepared.finish((query, key, value, probability, sin, cos, shape), output)
            }
            OpsKind::UnTracked(prepared) => prepared.finish(attention::forward(query, key, value).0),
        }
    }
}

impl<B: FrozenLinearBackend, C: CheckpointStrategy> FrozenLinearBackend for Autodiff<B, C> {
    fn frozen_linear(
        input: FloatTensor<Self>,
        weight: FloatTensor<Self>,
        transpose: bool,
    ) -> FloatTensor<Self> {
        #[derive(Debug)]
        struct LinearBackward;

        impl<B: FrozenLinearBackend> Backward<B, 1> for LinearBackward {
            // dX = dY @ W. The frozen weight is already resident; X is not saved.
            type State = (FloatTensor<B>, bool);

            fn backward(
                self,
                ops: Ops<Self::State, 1>,
                grads: &mut Gradients,
                _: &mut Checkpointer,
            ) {
                let (weight, transpose) = ops.state;
                let gradient = grads.consume::<B>(&ops.node);
                if let Some(parent) = &ops.parents[0] {
                    let derivative = profile_reader("linear backward", || B::frozen_linear(gradient, weight, !transpose));
                    grads.register::<B>(parent.id, derivative);
                }
            }
        }

        let weight = weight.into_primitive();
        match LinearBackward
            .prepare::<C>([input.node()])
            .compute_bound()
            .stateful()
        {
            OpsKind::Tracked(prepared) => {
                let output = B::frozen_linear(input.into_primitive(), weight.clone(), transpose);
                prepared.finish((weight, transpose), output)
            }
            OpsKind::UnTracked(prepared) => {
                prepared.finish(B::frozen_linear(input.into_primitive(), weight, transpose))
            }
        }
    }
}

/// LayerNorm through `kernels/norm.rs`; the backward needs the input, the frozen weight and
/// the row statistics, not the output.
fn tracked_norm<C: CheckpointStrategy>(
    input: FloatTensor<Autodiff<CubeBackend, C>>,
    weight_and_bias: Option<(CubeTensor, CubeTensor)>,
) -> FloatTensor<Autodiff<CubeBackend, C>> {
    #[derive(Debug)]
    struct NormBackward;
    impl Backward<CubeBackend, 1> for NormBackward {
        // Input, weight (None: affine-free), row means and standard deviations.
        type State = (CubeTensor, Option<CubeTensor>, CubeTensor, CubeTensor);
        fn backward(self, ops: Ops<Self::State, 1>, grads: &mut Gradients, _: &mut Checkpointer) {
            let (input, weight, means, deviations) = ops.state;
            let upstream = grads.consume::<CubeBackend>(&ops.node);
            if let Some(parent) = &ops.parents[0] {
                let derivative = profile_reader("norm backward", || norm::backward(input, weight, means, deviations, upstream));
                grads.register::<CubeBackend>(parent.id, derivative);
            }
        }
    }
    let prepared = NormBackward.prepare::<C>([input.node()]).compute_bound().stateful();
    let input = input.into_primitive();
    let weight = weight_and_bias.as_ref().map(|(weight, _)| weight.clone());
    let normalized = norm::forward(input.clone(), weight_and_bias);
    match prepared {
        OpsKind::Tracked(prepared) => prepared.finish((input, weight, normalized.means, normalized.deviations), normalized.output),
        OpsKind::UnTracked(prepared) => prepared.finish(normalized.output),
    }
}

impl<C: CheckpointStrategy> NormBackend for Autodiff<CubeBackend, C> {
    fn layer_norm(input: FloatTensor<Self>, weight: FloatTensor<Self>, bias: FloatTensor<Self>) -> FloatTensor<Self> {
        tracked_norm::<C>(input, Some((weight.into_primitive(), bias.into_primitive())))
    }

    fn affine_free_norm(input: FloatTensor<Self>) -> FloatTensor<Self> {
        tracked_norm::<C>(input, None)
    }
}

impl<B: ResampleBackend, C: CheckpointStrategy> ResampleBackend for Autodiff<B, C> {
    fn resample_axis(
        input: FloatTensor<Self>,
        indices: IntTensor<Self>,
        weights: FloatTensor<Self>,
        transposed_indices: IntTensor<Self>,
        transposed_weights: FloatTensor<Self>,
        axis: usize,
    ) -> FloatTensor<Self> {
        #[derive(Debug)]
        struct ResampleBackward;
        impl<B: ResampleBackend> Backward<B, 1> for ResampleBackward {
            // The gradient resamples with Aᵀ: the transposed taps first, then A's for symmetry.
            type State = (IntTensor<B>, FloatTensor<B>, IntTensor<B>, FloatTensor<B>, usize);
            fn backward(self, ops: Ops<Self::State, 1>, grads: &mut Gradients, _: &mut Checkpointer) {
                let (transposed_indices, transposed_weights, indices, weights, axis) = ops.state;
                let upstream = grads.consume::<B>(&ops.node);
                if let Some(parent) = &ops.parents[0] {
                    let gradient = B::resample_axis(upstream, transposed_indices, transposed_weights, indices, weights, axis);
                    grads.register::<B>(parent.id, gradient);
                }
            }
        }
        let (weights, transposed_weights) = (weights.into_primitive(), transposed_weights.into_primitive());
        match ResampleBackward.prepare::<C>([input.node()]).compute_bound().stateful() {
            OpsKind::Tracked(prepared) => {
                let output = B::resample_axis(
                    input.into_primitive(),
                    indices.clone(),
                    weights.clone(),
                    transposed_indices.clone(),
                    transposed_weights.clone(),
                    axis,
                );
                prepared.finish((transposed_indices, transposed_weights, indices, weights, axis), output)
            }
            OpsKind::UnTracked(prepared) => prepared.finish(B::resample_axis(
                input.into_primitive(),
                indices,
                weights,
                transposed_indices,
                transposed_weights,
                axis,
            )),
        }
    }
}

impl<C: CheckpointStrategy> PixelResampleBackend for Autodiff<CubeBackend, C> {
    fn resample_pixels(
        input: FloatTensor<Self>,
        indices: IntTensor<Self>,
        weights: FloatTensor<Self>,
        transposed_indices: IntTensor<Self>,
        transposed_weights: FloatTensor<Self>,
    ) -> FloatTensor<Self> {
        #[derive(Debug)]
        struct PixelResampleBackward;
        impl Backward<CubeBackend, 1> for PixelResampleBackward {
            type State = (CubeTensor, CubeTensor);
            fn backward(
                self,
                ops: Ops<Self::State, 1>,
                grads: &mut Gradients,
                _: &mut Checkpointer,
            ) {
                let (indices, weights) = ops.state;
                let upstream = grads.consume::<CubeBackend>(&ops.node);
                if let Some(parent) = &ops.parents[0] {
                    let gradient = profile_reader("view gradient", || {
                        resample::transpose_pixels(upstream, indices, weights)
                    });
                    grads.register::<CubeBackend>(parent.id, gradient);
                }
            }
        }
        let prepared = PixelResampleBackward
            .prepare::<C>([input.node()])
            .compute_bound()
            .stateful();
        let weights = weights.into_primitive();
        let transposed_weights = transposed_weights.into_primitive();
        match prepared {
            OpsKind::Tracked(prepared) => {
                let output = CubeBackend::resample_pixels(
                    input.into_primitive(),
                    indices,
                    weights,
                    transposed_indices.clone(),
                    transposed_weights.clone(),
                );
                prepared.finish((transposed_indices, transposed_weights), output)
            }
            OpsKind::UnTracked(prepared) => prepared.finish(CubeBackend::resample_pixels(
                input.into_primitive(),
                indices,
                weights,
                transposed_indices,
                transposed_weights,
            )),
        }
    }
}

impl<C: CheckpointStrategy> GeluBackend for Autodiff<CubeBackend, C> {
    fn bias_gelu(input: FloatTensor<Self>, bias: FloatTensor<Self>) -> FloatTensor<Self> {
        #[derive(Debug)]
        struct GeluBackward;
        impl Backward<CubeBackend, 1> for GeluBackward {
            // The input without its bias, and the bias.
            type State = (CubeTensor, CubeTensor);
            fn backward(self, ops: Ops<Self::State, 1>, grads: &mut Gradients, _: &mut Checkpointer) {
                let (input, bias) = ops.state;
                let upstream = grads.consume::<CubeBackend>(&ops.node);
                if let Some(parent) = &ops.parents[0] {
                    let derivative = profile_reader("GELU backward", || gelu::backward(input, bias, upstream));
                    grads.register::<CubeBackend>(parent.id, derivative);
                }
            }
        }
        let prepared = GeluBackward.prepare::<C>([input.node()]).compute_bound().stateful();
        let (input, bias) = (input.into_primitive(), bias.into_primitive());
        match prepared {
            OpsKind::Tracked(prepared) => {
                let output = gelu::forward(input.clone(), bias.clone());
                prepared.finish((input, bias), output)
            }
            OpsKind::UnTracked(prepared) => prepared.finish(gelu::forward(input, bias)),
        }
    }
}
