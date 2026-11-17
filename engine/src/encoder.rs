//! Frozen DINOv3 ViT-B/16. B = views, T = 261 tokens, D = 768 channels.
//! H = 12 attention heads, E = 64 channels/head, F = 3072 MLP channels.

use crate::assets::{LoadError, Weights};
use crate::profiling::detail as profile_reader;
#[cfg(not(feature = "gpu"))]
use burn::tensor::activation;
use burn::tensor::{Device, Tensor};

pub const WIDTH: usize = 768;
pub const DEPTH: usize = 12;
pub const HEADS: usize = 12;
pub const HEAD_WIDTH: usize = 64;
pub const PREFIX: usize = 5;
pub const PATCHES: usize = 256;
pub const TOKENS: usize = PREFIX + PATCHES;
/// The checkpoint's RoPE periods: BF16 values, exact in FP32. The stem file carries the
/// tables of the 16×16 patch grid (256 px); `Rope::grid` rebuilds them for the 8×8 grid of a
/// 128 px picture, and `load_stem` checks that these periods reproduce the shipped tables.
pub const ROPE_PERIODS: [f32; HEAD_WIDTH / 4] = [
    1.0, 1.3359375, 1.78125, 2.375, 3.15625, 4.21875, 5.625, 7.5, 10.0, 13.3125, 17.75, 23.75,
    31.625, 42.25, 56.25, 75.0,
];
/// Largest difference allowed between the rebuilt and shipped 16×16 tables: a wrong period
/// changes them by far more, FP32 rounding of the angle by about 1e-6.
const ROPE_TOLERANCE: f32 = 1e-5;
/// Zero-based transformer layers read for appearance matching (layers 3, 6, 9 and 12 counting from 1).
pub const APPEARANCE_LAYERS: [usize; 4] = [2, 5, 8, 11];
pub(crate) const NORM_EPS: f64 = 1e-5;

/// LayerNorm without a learned channel multiplier or offset, over the last axis. On the GPU
/// one kernel each way (`kernels/norm.rs`).
fn affine_free_norm(tokens_BTD: Tensor<3>) -> Tensor<3> {
    #[cfg(feature = "gpu")]
    return crate::kernels::affine_free_norm(tokens_BTD);
    #[cfg(not(feature = "gpu"))]
    plain_affine_free_norm(tokens_BTD)
}

/// GELU in the erf form (PyTorch's nn.GELU, not the tanh approximation). Plain Burn: the CPU
/// path, and the oracle that qualifies `kernels/gelu.rs`.
#[cfg_attr(all(feature = "gpu", not(feature = "harness")), allow(dead_code))]
pub(crate) fn plain_gelu(hidden_BTF: Tensor<3>) -> Tensor<3> {
    hidden_BTF.clone() * 0.5 * ((hidden_BTF / 2.0_f64.sqrt()).erf() + 1.0)
}

/// Plain Burn: the CPU path, and the oracle that qualifies `kernels/norm.rs`.
#[cfg_attr(all(feature = "gpu", not(feature = "harness")), allow(dead_code))]
pub(crate) fn plain_affine_free_norm(tokens_BTD: Tensor<3>) -> Tensor<3> {
    let centered_BTD = tokens_BTD.clone() - tokens_BTD.mean_dim(2);
    let variance_BT1 = centered_BTD.clone().square().mean_dim(2);
    centered_BTD / (variance_BT1 + NORM_EPS).sqrt()
}

struct Linear {
    weight_OI: Tensor<2>,
    bias_O: Tensor<1>,
}

impl Linear {
    fn load(weights: &Weights, name: &str, input: usize, output: usize) -> Result<Self, LoadError> {
        Ok(Self {
            weight_OI: weights.tensor(&format!("{name}.weight"), [output, input])?,
            bias_O: weights.tensor(&format!("{name}.bias"), [output])?,
        })
    }

