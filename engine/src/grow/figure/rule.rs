//! The figure rule on the GPU: its training and the live grid. The rule's step runs
//! `kernels::cell`; `kernels::draws` draws the noise and the firing masks.
//!
//! The pyramid keeps its two grids as two tensors (`Cells`), rather than the reference's pixel-shuffled channels
//! 16–19; the values and the arithmetic are the same. Its coarse grid steps first, as a cell rule
//! on COARSE_SIDE cells; the fine rule then reads its own 64 perceptions and the new coarse state,
//! upsampled on the torus, as 80 inputs.
use super::{
    CELLS, CHANNELS, COARSE_CELLS, COARSE_SIDE, FIRE_RATE, FigureRequest, Layer, Method, OVERFLOW_WEIGHT, PATCHES, POOL, Plan, RuleKind,
    SIDE, Start, UpdateCount, damage_disc, learning_rate, mean_code_loss, overflow, picture, region_features, region_mean_codes,
    target_set::{SetLoss, TargetSet}, upsample_torus,
};
use crate::{
    profiling,
    encoder::{Dino, PREFIX},
    grow::{
        draws::{self, Stream},
        views,
    },
    kernels::{
        cell::{HIDDEN, PERCEPTIONS, linear, perceive},
        cell_step, frozen_linear,
    },
    objective::Calibration,
    optimizer::Adam,
};
use burn::tensor::{Device, Tensor, TensorData};
use serde::Serialize;

/// Cellular steps kept on the autodiff tape at once; longer rollouts are recomputed in chunks.
const CHUNK: usize = 8;

/// `cells` noise states of the start distribution, [1, cells, C].
fn noise(stream: Stream, cells: usize, device: &Device) -> Tensor<3> {
    crate::kernels::draws::noise(stream.key(), cells, CHANNELS, device)
}

/// 1 where a cell fires, [1, cells, 1].
fn fire_mask(stream: Stream, cells: usize, device: &Device) -> Tensor<3> {
    crate::kernels::draws::fire_mask(stream.key(), cells, FIRE_RATE, device)
}

/// One grid's start from its noise stream: noise everywhere, or zero outside the start's disc.
fn start_grid(stream: Stream, side: usize, start: Start, device: &Device) -> Tensor<3> {
    let noise_1NC = noise(stream, side * side, device);
    match start.mask(side) {
        None => noise_1NC,
        Some(kept) => noise_1NC * Tensor::<3>::from_data(TensorData::new(kept, [1, side * side, 1]), device),
    }
}

/// The state of B grids: the fine cells [1, B·H·W, C] and, for the pyramid, its coarse cells
/// [1, B·H·W/4, C]. Grids are consecutive in both.
#[derive(Clone)]
pub struct Cells {
    pub fine_1NC: Tensor<3>,
    pub coarse_1MC: Option<Tensor<3>>,
}

impl Cells {
    /// One grid's start: the fine grid from `fine`'s noise and, for the pyramid, the coarse grid
    /// from `coarse`'s, each masked by the start.
    fn start(rule: RuleKind, start: Start, fine: Stream, coarse: Stream, device: &Device) -> Self {
        Self {
            fine_1NC: start_grid(fine, SIDE, start, device),
            coarse_1MC: (rule == RuleKind::Pyramid).then(|| start_grid(coarse, COARSE_SIDE, start, device)),
        }
    }

    fn grids(&self) -> usize {
        self.fine_1NC.dims()[1] / CELLS
    }

    /// The fine tensor, then the coarse one if any.
    fn tensors(&self) -> Vec<Tensor<3>> {
        std::iter::once(self.fine_1NC.clone()).chain(self.coarse_1MC.clone()).collect()
    }

    fn map(&self, mut apply: impl FnMut(Tensor<3>) -> Tensor<3>) -> Self {
        Self { fine_1NC: apply(self.fine_1NC.clone()), coarse_1MC: self.coarse_1MC.clone().map(apply) }
    }

    /// Grid `slot` of B.
    fn grid(&self, slot: usize) -> Self {
        Self {
            fine_1NC: self.fine_1NC.clone().slice([0..1, slot * CELLS..(slot + 1) * CELLS, 0..CHANNELS]),
            coarse_1MC: self.coarse_1MC.clone().map(|coarse| coarse.slice([0..1, slot * COARSE_CELLS..(slot + 1) * COARSE_CELLS, 0..CHANNELS])),
        }
    }

    /// Grids side by side, in order.
    fn cat(grids: Vec<Self>) -> Self {
        let coarse: Option<Vec<Tensor<3>>> = grids.iter().map(|grid| grid.coarse_1MC.clone()).collect();
        Self {
            fine_1NC: Tensor::cat(grids.into_iter().map(|grid| grid.fine_1NC).collect(), 1),
            coarse_1MC: coarse.map(|coarse| Tensor::cat(coarse, 1)),
        }
    }

    /// The colour of each fine cell before the picture's offset, [1, B·H·W, 3]: the first three
    /// channels, plus the upsampled coarse colour for the pyramid (`PyramidRule.picture` in the reference).
    fn colour(&self) -> Tensor<3> {
        let fine_1N3 = self.fine_1NC.clone().narrow(2, 0, 3);
        match &self.coarse_1MC {
            None => fine_1N3,
            Some(coarse) => upsample_torus(coarse.clone().narrow(2, 0, 3), self.grids(), COARSE_SIDE) + fine_1N3,
        }
    }

    /// The largest |value| over both grids, [1].
    fn largest(&self) -> Tensor<1> {
        let largest: Vec<Tensor<1>> = self.tensors().into_iter().map(|state| state.abs().max().reshape([1])).collect();
        Tensor::cat(largest, 0).max().reshape([1])
    }
}

/// One step's firing: the fine cells [1, N, 1] and, for the pyramid, the coarse cells [1, M, 1].
#[derive(Clone)]
struct Fired {
    fine_1N1: Tensor<3>,
    coarse_1M1: Option<Tensor<3>>,
}

impl Fired {
    fn draw(rule: RuleKind, fine: Stream, coarse: Stream, grids: usize, device: &Device) -> Self {
        Self {
            fine_1N1: fire_mask(fine, grids * CELLS, device),
            coarse_1M1: (rule == RuleKind::Pyramid).then(|| fire_mask(coarse, grids * COARSE_CELLS, device)),
        }
    }
}

/// The parameter tensors of a rule in the material layout's order: for each cell rule, fc1.weight
/// [96, inputs], fc1.bias [96] and fc2.weight [16, 96]. The pyramid's coarse rule comes first.
fn shapes(rule: RuleKind) -> Vec<[usize; 4]> {
    let cell = |inputs: usize| [[1, 1, HIDDEN, inputs], [1, 1, 1, HIDDEN], [1, 1, CHANNELS, HIDDEN]];
    match rule {
        RuleKind::Cell => cell(PERCEPTIONS).to_vec(),
        RuleKind::Pyramid => [cell(PERCEPTIONS), cell(PERCEPTIONS + CHANNELS)].concat(),
    }
}

pub struct FigureRule {
    pub kind: RuleKind,
    pub parameters: Vec<Tensor<4>>,
}

impl FigureRule {
    /// Trainable parameters on the autodiff device.
    pub fn load(kind: RuleKind, values: &[f32], device: &Device) -> Result<Self, String> {
        Self::fixed(kind, values, device).map(|rule| Self {
            kind,
            parameters: rule.parameters.into_iter().map(|p| p.autodiff().require_grad()).collect(),
        })
    }

    /// Fixed parameters for forward-only growth, without gradient tracking.
    pub fn fixed(kind: RuleKind, values: &[f32], device: &Device) -> Result<Self, String> {
        if values.len() != kind.parameters() || values.iter().any(|value| !value.is_finite()) {
            return Err(format!("This figure rule needs {} finite float32 values", kind.parameters()));
        }
        let inner = device.clone().inner();
        let mut start = 0;
        let parameters = shapes(kind)
            .into_iter()
            .map(|shape| {
                let count = shape.iter().product::<usize>();
                start += count;
                Tensor::from_data(TensorData::new(values[start - count..start].to_vec(), shape), &inner)
            })
            .collect();
        Ok(Self { kind, parameters })
    }

    /// PyTorch's Conv2d defaults, U(−1/√fan_in, 1/√fan_in) for each fc1's weight and bias: 1/8 for
    /// a cell rule's 64 inputs, 1/√80 for the pyramid's fine rule. Each fc2 starts at zero, so the
    /// first rule does nothing. Value i draws index i of the INIT stream.
    pub fn randomly_initialized(kind: RuleKind, seed: u32, device: &Device) -> Self {
        let init = Stream::new(seed, draws::INIT);
        let mut values = vec![0.0; kind.parameters()];
        let fan_ins = match kind {
            RuleKind::Cell => vec![PERCEPTIONS],
            RuleKind::Pyramid => vec![PERCEPTIONS, PERCEPTIONS + CHANNELS],
        };
        let mut first = 0;
        for fan_in in fan_ins {
            // fc1's weight [96, fan_in] and its bias [96] are drawn; fc2 [16, 96] stays zero.
            let drawn = HIDDEN * fan_in + HIDDEN;
            let bound = (fan_in as f32).sqrt();
            for index in first..first + drawn {
                values[index] = (init.uniform(index as u32) * 2.0 - 1.0) / bound;
            }
            first += drawn + CHANNELS * HIDDEN;
        }
        Self::load(kind, &values, device).unwrap()
    }

    /// The same values without gradient tracking, for forward-only steps.
    fn frozen(&self) -> Self {
        Self {
            kind: self.kind,
            parameters: self.parameters.iter().map(|value| value.clone().inner()).collect(),
        }
    }

    /// The residual W2 relu(W1 p + b) of the cell rule whose parameters start at `first`.
    fn residual(&self, first: usize, inputs_1NI: Tensor<3>) -> Tensor<3> {
        let device = inputs_1NI.device();
        let inputs = inputs_1NI.dims()[2];
        let hidden_1NJ = linear(
            inputs_1NI,
            self.parameters[first].clone().reshape([HIDDEN, inputs]),
            self.parameters[first + 1].clone().reshape([HIDDEN]),
            true,
        );
        linear(
            hidden_1NJ,
            self.parameters[first + 2].clone().reshape([CHANNELS, HIDDEN]),
            Tensor::zeros([CHANNELS], &device),
            false,
        )
    }