    fn forward(&self, tokens_BTI: Tensor<3>) -> Tensor<3> {
        #[cfg(feature = "gpu")]
        let projected_BTO = crate::kernels::frozen_linear(tokens_BTI, self.weight_OI.clone());
        #[cfg(not(feature = "gpu"))]
        let projected_BTO = tokens_BTI.matmul(self.weight_OI.clone().transpose().unsqueeze());
        projected_BTO + self.bias_O.clone().reshape([1, 1, self.bias_O.dims()[0]])
    }
}

struct LayerNorm {
    weight_D: Tensor<1>,
    bias_D: Tensor<1>,
}

impl LayerNorm {
    fn load(weights: &Weights, name: &str) -> Result<Self, LoadError> {
        Ok(Self {
            weight_D: weights.tensor(&format!("{name}.weight"), [WIDTH])?,
            bias_D: weights.tensor(&format!("{name}.bias"), [WIDTH])?,
        })
    }

    fn forward(&self, tokens_BTD: Tensor<3>) -> Tensor<3> {
        #[cfg(feature = "gpu")]
        return crate::kernels::layer_norm(tokens_BTD, self.weight_D.clone(), self.bias_D.clone());
        #[cfg(not(feature = "gpu"))]
        return plain_affine_free_norm(tokens_BTD) * self.weight_D.clone().reshape([1, 1, WIDTH])
            + self.bias_D.clone().reshape([1, 1, WIDTH]);
    }
}

pub struct Block {
    norm1: LayerNorm,
    qkv: Linear,
    projection: Linear,
    attention_scale_D: Tensor<1>,
    norm2: LayerNorm,
    mlp_in: Linear,
    mlp_out: Linear,
    mlp_scale_D: Tensor<1>,
}

impl Block {
    pub fn load(bytes: &[u8], device: &Device) -> Result<Self, LoadError> {
        let weights = Weights::new(bytes, device)?;
        Ok(Self {
            norm1: LayerNorm::load(&weights, "norm1")?,
            qkv: Linear::load(&weights, "attn.qkv", WIDTH, 3 * WIDTH)?,
            projection: Linear::load(&weights, "attn.proj", WIDTH, WIDTH)?,
            attention_scale_D: weights.tensor("ls1.gamma", [WIDTH])?,
            norm2: LayerNorm::load(&weights, "norm2")?,
            mlp_in: Linear::load(&weights, "mlp.fc1", WIDTH, 4 * WIDTH)?,
            mlp_out: Linear::load(&weights, "mlp.fc2", 4 * WIDTH, WIDTH)?,
            mlp_scale_D: weights.tensor("ls2.gamma", [WIDTH])?,
        })
    }

    pub fn forward(&self, tokens_BTD: Tensor<3>, rope: &Rope) -> Tensor<3> {
        let [batch, tokens, _] = tokens_BTD.dims();
        let normalized_BTD = profile_reader("norm forward", || self.norm1.forward(tokens_BTD.clone()));
        let attention_BTD = self
            .attention(normalized_BTD, rope)
            .swap_dims(1, 2)
            .reshape([batch, tokens, WIDTH]);
        let tokens_BTD = tokens_BTD
            + profile_reader("attention projection forward", || self.projection.forward(attention_BTD))
                * self.attention_scale_D.clone().reshape([1, 1, WIDTH]);
        let normalized_BTD = profile_reader("norm forward", || self.norm2.forward(tokens_BTD.clone()));
        let hidden_BTF = self.activated(normalized_BTD);
        tokens_BTD
            + profile_reader("MLP output forward", || self.mlp_out.forward(hidden_BTF)) * self.mlp_scale_D.clone().reshape([1, 1, WIDTH])
    }