    /// One stochastic step on the torus: x + mask · W2 relu(W1 perceive(x) + b). The pyramid steps
    /// its coarse grid first, then its fine grid with the upsampled new coarse state as inputs 64–79.
    fn step(&self, cells: Cells, fired: &Fired) -> Cells {
        let fine_1NC = cells.fine_1NC;
        match self.kind {
            RuleKind::Cell => Cells {
                fine_1NC: fine_1NC.clone() + self.residual(0, perceive(fine_1NC, SIDE)) * fired.fine_1N1.clone(),
                coarse_1MC: None,
            },
            RuleKind::Pyramid => {
                let coarse_1MC = cells.coarse_1MC.expect("the pyramid's coarse grid");
                let coarse_mask_1M1 = fired.coarse_1M1.clone().expect("the pyramid's coarse firing");
                let coarse_1MC = coarse_1MC.clone() + self.residual(0, perceive(coarse_1MC, COARSE_SIDE)) * coarse_mask_1M1;
                // One kernel for cat(perceive(fine), upsample_torus(coarse)), forward bit-exact (`kernels::pyramid`).
                let inputs_1NI = crate::kernels::pyramid::fine_input(fine_1NC.clone(), coarse_1MC.clone(), SIDE);
                Cells {
                    fine_1NC: fine_1NC + self.residual(3, inputs_1NI) * fired.fine_1N1.clone(),
                    coarse_1MC: Some(coarse_1MC),
                }
            }
        }
    }

    /// The same step as `step` without a tape, for frozen parameters: the cell rule runs as one
    /// fused dispatch (`kernels::cell_step`) that draws the firing mask of `fire` itself; the
    /// pyramid draws its masks and runs the unfused operations.
    fn step_frozen(&self, cells: Cells, fire: Stream, coarse_fire: Stream) -> Cells {
        match self.kind {
            RuleKind::Cell => Cells {
                fine_1NC: cell_step::step(
                    cells.fine_1NC,
                    self.parameters[0].clone().reshape([HIDDEN, PERCEPTIONS]),
                    self.parameters[1].clone().reshape([HIDDEN]),
                    self.parameters[2].clone().reshape([CHANNELS, HIDDEN]),
                    fire.key(),
                    FIRE_RATE,
                    SIDE,
                ),
                coarse_1MC: None,
            },
            RuleKind::Pyramid => {
                let grids = cells.grids();
                let fired = Fired::draw(self.kind, fire, coarse_fire, grids, &cells.fine_1NC.device());
                self.step(cells, &fired)
            }
        }
    }

    /// `steps` frozen steps from the per-step streams `fire.at(step)` and `coarse_fire.at(step)`.
    fn rollout_frozen(&self, mut cells: Cells, fire: Stream, coarse_fire: Stream, steps: std::ops::Range<u32>) -> Cells {
        for step in steps {
            cells = self.step_frozen(cells, fire.at(step), coarse_fire.at(step));
        }
        cells
    }

    /// Run without a tape; keep the state at the start of every chunk for recomputation.
    fn forward_chunks(&self, mut cells: Cells, fire: Stream, coarse_fire: Stream, steps: usize) -> (Cells, Vec<Cells>) {
        let frozen = self.frozen();
        let mut starts = Vec::with_capacity(steps.div_ceil(CHUNK));
        for first in (0..steps).step_by(CHUNK) {
            starts.push(cells.clone());
            cells = frozen.rollout_frozen(cells, fire, coarse_fire, first as u32..(first + CHUNK).min(steps) as u32);
        }
        (cells, starts)
    }

    /// The gradients of the rollout from its chunk starts, last chunk first: the cell rule
    /// through `kernels::cell_step::chunk_gradient` (one fused dispatch per step, the same
    /// reductions and order as the tape, so the same bits); the pyramid on Burn's tape.
    fn backward_chunks(
        &self,
        starts: Vec<Cells>,
        fire: Stream,
        coarse_fire: Stream,
        steps: usize,
        grids: usize,
        upstream: Cells,
    ) -> Result<Vec<Tensor<4>>, String> {
        let _ = (coarse_fire, grids);
        match self.kind {
            RuleKind::Cell => Ok(self.backward_chunks_fused(starts, fire, steps, upstream)),
            RuleKind::Pyramid => Ok(self.backward_chunks_fused_pyramid(starts, fire, coarse_fire, steps, upstream)),
        }
    }

    fn backward_chunks_fused_pyramid(&self, starts: Vec<Cells>, fire: Stream, coarse_fire: Stream, steps: usize, upstream: Cells) -> Vec<Tensor<4>> {
        let frozen = self.frozen();
        let shapes = shapes(self.kind);
        let mut accumulated: Vec<Tensor<4>> = self.parameters.iter().map(|p| p.clone().inner().zeros_like()).collect();
        let mut upstream_fine_1NC = upstream.fine_1NC;
        let mut upstream_coarse_1MC = upstream.coarse_1MC.expect("the pyramid's coarse gradient");
        for (index, start) in starts.into_iter().enumerate().rev() {
            let first = index * CHUNK;
            let range = first..(first + CHUNK).min(steps);
            let fine_keys: Vec<u32> = range.clone().map(|step| fire.at(step as u32).key()).collect();
            let coarse_keys: Vec<u32> = range.map(|step| coarse_fire.at(step as u32).key()).collect();
            let parameters: [Tensor<2>; 6] = std::array::from_fn(|i| {
                let shape = shapes[i];
                frozen.parameters[i].clone().reshape([shape[2], shape[3]])
            });
            let gradient = crate::kernels::pyramid::chunk_gradient(
                start.fine_1NC,
                start.coarse_1MC.expect("the pyramid's coarse start"),
                parameters,
                &fine_keys,
                &coarse_keys,
                FIRE_RATE,
                SIDE,
                upstream_fine_1NC,
                upstream_coarse_1MC,
            );
            upstream_fine_1NC = gradient.fine_1NC;
            upstream_coarse_1MC = gradient.coarse_1MC;
            for ((total, part), shape) in accumulated.iter_mut().zip(gradient.parameters).zip(&shapes) {
                *total = total.clone() + part.reshape(*shape);
            }
        }
        accumulated
    }

    fn backward_chunks_fused(&self, starts: Vec<Cells>, fire: Stream, steps: usize, upstream: Cells) -> Vec<Tensor<4>> {
        let frozen = self.frozen();
        let mut accumulated: Vec<Tensor<4>> = self.parameters.iter().map(|p| p.clone().inner().zeros_like()).collect();
        let mut upstream_1NC = upstream.fine_1NC;
        for (index, start) in starts.into_iter().enumerate().rev() {
            let first = index * CHUNK;
            let keys: Vec<u32> = (first..(first + CHUNK).min(steps)).map(|step| fire.at(step as u32).key()).collect();
            let gradient = cell_step::chunk_gradient(
                start.fine_1NC,
                frozen.parameters[0].clone().reshape([HIDDEN, PERCEPTIONS]),
                frozen.parameters[1].clone().reshape([HIDDEN]),
                frozen.parameters[2].clone().reshape([CHANNELS, HIDDEN]),
                &keys,
                FIRE_RATE,
                SIDE,
                upstream_1NC,
            );
            upstream_1NC = gradient.state_1NC;
            let parts = [
                gradient.fc1_JP.reshape([1, 1, HIDDEN, PERCEPTIONS]),
                gradient.bias_J.reshape([1, 1, 1, HIDDEN]),
                gradient.fc2_CJ.reshape([1, 1, CHANNELS, HIDDEN]),
            ];
            for (total, part) in accumulated.iter_mut().zip(parts) {
                *total = total.clone() + part;
            }
        }
        accumulated
    }

    pub async fn values(&self) -> Result<Vec<f32>, String> {
        let values = Tensor::<1>::cat(
            self.parameters.iter().map(|p| p.clone().inner().flatten(0, 3)).collect(),
            0,
        )
        .into_data_async()
        .await
        .map_err(|e| e.to_string())?
        .try_to_vec::<f32>()
        .map_err(|e| e.to_string())?;
        if values.iter().any(|value| !value.is_finite()) {
            return Err("The figure rule became non-finite".into());
        }
        Ok(values)
    }
}

/// Per-tensor gradient normalization, as in Growing NCA: g / (‖g‖ + 1e-8).
fn normalized(gradient: Tensor<4>) -> Tensor<4> {
    let norm = gradient
        .clone()
        .square()
        .sum_dim(3)
        .sum_dim(2)
        .sum_dim(1)
        .sum_dim(0)
        .sqrt();
    gradient / (norm + 1e-8)
}

/// Standard deviation of every value of the pictures [B, 3, H, W], as one value [1].
fn picture_contrast(pictures_BCHW: Tensor<4>) -> Tensor<1> {
    let mean = pictures_BCHW.clone().mean().reshape([1]);
    (pictures_BCHW.square().mean().reshape([1]) - mean.clone() * mean).clamp_min(0.0).sqrt()
}

/// One read DINO pass over the views: the native tokens [V, T, D] of the patches, their codes
/// [V, T, R] and the intermediate tokens of the request's blocks, each [V, T, D].
struct ViewReading {
    native_VTD: Tensor<3>,
    codes_VTR: Tensor<3>,
    intermediate_VTD: Vec<Tensor<3>>,
}

fn read_views(encoder: &Dino, calibration: &Calibration, frame_RD: &Tensor<2>, pictures_VCHW: Tensor<4>, blocks: &[usize]) -> ViewReading {
    let views = pictures_VCHW.dims()[0];
    let readout = encoder.readout(pictures_VCHW, blocks);
    let native_VTD = readout.native_BTD.slice([0..views, PREFIX..PREFIX + PATCHES, 0..768]);
    let codes_VTR = frozen_linear(calibration.tokens(native_VTD.clone()), frame_RD.clone());
    ViewReading { native_VTD, codes_VTR, intermediate_VTD: readout.intermediate_BPD }
}

/// The canvas features of each compared layer, [M, D] (`region_features`): the codes for
/// basis-group distribution, the final or an intermediate layer's tokens for a token method.
fn compared_features(request: &FigureRequest, reading: &ViewReading, blocks: &[usize]) -> Vec<Tensor<2>> {
    request.compared_layers().into_iter().map(|layer| match (request.method, layer) {
        (Method::BasisGroupDistribution, _) => region_features(reading.codes_VTR.clone(), request.start),
        (_, Layer::Final) => region_features(reading.native_VTD.clone(), request.start),
        (_, Layer::Block(block)) => {
            let position = blocks.iter().position(|&read| read == block).expect("every block layer is read");
            region_features(reading.intermediate_VTD[position].clone(), request.start)
        }
    }).collect()
}