    /// GELU of the first MLP layer, [B, T, F]. On the GPU one kernel adds the layer's bias
    /// and applies GELU, one computes its gradient (`kernels/gelu.rs`).
    #[cfg(feature = "gpu")]
    fn activated(&self, normalized_BTD: Tensor<3>) -> Tensor<3> {
        let projected_BTF = profile_reader("MLP input forward", || {
            crate::kernels::frozen_linear(normalized_BTD, self.mlp_in.weight_OI.clone())
        });
        profile_reader("GELU forward", || crate::kernels::bias_gelu(projected_BTF, self.mlp_in.bias_O.clone()))
    }

    #[cfg(not(feature = "gpu"))]
    fn activated(&self, normalized_BTD: Tensor<3>) -> Tensor<3> {
        plain_gelu(self.mlp_in.forward(normalized_BTD))
    }

    /// Multi-head self-attention of the normalized tokens, [B, H, T, E]. On the GPU one kernel
    /// adds the qkv bias, splits the heads and applies RoPE (`kernels/heads.rs`).
    #[cfg(feature = "gpu")]
    fn attention(&self, normalized_BTD: Tensor<3>, rope: &Rope) -> Tensor<4> {
        let projected_BTO = profile_reader("QKV forward", || {
            crate::kernels::frozen_linear(normalized_BTD, self.qkv.weight_OI.clone())
        });
        let (sin_PE, cos_PE) = rope.tables_PE();
        profile_reader("attention and heads forward", || {
            crate::kernels::projected_attention(projected_BTO, self.qkv.bias_O.clone(), sin_PE, cos_PE)
        })
    }

    #[cfg(not(feature = "gpu"))]
    fn attention(&self, normalized_BTD: Tensor<3>, rope: &Rope) -> Tensor<4> {
        let [queries_BHTE, keys_BHTE, values_BHTE] = rope.split(self.qkv.forward(normalized_BTD));
        let scores_BHTT = queries_BHTE.matmul(keys_BHTE.transpose()) / (HEAD_WIDTH as f64).sqrt();
        activation::softmax(scores_BHTT, 3).matmul(values_BHTE)
    }

    /// The layer's attention computed explicitly from the residual stream entering it: the
    /// softmax weights [B, H, T, T] (row = query token, column = key token) and their output
    /// weights · values [B, H, T, E]. The arithmetic is the CPU path's: q and k with RoPE on the
    /// patch tokens, scaled by 1/√E. The GPU forward fuses it (`kernels::projected_attention`)
    /// and never forms the weights; `examples/explain_check.rs` compares the two outputs.
    pub fn explicit_attention(&self, tokens_BTD: Tensor<3>, rope: &Rope) -> (Tensor<4>, Tensor<4>) {
        let normalized_BTD = self.norm1.forward(tokens_BTD);
        let [queries_BHTE, keys_BHTE, values_BHTE] = rope.split(self.qkv.forward(normalized_BTD));
        let scores_BHTT = queries_BHTE.matmul(keys_BHTE.transpose()) / (HEAD_WIDTH as f64).sqrt();
        let weights_BHTT = burn::tensor::activation::softmax(scores_BHTT, 3);
        (weights_BHTT.clone(), weights_BHTT.matmul(values_BHTE))
    }

    /// The forward pass's own attention output [B, H, T, E] from the residual stream entering the layer.
    pub fn forward_attention(&self, tokens_BTD: Tensor<3>, rope: &Rope) -> Tensor<4> {
        self.attention(self.norm1.forward(tokens_BTD), rope)
    }
}

/// One layer of the forward pass laid open (the /how explorable of DINO): the residual stream
/// entering and leaving the layer, its attention weights, and the output tokens.
pub struct Probe {
    pub before_1TD: Tensor<3>,
    pub after_1TD: Tensor<3>,
    /// Softmax weights [1, H, T, T], row = query token, column = key token.
    pub attention_1HTT: Tensor<4>,
    /// The tokens after the final LayerNorm, [1, T, D]: what the reader reads.
    pub native_1TD: Tensor<3>,
}