/// A set method's loss on one displayed picture [1, 3, 128, 128]: the training's terms with the picture
/// in place of the eight views, so the scored patches of the start give M = 16 or 64 canvas tokens.
/// Decision 12 of the brief reads the final rule on the live grid at a ladder of ticks and keeps the
/// tick with the lowest value. One DINO pass at the method's layers and one readback: 22 to 25 ms
/// natively on an M1 Max (17 November 2026).
pub async fn own_loss(
    encoder: &Dino,
    calibration: &Calibration,
    frame_DR: &Tensor<2>,
    request: &FigureRequest,
    target: &TargetSet,
    picture_1CHW: Tensor<4>,
) -> Result<f32, String> {
    request.validate()?;
    target.serves(request)?;
    let blocks = request.intermediate_blocks();
    let reading = read_views(encoder, calibration, &frame_DR.clone().transpose(), picture_1CHW, &blocks);
    let loss = target.loss(compared_features(request, &reading, &blocks)).value;
    let values = loss.into_data_async().await.map_err(|e| e.to_string())?.try_to_vec::<f32>().map_err(|e| e.to_string())?;
    values.first().copied().filter(|value| value.is_finite()).ok_or_else(|| "The picture's loss is not finite".into())
}

/// One compared layer's terms after an update: its value and, for a distribution method, the
/// kernel means E k(x̂, x̂') (`kernelXx`) and E k(x̂, ŷ) (`kernelXy`) of `target_set`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerLoss {
    pub layer: Layer,
    pub value: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kernel_xx: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kernel_xy: Option<f32>,
}

/// One update's readings, read back from the device in one transfer (`FigureGradient::metrics`).
#[derive(Clone, Debug, PartialEq)]
pub struct FigureReadings {
    /// The method's loss plus 10 × overflow: what the update descends.
    pub loss: f32,
    /// mean_v ‖mean_{t∈P} c_vt − k‖² / m²; under the other methods a reading only.
    pub code_loss: f32,
    /// The method's own loss: the code loss, or a set method's mean over its layers.
    pub method_loss: f32,
    pub overflow: f32,
    pub state_max: f32,
    pub picture_contrast: f32,
    /// A set method's compared layers; empty for basis-group mean.
    pub layers: Vec<LayerLoss>,
    /// mean_{t∈P} c_vt for every view, [V × 3].
    pub mean_codes: Vec<f32>,
}

/// One update's terms on the device, before they are read back.
struct UpdateTerms {
    loss: Tensor<1>,
    code_loss: Tensor<1>,
    overflow: Tensor<1>,
    state_max: Tensor<1>,
    picture_contrast: Tensor<1>,
    set_loss: Option<SetLoss>,
    mean_codes_VR: Tensor<2>,
}

impl FigureReadings {
    /// The update's terms as one tensor, without gradient tracking, in `decode`'s order.
    fn gather(terms: UpdateTerms) -> Tensor<1> {
        let method_loss = terms.set_loss.as_ref().map_or(terms.code_loss.clone(), |set_loss| set_loss.value.clone());
        let mut values = vec![terms.loss, terms.code_loss, terms.overflow, terms.state_max, terms.picture_contrast, method_loss];
        for layer in terms.set_loss.iter().flat_map(|set_loss| &set_loss.layers) {
            values.push(layer.value.clone());
            values.extend(layer.kernel_means.iter().flatten().cloned());
        }
        values.push(terms.mean_codes_VR.flatten(0, 1));
        Tensor::cat(values.into_iter().map(|value| value.inner()).collect(), 0)
    }