pub struct Rope {
    sin_11TE: Tensor<4>,
    cos_11TE: Tensor<4>,
}

/// DINOv3's axial RoPE angles for a side × side patch grid, [side², E] row-major: patch
/// coordinates (i + 0.5) / side · 2 − 1 per axis, angle 2π·coordinate / period, the 16
/// row angles then the 16 column angles, tiled twice. FP32 like the upstream module.
pub fn rope_tables(side: usize) -> (Vec<f32>, Vec<f32>) {
    let coordinate = |index: usize| (index as f32 + 0.5) / side as f32 * 2.0 - 1.0;
    let mut sin_PE = Vec::with_capacity(side * side * HEAD_WIDTH);
    let mut cos_PE = Vec::with_capacity(side * side * HEAD_WIDTH);
    for row in 0..side {
        for column in 0..side {
            let angles: Vec<f32> = [coordinate(row), coordinate(column)]
                .iter()
                .flat_map(|&position| {
                    ROPE_PERIODS.map(|period| std::f32::consts::TAU * position / period)
                })
                .collect();
            for _ in 0..2 {
                sin_PE.extend(angles.iter().map(|&angle| (angle as f64).sin() as f32));
                cos_PE.extend(angles.iter().map(|&angle| (angle as f64).cos() as f32));
            }
        }
    }
    (sin_PE, cos_PE)
}

impl Rope {
    pub fn grid(side: usize, device: &Device) -> Self {
        let (sin_PE, cos_PE) = rope_tables(side);
        let table = |values: Vec<f32>| {
            Tensor::<1>::from_floats(values.as_slice(), device).reshape([1, 1, side * side, HEAD_WIDTH])
        };
        Self { sin_11TE: table(sin_PE), cos_11TE: table(cos_PE) }
    }

    /// Queries, keys and values [B, H, T, E] from the qkv projection with its bias, [B, T, 3D],
    /// with RoPE on the queries' and keys' patch tokens. Plain Burn: the CPU path, and the
    /// oracle that qualifies `kernels/heads.rs`, and the explorable's explicit attention.
    pub(crate) fn split(&self, qkv_BTO: Tensor<3>) -> [Tensor<4>; 3] {
        let [batch, tokens, _] = qkv_BTO.dims();
        let qkv_BT3HE = qkv_BTO.reshape([batch, tokens, 3, HEADS, HEAD_WIDTH]);
        let heads = |index: usize| {
            qkv_BT3HE
                .clone()
                .slice([0..batch, 0..tokens, index..index + 1, 0..HEADS, 0..HEAD_WIDTH])
                .reshape([batch, tokens, HEADS, HEAD_WIDTH])
                .swap_dims(1, 2)
        };
        [self.apply(heads(0)), self.apply(heads(1)), heads(2)]
    }

    /// The sine and cosine tables, [patches, E].
    #[cfg(feature = "gpu")]
    pub(crate) fn tables_PE(&self) -> (Tensor<2>, Tensor<2>) {
        let patches = self.sin_11TE.dims()[2];
        let table = |table_11TE: &Tensor<4>| table_11TE.clone().reshape([patches, HEAD_WIDTH]);
        (table(&self.sin_11TE), table(&self.cos_11TE))
    }

    fn apply(&self, values_BHTE: Tensor<4>) -> Tensor<4> {
        let [batch, heads, tokens, width] = values_BHTE.dims();
        let patches = tokens - PREFIX;
        let prefix_BHPE = values_BHTE
            .clone()
            .slice([0..batch, 0..heads, 0..PREFIX, 0..width]);
        let patches_BHTE = values_BHTE.slice([0..batch, 0..heads, PREFIX..tokens, 0..width]);
        let first_BHTE = patches_BHTE
            .clone()
            .slice([0..batch, 0..heads, 0..patches, 0..width / 2]);
        let second_BHTE =
            patches_BHTE
                .clone()
                .slice([0..batch, 0..heads, 0..patches, width / 2..width]);
        let rotated_BHTE = Tensor::cat(vec![-second_BHTE, first_BHTE], 3);
        let patches_BHTE =
            patches_BHTE * self.cos_11TE.clone() + rotated_BHTE * self.sin_11TE.clone();
        Tensor::cat(vec![prefix_BHPE, patches_BHTE], 2)
    }
}