    /// The values of `metrics` in their order: loss, code loss, overflow, largest |state|, picture
    /// contrast, the method's loss, then per compared layer its value (and its two kernel means for
    /// a distribution method), then the V × 3 mean codes.
    pub fn decode(values: &[f32], request: &FigureRequest) -> Self {
        let distribution = request.method.compares_distributions();
        let mut next = 6;
        let layers = request.compared_layers().into_iter().map(|layer| {
            let value = values[next];
            let (kernel_xx, kernel_xy) = if distribution { (Some(values[next + 1]), Some(values[next + 2])) } else { (None, None) };
            next += if distribution { 3 } else { 1 };
            LayerLoss { layer, value, kernel_xx, kernel_xy }
        }).collect();
        Self {
            loss: values[0],
            code_loss: values[1],
            overflow: values[2],
            state_max: values[3],
            picture_contrast: values[4],
            method_loss: values[5],
            layers,
            mean_codes: values[next..].to_vec(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigureUpdate {
    /// Completed optimizer updates, including this one.
    pub completed: u32,
    pub learning_rate: f64,
    pub method: Method,
    /// The method's loss plus 10 × overflow.
    pub loss: f32,
    /// The method's own loss (equal to `code_loss` for basis-group mean).
    pub method_loss: f32,
    /// mean_v ‖mean_{t∈P} c_vt − k‖² / m²; under the other methods a reading only.
    pub code_loss: f32,
    /// A set method's compared layers; empty for basis-group mean.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub layers: Vec<LayerLoss>,
    pub overflow: f32,
    pub state_max: f32,
    /// Standard deviation of the B training pictures over channels and pixels (`rgb_std` in
    /// the reference). Fresh noise is about 0.29. This diagnostic does not reliably predict
    /// whether a rule reaches the selection threshold, so it does not control training.
    pub picture_contrast: f32,
    /// mean_{t∈P} c_vt for every view, [V × 3].
    pub mean_codes: Vec<f32>,
    pub plan: Plan,
}

/// One update's normalized parameter gradients, before Adam. `grown` holds the B grown states;
/// `metrics` the readings in `FigureReadings::decode`'s order.
pub struct FigureGradient {
    pub normalized: Vec<Tensor<4>>,
    pub grown: Cells,
    pub metrics: Tensor<1>,
    pub plan: Plan,
}

pub struct FigureTraining {
    pub rule: FigureRule,
    pub request: FigureRequest,
    /// The set a set method compares with; None for basis-group mean.
    target: Option<TargetSet>,
    adam: Adam,
    /// Completed optimizer updates and the target. Adam keeps its own bias corrections.
    updates: UpdateCount,
    /// Entries stay unset until first sampled; an unsampled entry is its start.
    pool: Vec<Option<Cells>>,
    frame_RD: Tensor<2>,
    device: Device,
}

/// The request is valid and a set method has a set prepared for it.
fn checked(request: &FigureRequest, target: &Option<TargetSet>) -> Result<(), String> {
    request.validate()?;
    match target {
        Some(target) => target.serves(request),
        None if request.method.needs_set() => Err("A set method needs its prepared target set".into()),
        None => Ok(()),
    }
}

impl FigureTraining {
    /// `target` is the set a set method compares with (`TargetSet::prepare`); None for basis-group mean.
    pub fn new(request: FigureRequest, target: Option<TargetSet>, frame_DR: Tensor<2>, device: Device) -> Result<Self, String> {
        checked(&request, &target)?;
        let rule = FigureRule::randomly_initialized(request.rule, request.seed, &device);
        let adam = Adam::new(&rule.parameters);
        Ok(Self {
            rule,
            request,
            target,
            adam,
            updates: UpdateCount::default(),
            pool: vec![None; POOL],
            frame_RD: frame_DR.transpose(),
            device,
        })
    }

    /// A run continued from a saved definition (Train resume):
    /// its rule's values, a fresh Adam, a fresh pool from the request's start, and the update count
    /// from the file, so the plan, firing and learning rate go on from `from_update` with the
    /// request's seed. The request may name another reference patch or start than the file's.
    pub fn continued(
        request: FigureRequest,
        target: Option<TargetSet>,
        values: &[f32],
        from_update: u32,
        frame_DR: Tensor<2>,
        device: Device,
    ) -> Result<Self, String> {
        checked(&request, &target)?;
        let rule = FigureRule::load(request.rule, values, &device)?;
        let adam = Adam::new(&rule.parameters);
        Ok(Self {
            rule,
            request,
            target,
            adam,
            updates: UpdateCount::continued(from_update),
            pool: vec![None; POOL],
            frame_RD: frame_DR.transpose(),
            device,
        })
    }

    /// The optimizer's moments and bias corrections, to continue another run with them (the
    /// measurement of continued runs, engine/examples/grow_continue_check.rs).
    #[cfg(feature = "harness")]
    pub fn optimizer_state(&self) -> Vec<[Tensor<4>; 4]> {
        self.adam.state()
    }

    #[cfg(feature = "harness")]
    pub fn set_optimizer_state(&mut self, state: Vec<[Tensor<4>; 4]>) {
        self.adam.set_state(state);
    }

    /// The pool's states, to continue another run with them: with the optimizer's state too, a
    /// continued run must equal the uninterrupted one.
    #[cfg(feature = "harness")]
    pub fn pool_states(&self) -> Vec<Option<Cells>> {
        self.pool.clone()
    }

    #[cfg(feature = "harness")]
    pub fn set_pool_states(&mut self, pool: Vec<Option<Cells>>) {
        assert_eq!(pool.len(), POOL);
        self.pool = pool;
    }

    pub fn completed(&self) -> u32 {
        self.updates.completed
    }

    pub fn target(&self) -> u32 {
        self.updates.target
    }

    /// Train `updates` more past the current target: Resume after a run has ended.
    pub fn extend(&mut self, updates: u32) {
        self.updates.extend(updates);
    }

    /// A fresh start of the request's kind from the fine and coarse streams of `purpose` at `counter`.
    fn fresh(&self, fine: u32, coarse: u32, counter: u32) -> Cells {
        let FigureRequest { seed, rule, start, .. } = self.request;
        let streams = (Stream::new(seed, fine).at(counter), Stream::new(seed, coarse).at(counter));
        Cells::start(rule, start, streams.0, streams.1, &self.device.clone().inner())
    }

    fn pool_state(&mut self, entry: usize) -> Cells {
        if self.pool[entry].is_none() {
            self.pool[entry] = Some(self.fresh(draws::POOL, draws::COARSE_POOL, entry as u32));
        }
        self.pool[entry].clone().unwrap()
    }

    pub async fn update(&mut self, encoder: &Dino, calibration: &Calibration) -> Result<FigureUpdate, String> {
        let gradient = self.gradient(encoder, calibration)?;
        self.apply(gradient).await
    }

    /// Draw the next update, grow the sampled states and differentiate the loss. Nothing in the
    /// training changes until `apply`.
    pub fn gradient(&mut self, encoder: &Dino, calibration: &Calibration) -> Result<FigureGradient, String> {
        let update = self.updates.next()?;
        let plan = Plan::draw(self.request.seed, update, self.request.batch);
        let grids: Vec<Cells> = profiling::broad("pool sampling", || {
            let mut grids: Vec<Cells> = plan.entries.iter().map(|&entry| self.pool_state(entry)).collect();
            if plan.reset {
                grids[0] = self.fresh(draws::RESET, draws::COARSE_RESET, update);
            }
            grids
        });
        self.differentiate(encoder, calibration, Cells::cat(grids), plan, update)
    }

    /// Grow the sampled states by the plan with update `update`'s firing, read them and
    /// differentiate the loss with respect to the current rule.
    pub fn differentiate(
        &self,
        encoder: &Dino,
        calibration: &Calibration,
        initial: Cells,
        plan: Plan,
        update: u32,
    ) -> Result<FigureGradient, String> {
        let FigureRequest { seed, batch, code, median_norm, start, .. } = self.request.clone();
        let fine = Stream::new(seed, draws::TRAIN_FIRE).at(update);
        let coarse = Stream::new(seed, draws::COARSE_TRAIN_FIRE).at(update);
        let (grown, starts) = profiling::broad("rule rollout", || self.rule.forward_chunks(initial, fine, coarse, plan.steps));

        let leaf = grown.map(|state| state.autodiff().require_grad());
        let pictures_BCHW = profiling::broad("display rounding", || picture(leaf.colour(), batch));
        let views_VCHW = profiling::broad("transformed views", || {
            Tensor::cat(
                plan.views
                    .iter()
                    .enumerate()
                    .map(|(index, view)| {
                        let grid = index / 2;
                        let picture_1CHW = pictures_BCHW.clone().slice([grid..grid + 1, 0..3, 0..SIDE, 0..SIDE]);
                        views::sample(picture_1CHW, view.matrix(), view.shift)
                    })
                    .collect(),
                0,
            )
        });
        let blocks = self.request.intermediate_blocks();
        let reading = profiling::broad("reader forward", || read_views(encoder, calibration, &self.frame_RD, views_VCHW, &blocks));
        let (mean_codes_VR, code_loss, set_loss, excess, loss) = profiling::broad("objective", || {
            let mean_codes_VR = region_mean_codes(reading.codes_VTR.clone(), start);
            let code_loss = mean_code_loss(mean_codes_VR.clone(), code, median_norm);
            let set_loss = self.target.as_ref().map(|target| target.loss(compared_features(&self.request, &reading, &blocks)));
            let method_loss = set_loss.as_ref().map_or(code_loss.clone(), |set_loss| set_loss.value.clone());
            let excess = overflow(&leaf.tensors());
            let loss = method_loss + excess.clone() * OVERFLOW_WEIGHT;
            (mean_codes_VR, code_loss, set_loss, excess, loss)
        });
        let metrics = FigureReadings::gather(UpdateTerms {
            loss: loss.clone(),
            code_loss,
            overflow: excess,
            state_max: grown.largest(),
            picture_contrast: picture_contrast(pictures_BCHW.clone().inner()),
            set_loss,
            mean_codes_VR,
        });

        let mut derivatives = profiling::broad("reader, view and display backward", || loss.backward());
        let upstream = Cells {
            fine_1NC: leaf.fine_1NC.grad_remove(&mut derivatives).ok_or("Missing picture gradient")?,
            coarse_1MC: match &leaf.coarse_1MC {
                Some(coarse) => Some(coarse.grad_remove(&mut derivatives).ok_or("Missing coarse picture gradient")?),
                None => None,
            },
        };
        drop(derivatives);
        let gradients =
            profiling::broad("rule recompute and backward", || self.rule.backward_chunks(starts, fine, coarse, plan.steps, batch, upstream))?;
        Ok(FigureGradient {
            normalized: profiling::broad("gradient normalization", || gradients.into_iter().map(normalized).collect()),
            grown,
            metrics,
            plan,
        })
    }


    /// Adam on the normalized gradients at this update's rate; the grown states return to the pool.
    pub async fn apply(&mut self, gradient: FigureGradient) -> Result<FigureUpdate, String> {
        let FigureGradient { normalized, grown, metrics, plan } = gradient;
        self.adam.learning_rate = learning_rate(self.updates.completed);
        profiling::broad("Adam", || self.adam.update(&mut self.rule.parameters, normalized));
        self.updates.completed += 1;
        for (slot, &entry) in plan.entries.iter().enumerate() {
            self.pool[entry] = Some(grown.grid(slot));
        }
        let values = metrics
            .into_data_async()
            .await
            .map_err(|e| e.to_string())?
            .try_to_vec::<f32>()
            .map_err(|e| e.to_string())?;
        if values.iter().any(|value| !value.is_finite()) {
            return Err("Figure training became non-finite".into());
        }
        let readings = FigureReadings::decode(&values, &self.request);
        Ok(FigureUpdate {
            completed: self.updates.completed,
            learning_rate: self.adam.learning_rate,
            method: self.request.method,
            loss: readings.loss,
            method_loss: readings.method_loss,
            code_loss: readings.code_loss,
            layers: readings.layers,
            overflow: readings.overflow,
            state_max: readings.state_max,
            picture_contrast: readings.picture_contrast,
            mean_codes: readings.mean_codes,
            plan,
        })
    }
}

/// One 128×128 torus grid (with the pyramid's 64×64 coarse grid) grown forward with a fixed rule,
/// on the Keep replay contract: the state at tick 0 is `Stream::new(seed, NOISE)` noise
/// (COARSE_NOISE for the coarse grid), masked by the start; the step from tick t fires the cells of
/// `Stream::new(seed, FIRE).at(t)` (COARSE_FIRE). Its (seed, tick) therefore name a reproducible picture.
pub struct FigureGrid {
    cells: Cells,
    pub rule: RuleKind,
    pub start: Start,
    pub seed: u32,
    pub tick: u32,
    /// Brush stamps since tick 0; stamp k draws from `Stream::new(seed, DAMAGE).at(k)` (COARSE_DAMAGE).
    pub damages: u32,
}

impl FigureGrid {
    pub fn new(seed: u32, rule: RuleKind, start: Start, device: &Device) -> Self {
        let streams = (Stream::new(seed, draws::NOISE), Stream::new(seed, draws::COARSE_NOISE));
        Self {
            cells: Cells::start(rule, start, streams.0, streams.1, &device.clone().inner()),
            rule,
            start,
            seed,
            tick: 0,
            damages: 0,
        }
    }

    /// Apply one brush stamp now (`damage_disc`); the tick does not change. The pyramid stamps its
    /// coarse grid too, at half the centre and radius, with the same stamp count.
    pub fn damage(&mut self, x: f32, y: f32, radius: f32) {
        let stamp = |state_1NC: Tensor<3>, purpose: u32, side: usize, scale: f32| {
            let device = state_1NC.device();
            let key = Stream::new(self.seed, purpose).at(self.damages);
            let (weights, goals) = damage_disc(key, side, x * scale, y * scale, radius * scale);
            let weight_1N1 = Tensor::<3>::from_data(TensorData::new(weights, [1, side * side, 1]), &device);
            let goal_1NC = Tensor::<3>::from_data(TensorData::new(goals, [1, side * side, CHANNELS]), &device);
            state_1NC.clone() + (goal_1NC - state_1NC) * weight_1N1
        };
        self.cells = Cells {
            fine_1NC: stamp(self.cells.fine_1NC.clone(), draws::DAMAGE, SIDE, 1.0),
            coarse_1MC: self.cells.coarse_1MC.clone().map(|coarse| stamp(coarse, draws::COARSE_DAMAGE, COARSE_SIDE, 0.5)),
        };
        self.damages += 1;
    }

    /// `rule` holds fixed parameters (`FigureRule::fixed`) of this grid's rule kind.
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

    /// The patches a reading of this grid counts: all 64, or the central 4 × 4 for the seeded centre.
    pub fn patches(&self) -> &'static [usize] {
        self.start.patches()
    }

    /// The displayed byte levels 0–255, [1, 3, 128, 128].
    fn levels(&self) -> Tensor<4> {
        let rgb_1CHW = (self.cells.colour() + 0.5)
            .clamp(0.0, 1.0)
            .reshape([1, SIDE, SIDE, 3])
            .permute([0, 3, 1, 2]);
        (rgb_1CHW * 255.0).round()
    }

    /// The displayed 8-bit picture in [0, 1] on the autodiff device, as the encoder reads it.
    pub fn picture(&self) -> Tensor<4> {
        (self.levels() / 255.0).autodiff()
    }

    /// Opaque RGBA bytes of the displayed picture, row-major.
    pub async fn rgba(&self) -> Result<Vec<u8>, String> {
        let rgb_HWC = self.levels().permute([0, 2, 3, 1]).flatten::<1>(0, 3);
        let values = rgb_HWC
            .into_data_async()
            .await
            .map_err(|e| e.to_string())?
            .try_to_vec::<f32>()
            .map_err(|e| e.to_string())?;
        Ok(values
            .chunks_exact(3)
            .flat_map(|rgb| [rgb[0] as u8, rgb[1] as u8, rgb[2] as u8, 255])
            .collect())
    }

    /// The fine grid's state [1, 128², C], then the coarse grid's for the pyramid, flattened.
    pub async fn state(&self) -> Result<Vec<Vec<f32>>, String> {
        let mut states = Vec::new();
        for state in self.cells.tensors() {
            let values = state.flatten::<1>(0, 2).into_data_async().await.map_err(|e| e.to_string())?;
            states.push(values.try_to_vec::<f32>().map_err(|e| e.to_string())?);
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
        let values = total.into_data_async().await.map_err(|e| e.to_string())?;
        Ok(values.try_to_vec::<f32>().map_err(|e| e.to_string())?[0].is_finite())
    }
}