/// Both readout conventions from one encoder pass.
pub struct Readout {
    /// Final layer with the pretrained affine output LayerNorm: CLS, four storage tokens and the patches.
    pub native_BTD: Tensor<3>,
    /// Patch tokens after each requested zero-based block, in increasing order, under the affine-free
    /// LayerNorm. Empty when none is requested.
    pub intermediate_BPD: Vec<Tensor<3>>,
}

/// Weights do not require gradients. Operations still track gradients of the input image.
pub struct Dino {
    patch_projection: Linear,
    prefix_1PD: Tensor<3>,
    pub blocks: Vec<Block>,
    output_norm: LayerNorm,
    /// The 16×16 patch grid of a 256 px picture, as shipped in the stem file.
    pub rope: Rope,
    /// The 8×8 patch grid of a 128 px picture (the figure recipe), rebuilt from `ROPE_PERIODS`.
    pub rope_8x8: Rope,
    rgb_mean_1C11: Tensor<4>,
    rgb_std_1C11: Tensor<4>,
}

impl Dino {
    pub fn load_stem(bytes: &[u8], device: &Device) -> Result<Self, LoadError> {
        let weights = Weights::new(bytes, device)?;
        let cls_11D = weights.tensor("cls_token", [1, 1, WIDTH])?;
        let storage_14D = weights.tensor("storage_tokens", [1, 4, WIDTH])?;
        let (sin_PE, cos_PE) = rope_tables(16);
        let shipped_sin = weights.values("rope.sin", [PATCHES, HEAD_WIDTH])?;
        let shipped_cos = weights.values("rope.cos", [PATCHES, HEAD_WIDTH])?;
        let difference = sin_PE
            .iter()
            .chain(&cos_PE)
            .zip(shipped_sin.iter().chain(&shipped_cos))
            .map(|(rebuilt, shipped)| (rebuilt - shipped).abs())
            .fold(0.0, f32::max);
        if difference > ROPE_TOLERANCE {
            return Err(LoadError::Contract(format!(
                "The RoPE periods do not reproduce the stem's tables (difference {difference})"
            )));
        }
        Ok(Self {
            patch_projection: Linear {
                weight_OI: weights
                    .tensor::<4>("patch_embed.proj.weight", [WIDTH, 3, 16, 16])?
                    .reshape([WIDTH, 3 * 16 * 16]),
                bias_O: weights.tensor("patch_embed.proj.bias", [WIDTH])?,
            },
            prefix_1PD: Tensor::cat(vec![cls_11D, storage_14D], 1),
            blocks: Vec::with_capacity(DEPTH),
            output_norm: LayerNorm::load(&weights, "norm")?,
            rope: Rope {
                sin_11TE: weights
                    .tensor::<2>("rope.sin", [PATCHES, HEAD_WIDTH])?
                    .reshape([1, 1, PATCHES, HEAD_WIDTH]),
                cos_11TE: weights
                    .tensor::<2>("rope.cos", [PATCHES, HEAD_WIDTH])?
                    .reshape([1, 1, PATCHES, HEAD_WIDTH]),
            },
            rope_8x8: Rope::grid(8, device),
            rgb_mean_1C11: Tensor::<1>::from_floats([0.485, 0.456, 0.406], device)
                .reshape([1, 3, 1, 1]),
            rgb_std_1C11: Tensor::<1>::from_floats([0.229, 0.224, 0.225], device)
                .reshape([1, 3, 1, 1]),
        })
    }

    /// Pictures of 256 or 128 pixels per side: 16×16 or 8×8 patches.
    pub fn embed(&self, images_BCHW: Tensor<4>) -> Tensor<3> {
        let [batch, _, height, width] = images_BCHW.dims();
        assert!(height == width && (height == 256 || height == 128), "DINO reads 256 or 128 px squares");
        let side = height / 16;
        let images_BCHW = (images_BCHW - self.rgb_mean_1C11.clone()) / self.rgb_std_1C11.clone();
        // Non-overlapping convolution is a matrix product over flattened C×16×16 patches.
        let patches_BTI = images_BCHW
            .reshape([batch, 3, side, 16, side, 16])
            .permute([0, 2, 4, 1, 3, 5])
            .reshape([batch, side * side, 768]);
        let patches_BTD = self.patch_projection.forward(patches_BTI);
        let prefix_BPD = self.prefix_1PD.clone().expand([batch, PREFIX, WIDTH]);
        Tensor::cat(vec![prefix_BPD, patches_BTD], 1)
    }

    pub fn forward(&self, images_BCHW: Tensor<4>) -> Tensor<3> {
        self.readout(images_BCHW, &[]).native_BTD
    }

    /// One full pass over one picture that keeps layer `layer` (0–11) open: `Probe`. The tokens
    /// are those of `forward`; the attention weights come from `Block::explicit_attention`.
    pub fn probe(&self, image_1CHW: Tensor<4>, layer: usize) -> Probe {
        assert_eq!(self.blocks.len(), DEPTH, "Load all twelve DINO layers before inference");
        assert!(layer < DEPTH, "DINO has layers 0 to 11");
        let mut tokens_1TD = self.embed(image_1CHW);
        let rope = if tokens_1TD.dims()[1] == TOKENS { &self.rope } else { &self.rope_8x8 };
        let mut opened = None;
        for (index, block) in self.blocks.iter().enumerate() {
            let entering_1TD = tokens_1TD.clone();
            tokens_1TD = block.forward(tokens_1TD, rope);
            if index == layer {
                let (attention_1HTT, _) = block.explicit_attention(entering_1TD.clone(), rope);
                opened = Some((entering_1TD, tokens_1TD.clone(), attention_1HTT));
            }
        }
        let (before_1TD, after_1TD, attention_1HTT) = opened.expect("the layer is one of the twelve");
        Probe { before_1TD, after_1TD, attention_1HTT, native_1TD: self.output_norm.forward(tokens_1TD) }
    }

    /// One pass, with the patch tokens after each of `intermediate` (zero-based blocks, e.g.
    /// `APPEARANCE_LAYERS` for an appearance term) under the affine-free LayerNorm.
    pub fn readout(&self, images_BCHW: Tensor<4>, intermediate: &[usize]) -> Readout {
        assert_eq!(
            self.blocks.len(),
            DEPTH,
            "Load all twelve DINO layers before inference"
        );
        assert!(intermediate.windows(2).all(|pair| pair[0] < pair[1]), "intermediate blocks increase");
        let mut tokens_BTD = profile_reader("patch embedding forward", || self.embed(images_BCHW));
        let rope = if tokens_BTD.dims()[1] == TOKENS { &self.rope } else { &self.rope_8x8 };
        let mut intermediate_BPD = Vec::new();
        for (layer, block) in self.blocks.iter().enumerate() {
            tokens_BTD = block.forward(tokens_BTD, rope);
            if intermediate.contains(&layer) {
                let [batch, tokens, _] = tokens_BTD.dims();
                let patches_BPD = tokens_BTD
                    .clone()
                    .slice([0..batch, PREFIX..tokens, 0..WIDTH]);
                intermediate_BPD.push(affine_free_norm(patches_BPD));
            }
        }
        Readout {
            native_BTD: profile_reader("norm forward", || self.output_norm.forward(tokens_BTD)),
            intermediate_BPD,
        }
    }
}
