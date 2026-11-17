//! The complete objective: code requests, appearance and rules, with painted fields
//! (recipe format 4).
//!
//! Axes: B views, T = 261 token slots, P measured slots or patch positions, D = 768
//! channels, R = 3 block rank, C/H/W image. Every term is computed per view; the
//! update averages views, a measurement reads view 0, the unshifted image.

use crate::{
    appearance::ReferenceCache,
    assets::{LoadError, Weights},
    curve::{CurveTable, DeviceCurve, SortedWindow, squared_integral},
    encoder::{PATCHES, PREFIX, Readout, WIDTH},
    ranking,
    image::GRID,
};
use burn::tensor::{Device, Int, Tensor, TensorData};
use serde::Deserialize;
use std::collections::BTreeMap;

/// Below this squared length a requested code has no direction; the loss would divide by it.
pub const MIN_CODE_NORM_SQUARED: f32 = 1e-12;
pub const CELLS: usize = PATCHES;
/// A painted strength is an integer percentage; 100 is full strength.
pub const FULL_STRENGTH: u8 = 100;
const RGB_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const RGB_STD: [f32; 3] = [0.229, 0.224, 0.225];

/// The active terms of a recipe, in canonical order. Disabled and zero-weight terms are
/// absent, and each term carries only the fields that determine it, so two equal specs
/// build identical terms. The worker compares specs to decide an Adam reset.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObjectiveSpec {
    pub requests: Vec<RequestSpec>,
    pub tv: Option<f32>,
    pub l2: Option<f32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestSpec {
    pub id: u32,
    pub respond: Option<RespondSpec>,
    pub look: Option<LookSpec>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondSpec {
    pub weight: f32,
    #[serde(flatten)]
    pub code: CodeSpec,
}

/// One block's requested code at a token role. A CLS or storage slot measures itself and
/// ignores `where`; a patch slot measures the painted cells of its Respond like field.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSpec {
    pub block: u32,
    /// The requested token's slot: 0 CLS, 1–4 storage, 5–260 patches.
    pub slot: u16,
    pub code: [f32; 3],
    #[serde(default)]
    pub target: TargetSpec,
    /// The Respond like field: 256 integer percentages, row-major. Null or all zeros for a
    /// CLS or storage slot, whose field is not used.
    #[serde(rename = "where")]
    pub where_: Option<Vec<u8>>,
}

/// Targets are already scaled by the recipe radius. Region membership is resolved before install.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TargetSpec {
    #[default]
    Point,
    Path { codes: [[f32; 3]; 2], anchors: [usize; 2] },
    Region { codes: Vec<[f32; 3]>, lambda: f32 },
}

/// Frozen target tensors. M is the number of region codes (at most 4096).
enum CodeTarget {
    Point,
    Path {
        codes_PR: Vec<[f32; 3]>,
        codes_1PR: Tensor<3>,
        inverse_norm_1P: Tensor<2>,
    },
    Region {
        codes_MR: Vec<[f32; 3]>,
        codes_11MR: Tensor<4>,
        inverse_norm_squared: f32,
        lambda: f32,
    },
}

fn squared_norm(code: &[f32; 3]) -> f32 {
    code.iter().map(|value| value * value).sum()
}

fn prepare_target(spec: &CodeSpec, slots: &[u16], device: &Device) -> Result<CodeTarget, String> {
    if matches!(spec.target, TargetSpec::Point) {
        return Ok(CodeTarget::Point);
    }
    if (spec.slot as usize) < PREFIX {
        return Err("paths and regions require a patch request".into());
    }
    match &spec.target {
        TargetSpec::Point => unreachable!(),
        TargetSpec::Path { codes, anchors: [a, b] } => {
            if a == b || *a >= CELLS || *b >= CELLS {
                return Err("a path needs two distinct anchor cells in 0–255".into());
            }
            let dx = (b % GRID) as f32 - (a % GRID) as f32;
            let dy = (b / GRID) as f32 - (a / GRID) as f32;
            let codes_PR: Vec<[f32; 3]> = slots.iter().map(|&slot| {
                let cell = slot as usize - PREFIX;
                let x = (cell % GRID) as f32 - (a % GRID) as f32;
                let y = (cell / GRID) as f32 - (a / GRID) as f32;
                let t = ((x * dx + y * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
                std::array::from_fn(|axis| (1.0 - t) * codes[0][axis] + t * codes[1][axis])
            }).collect();
            let norms_P: Vec<f32> = codes_PR.iter().map(squared_norm).collect();
            if norms_P.iter().any(|norm| !norm.is_finite() || *norm < MIN_CODE_NORM_SQUARED) {
                return Err("a path target has length below 0.000001 at a painted cell".into());
            }
            let points = slots.len();
            let codes_1PR = Tensor::from_data(TensorData::new(codes_PR.iter().flatten().copied().collect::<Vec<_>>(), [1, points, 3]), device);
            let inverse_norm_1P = masses_tensor(&norms_P.iter().map(|norm| 1.0 / norm).collect::<Vec<_>>(), device);
            Ok(CodeTarget::Path { codes_PR, codes_1PR, inverse_norm_1P })
        }
        TargetSpec::Region { codes, lambda } => {
            if codes.is_empty() || codes.len() > 4096 {
                return Err("a region needs 1–4096 target codes".into());
            }
            if !lambda.is_finite() || *lambda < 0.0 {
                return Err("region coverage weight must be non-negative".into());
            }
            let norm_squared = codes.iter().map(squared_norm).sum::<f32>() / codes.len() as f32;
            if !norm_squared.is_finite() || norm_squared < MIN_CODE_NORM_SQUARED {
                return Err("region RMS code length is below 0.000001".into());
            }
            let codes_11MR = Tensor::from_data(TensorData::new(codes.iter().flatten().copied().collect::<Vec<_>>(), [1, 1, codes.len(), 3]), device);
            Ok(CodeTarget::Region { codes_MR: codes.clone(), codes_11MR, inverse_norm_squared: 1.0 / norm_squared, lambda: *lambda })
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookSpec {
    pub weight: f32,
    /// The Look like field: 256 integer percentages, row-major.
    #[serde(rename = "where")]
    pub where_: Vec<u8>,
    pub references: Vec<ReferenceSpec>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceSpec {
    pub image_id: u64,
    /// 256 cells of the reference's source window.
    pub source: Vec<bool>,
}

/// A loss-free code readout for one request, measured whether or not its loss is active.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSpec {
    pub request_id: u32,
    #[serde(flatten)]
    pub code: CodeSpec,
}

/// Shared by every block: subtract one mean, multiply by one positive scale.
pub struct Calibration {
    mean_D: Tensor<1>,
    scale: f32,
}

impl Calibration {
    /// The calibration multiplier: the dictionary's own (2.8026159 for pass-003).
    pub fn scale(&self) -> f32 {
        self.scale
    }
    /// Calibrated native tokens, before projection into any dictionary block.
    pub fn tokens(&self, native_BTD: Tensor<3>) -> Tensor<3> {
        (native_BTD - self.mean_D.clone().reshape([1,1,WIDTH])) * self.scale
    }
    pub fn load(bytes: &[u8], device: &Device) -> Result<Self, LoadError> {
        let weights = Weights::new(bytes, device)?;
        let scale = weights.values("scale", [1])?[0];
        if scale <= 0.0 {
            return Err(LoadError::Contract("Calibration scale must be positive".into()));
        }
        Ok(Self {
            mean_D: weights.tensor("mean", [WIDTH])?,
            scale,
        })
    }

    #[cfg(test)]
    pub fn new(mean_D: Tensor<1>, scale: f32) -> Self {
        Self { mean_D, scale }
    }
}

/// Load one `blocks/<block>.safetensors` file: a single `frame` [D, R].
pub fn load_frame(bytes: &[u8], device: &Device) -> Result<Tensor<2>, LoadError> {
    Weights::new(bytes, device)?.tensor("frame", [WIDTH, 3])
}

/// A painted field, prepared once per objective. Cell c has strength s_c = W_c / 100. The
/// field measures the cells with s_c > 0; they share the term by mass p_c = s_c / Σ s, and
/// the field pulls with its peak max s_c. An all-100 field has equal masses and
/// peak 1.
pub struct Field {
    /// The painted cells, row-major.
    pub cells: Vec<usize>,
    /// Each painted cell's mass; they sum to 1.
    pub masses: Vec<f32>,
    pub peak: f32,
}

/// The field of 256 percentages; empty when nothing is painted.
pub fn field(percentages: &[u8]) -> Result<Field, String> {
    if percentages.len() != CELLS {
        return Err("a field must have 256 cells".into());
    }
    if let Some(bad) = percentages.iter().find(|&&strength| strength > FULL_STRENGTH) {
        return Err(format!("a painted strength is 0 to 100, not {bad}"));
    }
    let cells: Vec<usize> = (0..CELLS).filter(|&cell| percentages[cell] > 0).collect();
    let total: f64 = cells.iter().map(|&cell| percentages[cell] as f64).sum();
    let masses = cells.iter().map(|&cell| (percentages[cell] as f64 / total) as f32).collect();
    let peak = cells.iter().map(|&cell| percentages[cell]).max().unwrap_or(0) as f32 / FULL_STRENGTH as f32;
    Ok(Field { cells, masses, peak })
}

/// What a code readout measures: its slots with their masses and the field's peak. A CLS or
/// storage request measures its own slot with mass and peak 1 and ignores its field; a patch
/// request measures the painted cells of its Respond like field.
struct Measured {
    slots: Vec<u16>,
    masses: Vec<f32>,
    peak: f32,
}

fn measured(spec: &CodeSpec) -> Result<Measured, String> {
    let slot = spec.slot as usize;
    if slot < PREFIX {
        return Ok(Measured { slots: vec![spec.slot], masses: vec![1.0], peak: 1.0 });
    }
    if slot >= PREFIX + PATCHES {
        return Err(format!("token slot {slot} is outside the 261 slots"));
    }
    let where_ = spec.where_.as_deref().ok_or("a patch request needs a Respond like field")?;
    let field = field(where_)?;
    Ok(Measured {
        slots: field.cells.iter().map(|&cell| (PREFIX + cell) as u16).collect(),
        masses: field.masses,
        peak: field.peak,
    })
}

fn index_tensor(values: impl IntoIterator<Item = usize>, device: &Device) -> Tensor<1, Int> {
    let values: Vec<i32> = values.into_iter().map(|value| value as i32).collect();
    let count = values.len();
    Tensor::from_data(TensorData::new(values, [count]), device)
}

/// Masses as a [1, P] row on the device.
fn masses_tensor(masses: &[f32], device: &Device) -> Tensor<2> {
    Tensor::from_data(TensorData::new(masses.to_vec(), [1, masses.len()]), device)
}

/// Calibrated gain-free codes of one block at selected slots: ((x − mean) × scale) · frame.
pub struct CodeReadout {
    pub request_id: u32,
    pub slots: Vec<u16>,
    pub code: [f32; 3],
    target: CodeTarget,
    slots_P: Tensor<1, Int>,
    /// The block's 768 × 3 frame, transposed: R = 3 code axes.
    frame_11RD: Tensor<4>,
}

impl CodeReadout {
    /// Squared distances and their normalizers in view 0. Readback already holds P codes.
    /// The region distance excludes coverage: it is distance to the nearest target.
    pub fn errors(&self, codes_PR: &[f32]) -> (Vec<f32>, Vec<f32>) {
        let distance = |code: &[f32], target: &[f32; 3]| code.iter().zip(target).map(|(z, t)| (z - t).powi(2)).sum::<f32>();
        let mut errors_P = Vec::with_capacity(self.slots.len());
        let mut normalizers_P = Vec::with_capacity(self.slots.len());
        for (point, code) in codes_PR.chunks_exact(3).enumerate() {
            let (error, norm) = match &self.target {
                CodeTarget::Point => (distance(code, &self.code), squared_norm(&self.code)),
                CodeTarget::Path { codes_PR, .. } => (distance(code, &codes_PR[point]), squared_norm(&codes_PR[point])),
                CodeTarget::Region { codes_MR, inverse_norm_squared, .. } => (
                    codes_MR.iter().map(|target| distance(code, target)).fold(f32::INFINITY, f32::min),
                    1.0 / inverse_norm_squared,
                ),
            };
            errors_P.push(error);
            normalizers_P.push(norm);
        }
        (errors_P, normalizers_P)
    }

    pub fn codes(&self, native_BTD: Tensor<3>, calibration: &Calibration) -> Tensor<3> {
        let selected_BPD = native_BTD.select(1, self.slots_P.clone());
        let [views, points, _] = selected_BPD.dims();
        let centered_BP1D = ((selected_BPD - calibration.mean_D.clone().reshape([1, 1, WIDTH])) * calibration.scale)
            .reshape([views, points, 1, WIDTH]);
        // A product and a sum over D, not `matmul`: on WebGPU without autotune, Burn's matmul
        // cost about 12 ms per call even for one slot (Chrome, M1 Max).
        (centered_BP1D * self.frame_11RD.clone()).sum_dim(3).reshape([views, points, 3])
    }
}

struct CodeTerm {
    readout: CodeReadout,
    /// 1 / ‖c‖².
    inverse_norm_squared: f32,
    /// The measured slots' masses, [1, P].
    masses_1P: Tensor<2>,
    peak: f32,
}

/// The prepared curves of one Look term, for the qualification fixtures (harness feature).
#[cfg(feature = "harness")]
pub struct LookFixtures {
    /// ∫₀¹ Q̄² per layer and channel, [L, D].
    pub squared_LD: Vec<f32>,
    /// Per reference: its window's token count M and F at each segment start, [L, M + 1, D].
    pub prefixes: Vec<(usize, Vec<f32>)>,
}

struct LookTerm {
    positions_P: Tensor<1, Int>,
    /// The painted cells' masses, [1, P] for the intervals and [1, P, 1] for the loss.
    masses_1P: Tensor<2>,
    masses_1P1: Tensor<3>,
    peak: f32,
    /// One curve per reference image, equally weighted.
    curves: Vec<DeviceCurve>,
    /// ∫₀¹ Q̄² per layer and channel, [L, D]: the constant part of the reported loss.
    squared_integral_LD: Tensor<2>,
    #[cfg(feature = "harness")]
    fixtures: LookFixtures,
}

enum Kind {
    Code(Box<CodeTerm>),
    Look(Box<LookTerm>),
    TotalVariation,
    ImageL2,
}

struct Term {
    id: String,
    weight: f32,
    kind: Kind,
}

/// One prepared objective. Built completely before it replaces the previous one.
#[derive(Default)]
pub struct Objective {
    terms: Vec<Term>,
}

/// Each Look term's reference means per cell: per term, per layer, [B, P, D]. The mean of
/// the term's curve over the mass interval that the cell's sorted value occupies; detached.
pub struct Assigned(Vec<Vec<Tensor<3>>>);

impl Objective {
    pub fn build(
        spec: &ObjectiveSpec,
        frames: &BTreeMap<u32, Tensor<2>>,
        references: &mut ReferenceCache,
        device: &Device,
    ) -> Result<Self, String> {
        let mut terms = Vec::new();
        for request in &spec.requests {
            if let Some(respond) = &request.respond {
                let id = format!("request:{}:respond", request.id);
                let code = code_term(request.id, &respond.code, frames, device).map_err(|error| format!("{id}: {error}"))?;
                terms.push(Term { weight: positive(&id, respond.weight)?, id, kind: Kind::Code(Box::new(code)) });
            }
            if let Some(look) = &request.look {
                let id = format!("request:{}:look", request.id);
                let field = field(&look.where_).map_err(|error| format!("{id}: {error}"))?;
                if field.cells.is_empty() {
                    return Err(format!("{id}: Look like needs at least one cell in its area"));
                }
                terms.push(look_term(id, look, field, references, device)?);
            }
        }
        if let Some(weight) = spec.tv {
            terms.push(Term { weight: positive("rules:tv", weight)?, id: "rules:tv".into(), kind: Kind::TotalVariation });
        }
        if let Some(weight) = spec.l2 {
            terms.push(Term { weight: positive("rules:l2", weight)?, id: "rules:l2".into(), kind: Kind::ImageL2 });
        }
        Ok(Self { terms })
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty()
    }

    pub fn ids(&self) -> Vec<String> {
        self.terms.iter().map(|term| term.id.clone()).collect()
    }

    pub fn weights(&self) -> Vec<f32> {
        self.terms.iter().map(|term| term.weight).collect()
    }

    /// Each Look term's prepared curves, in term order.
    #[cfg(feature = "harness")]
    pub fn look_fixtures(&self) -> Vec<&LookFixtures> {
        self.terms
            .iter()
            .filter_map(|term| match &term.kind {
                Kind::Look(look) => Some(&look.fixtures),
                _ => None,
            })
            .collect()
    }

    pub fn needs_appearance(&self) -> bool {
        self.terms.iter().any(|term| matches!(term.kind, Kind::Look(_)))
    }

    /// For every Look term, the reference mean that each painted cell's value is measured
    /// against, on the GPU and without gradient tracking. `appearance_BPD` has one readout
    /// per layer in `APPEARANCE_LAYERS`, [B, T, D] over all patches; it is empty when no Look
    /// term is active.
    ///
    /// Per layer, view and channel the painted cells are sorted by value and occupy mass
    /// intervals [A_i, B_i) in that order (`ranking::mass_intervals`); the cell's mean is
    /// (F(B_i) − F(A_i)) / p_c with F the mean of the references' prefix integrals.
    pub fn assign(&self, appearance_BPD: &[Tensor<3>]) -> Assigned {
        let assigned = self
            .terms
            .iter()
            .filter_map(|term| match &term.kind {
                Kind::Look(look) => Some(look),
                _ => None,
            })
            .map(|look| {
                let positions_P = look.positions_P.clone().inner();
                let generated_LBPD = Tensor::stack::<4>(
                    appearance_BPD
                        .iter()
                        .map(|features_BTD| features_BTD.clone().inner().select(1, positions_P.clone()))
                        .collect(),
                    0,
                );
                let [layers, views, points, _] = generated_LBPD.dims();
                // One row per layer, view and channel: N = L·B·D rows of P values.
                let rows = layers * views * WIDTH;
                let generated_NP = generated_LBPD.swap_dims(2, 3).reshape([rows, points]);
                let masses_NP = look.masses_1P.clone().inner().expand([rows, points]);
                let intervals = ranking::mass_intervals(generated_NP, masses_NP.clone());
                let mut area_NP = intervals.upper_NP.zeros_like();
                for curve in &look.curves {
                    area_NP = area_NP + curve.prefix_integral(intervals.upper_NP.clone(), views)
                        - curve.prefix_integral(intervals.lower_NP.clone(), views);
                }
                let area_NP = area_NP / look.curves.len() as f32;
                let mean_NP = ranking::by_cell(intervals.order_NP, area_NP) / masses_NP;
                let mean_LBPD = mean_NP.reshape([layers, views, WIDTH, points]).swap_dims(2, 3);
                (0..layers)
                    .map(|layer| {
                        mean_LBPD
                            .clone()
                            .slice([layer..layer + 1, 0..views, 0..points, 0..WIDTH])
                            .reshape([views, points, WIDTH])
                            .autodiff()
                    })
                    .collect()
            })
            .collect();
        Assigned(assigned)
    }

    /// Every term's raw value in each view, [N terms, B views], over each term's own field.
    pub fn raws(&self, views_BCHW: &Tensor<4>, readout: &Readout, assigned: &Assigned, calibration: &Calibration) -> Tensor<2> {
        let mut looks = assigned.0.iter();
        let rows: Vec<Tensor<2>> = self
            .terms
            .iter()
            .map(|term| {
                let raw_B1 = match &term.kind {
                    Kind::Code(code) => code_raw(code, &readout.native_BTD, calibration),
                    Kind::Look(look) => look_raw(look, &readout.intermediate_BPD, looks.next().expect("one assignment per Look term")),
                    Kind::TotalVariation => total_variation(views_BCHW.clone()),
                    Kind::ImageL2 => image_l2(views_BCHW.clone()),
                };
                raw_B1.transpose()
            })
            .collect();
        Tensor::cat(rows, 0)
    }

    /// Σ_terms weight × mean over views of raw.
    pub fn total(&self, raws_NB: Tensor<2>) -> Tensor<1> {
        let device = raws_NB.device();
        let weights = self.weights();
        let count = weights.len();
        let weights_N1 = Tensor::<2>::from_data(TensorData::new(weights, [count, 1]), &device);
        (raws_NB.mean_dim(1) * weights_N1).sum()
    }
}

fn positive(id: &str, weight: f32) -> Result<f32, String> {
    if weight.is_finite() && weight > 0.0 {
        Ok(weight)
    } else {
        Err(format!("{id}: an active term needs a finite positive weight"))
    }
}

fn code_readout(
    request_id: u32,
    spec: &CodeSpec,
    slots: Vec<u16>,
    frames: &BTreeMap<u32, Tensor<2>>,
    device: &Device,
) -> Result<CodeReadout, String> {
    let frame_DR = frames.get(&spec.block).ok_or_else(|| format!("block {} is not loaded", spec.block))?.clone();
    Ok(CodeReadout {
        request_id,
        target: prepare_target(spec, &slots, device)?,
        slots_P: index_tensor(slots.iter().map(|&slot| slot as usize), device),
        slots,
        code: spec.code,
        frame_11RD: frame_DR.transpose().reshape([1, 1, 3, WIDTH]),
    })
}

fn code_term(request_id: u32, spec: &CodeSpec, frames: &BTreeMap<u32, Tensor<2>>, device: &Device) -> Result<CodeTerm, String> {
    let code_norm_squared: f32 = spec.code.iter().map(|c| c * c).sum();
    if matches!(spec.target, TargetSpec::Point) && (!code_norm_squared.is_finite() || code_norm_squared <= MIN_CODE_NORM_SQUARED) {
        return Err("requested code has no direction".into());
    }
    let measured = measured(spec)?;
    if measured.slots.is_empty() {
        return Err("Respond like needs at least one cell in its area".into());
    }
    Ok(CodeTerm {
        readout: code_readout(request_id, spec, measured.slots, frames, device)?,
        inverse_norm_squared: 1.0 / code_norm_squared,
        masses_1P: masses_tensor(&measured.masses, device),
        peak: measured.peak,
    })
}

fn look_term(
    id: String,
    look: &LookSpec,
    field: Field,
    references: &mut ReferenceCache,
    device: &Device,
) -> Result<Term, String> {
    if look.references.is_empty() {
        return Err(format!("{id}: Look like needs at least one reference"));
    }
    let windows = look
        .references
        .iter()
        .map(|reference| {
            if reference.source.len() != CELLS {
                return Err(format!("{id}: a source window must have 256 cells"));
            }
            let window: Vec<usize> = (0..CELLS).filter(|&cell| reference.source[cell]).collect();
            if window.is_empty() {
                return Err(format!("{id}: a reference needs a non-empty source window"));
            }
            Ok(window)
        })
        .collect::<Result<Vec<_>, String>>()?;
    for reference in &look.references {
        if !references.contains(reference.image_id) {
            return Err(format!("{id}: reference image {} is not encoded", reference.image_id));
        }
    }
    let sorted: Vec<SortedWindow> = look
        .references
        .iter()
        .zip(&windows)
        .map(|(reference, window)| {
            let readout_LTD = references.get(reference.image_id).expect("checked above");
            SortedWindow::new(&readout_LTD, window)
        })
        .collect();
    let tables: Vec<CurveTable> = sorted.iter().map(CurveTable::new).collect();
    let squared_LD = squared_integral(&sorted);
    let points = field.cells.len();
    Ok(Term {
        weight: positive(&id, look.weight)?,
        id,
        kind: Kind::Look(Box::new(LookTerm {
            positions_P: index_tensor(field.cells, device),
            masses_1P: masses_tensor(&field.masses, device),
            masses_1P1: Tensor::from_data(TensorData::new(field.masses, [1, points, 1]), device),
            peak: field.peak,
            curves: tables.iter().map(|table| DeviceCurve::new(table, device)).collect(),
            squared_integral_LD: Tensor::from_data(TensorData::new(squared_LD.clone(), [crate::appearance::LAYERS, WIDTH]), device),
            #[cfg(feature = "harness")]
            fixtures: LookFixtures {
                squared_LD,
                prefixes: tables.iter().map(|table| (table.tokens, table.prefixes_LKD.clone())).collect(),
            },
        })),
    })
}

/// Mass-weighted sum over the measured slots of ‖z_vp − c‖², times the peak, divided by
/// ‖c‖², for each view. With equal masses and peak 1 it is the mean over the slots.
fn code_raw(term: &CodeTerm, native_BTD: &Tensor<3>, calibration: &Calibration) -> Tensor<2> {
    let codes_BPR = term.readout.codes(native_BTD.clone(), calibration);
    let [views, points, _] = codes_BPR.dims();
    match &term.readout.target {
        CodeTarget::Point => {
            // Keep the original point operations and their order.
            let code_11R = Tensor::<1>::from_data(TensorData::new(term.readout.code.to_vec(), [3]), &codes_BPR.device()).reshape([1, 1, 3]);
            let squared_BP = (codes_BPR - code_11R).square().sum_dim(2).reshape([views, points]);
            (squared_BP * term.masses_1P.clone()).sum_dim(1) * (term.peak * term.inverse_norm_squared)
        }
        CodeTarget::Path { codes_1PR, inverse_norm_1P, .. } => {
            let squared_BP = (codes_BPR - codes_1PR.clone()).square().sum_dim(2).reshape([views, points]);
            (squared_BP * inverse_norm_1P.clone() * term.masses_1P.clone()).sum_dim(1) * term.peak
        }
        CodeTarget::Region { codes_MR, codes_11MR, inverse_norm_squared, lambda } => {
            let targets = codes_MR.len();
            let differences_BPMR = codes_BPR.reshape([views, points, 1, 3]) - codes_11MR.clone();
            let squared_BPM = differences_BPMR.square().sum_dim(3).reshape([views, points, targets]);
            let nearest_BP = squared_BPM.clone().min_dim(2).reshape([views, points]);
            let attraction_B1 = (nearest_BP * term.masses_1P.clone()).sum_dim(1);
            let coverage_B1 = squared_BPM.min_dim(1).mean_dim(2).reshape([views, 1]);
            (attraction_B1 + coverage_B1 * *lambda) * (term.peak * *inverse_norm_squared)
        }
    }
}

/// The squared distribution distance per channel, averaged over the channels and the four
/// layers, times the peak: Σ_c p_c (x_c − m_c)² + Σ_c p_c v_c, where m_c and v_c are the
/// reference curve's mean and variance over the cell's mass interval. The spread term
/// Σ_c p_c v_c = ∫Q̄² − Σ_c p_c m_c² has no gradient; it keeps the reported loss the integral.
fn look_raw(term: &LookTerm, appearance_BPD: &[Tensor<3>], means: &[Tensor<3>]) -> Tensor<2> {
    let layers: Vec<Tensor<2>> = appearance_BPD
        .iter()
        .zip(means)
        .enumerate()
        .map(|(layer, (features_BTD, mean_BPD))| {
            let views = mean_BPD.dims()[0];
            let selected_BPD = features_BTD.clone().select(1, term.positions_P.clone());
            // Two reductions, positions then channels: Burn's default reduction runs one GPU
            // thread per output, so one mean over P·D values per view would run on B threads.
            let weighted_BD = ((selected_BPD - mean_BPD.clone()).square() * term.masses_1P1.clone())
                .sum_dim(1)
                .reshape([views, WIDTH]);
            let squared_1D = term.squared_integral_LD.clone().slice([layer..layer + 1, 0..WIDTH]);
            let spread_BD = squared_1D.expand([views, WIDTH])
                - (mean_BPD.clone().square() * term.masses_1P1.clone()).sum_dim(1).reshape([views, WIDTH]);
            (weighted_BD + spread_BD).mean_dim(1)
        })
        .collect();
    Tensor::cat(layers, 1).mean_dim(1) * term.peak
}

fn normalized_rgb(views_BCHW: Tensor<4>) -> Tensor<4> {
    let device = views_BCHW.device();
    let mean_1C11 = Tensor::<1>::from_floats(RGB_MEAN, &device).reshape([1, 3, 1, 1]);
    let std_1C11 = Tensor::<1>::from_floats(RGB_STD, &device).reshape([1, 3, 1, 1]);
    (views_BCHW - mean_1C11) / std_1C11
}

/// Euclidean norm of each view's values, [B, 1].
fn view_norm(values_BCHW: Tensor<4>) -> Tensor<2> {
    let views = values_BCHW.dims()[0];
    // One axis at a time: Burn's default reduction runs one GPU thread per output.
    values_BCHW.square().sum_dim(3).sum_dim(2).sum_dim(1).reshape([views, 1]).sqrt()
}

/// Four Euclidean norms of adjacent normalized differences, summed.
fn total_variation(views_BCHW: Tensor<4>) -> Tensor<2> {
    let normalized_BCHW = normalized_rgb(views_BCHW);
    let [views, channels, height, width] = normalized_BCHW.dims();
    let window = |rows: std::ops::Range<usize>, columns: std::ops::Range<usize>| {
        normalized_BCHW.clone().slice([0..views, 0..channels, rows, columns])
    };
    let (h, w) = (height, width);
    let horizontal = window(0..h, 0..w - 1) - window(0..h, 1..w);
    let vertical = window(0..h - 1, 0..w) - window(1..h, 0..w);
    let rising = window(1..h, 0..w - 1) - window(0..h - 1, 1..w);
    let falling = window(0..h - 1, 0..w - 1) - window(1..h, 1..w);
    view_norm(horizontal) + view_norm(vertical) + view_norm(rising) + view_norm(falling)
}

/// Euclidean norm of the normalized RGB view.
fn image_l2(views_BCHW: Tensor<4>) -> Tensor<2> {
    view_norm(normalized_rgb(views_BCHW))
}

/// Loss-free code readouts, one per request with a measurable slot.
#[derive(Default)]
pub struct Probes(pub Vec<CodeReadout>);

impl Probes {
    pub fn build(specs: &[ProbeSpec], frames: &BTreeMap<u32, Tensor<2>>, device: &Device) -> Result<Self, String> {
        let mut probes = Vec::new();
        for spec in specs {
            let slots = measured(&spec.code).map_err(|error| format!("request {}: {error}", spec.request_id))?.slots;
            if slots.is_empty() {
                continue; // A patch request with an empty Respond like field has nothing to measure.
            }
            probes.push(code_readout(spec.request_id, &spec.code, slots, frames, device)?);
        }
        Ok(Self(probes))
    }

    /// Every probe's codes in view 0, concatenated: [Σ P, R].
    pub fn codes(&self, native_BTD: &Tensor<3>, calibration: &Calibration) -> Option<Tensor<2>> {
        if self.0.is_empty() {
            return None;
        }
        let [_, tokens, width] = native_BTD.dims();
        let first_1TD = native_BTD.clone().slice([0..1, 0..tokens, 0..width]);
        let codes: Vec<Tensor<2>> = self
            .0
            .iter()
            .map(|probe| {
                let points = probe.slots.len();
                probe.codes(first_1TD.clone(), calibration).reshape([points, 3])
            })
            .collect();
        Some(Tensor::cat(codes, 0))
    }
}

#[cfg(all(test, feature = "cpu"))]
mod tests {
    use super::*;
    use crate::appearance::{LAYERS, READOUT_VALUES};
    use crate::encoder::TOKENS;

    fn identity_frame(device: &Device) -> Tensor<2> {
        let mut basis = vec![0f32; WIDTH * 3];
        for coordinate in 0..3 {
            basis[coordinate * 3 + coordinate] = 1.0;
        }
        Tensor::from_data(TensorData::new(basis, [WIDTH, 3]), device)
    }

    fn readout_with(values: &[(usize, f32)], device: &Device) -> Readout {
        let mut tokens = vec![0f32; TOKENS * WIDTH];
        for &(slot, value) in values {
            tokens[slot * WIDTH] = value;
        }
        Readout {
            native_BTD: Tensor::from_data(TensorData::new(tokens, [1, TOKENS, WIDTH]), device),
            intermediate_BPD: Vec::new(),
        }
    }

    fn raw_values(objective: &Objective, readout: &Readout, device: &Device) -> Vec<f32> {
        let calibration = Calibration::new(Tensor::zeros([WIDTH], device), 1.0);
        let views = Tensor::zeros([1, 3, 256, 256], device);
        let assigned = objective.assign(&readout.intermediate_BPD);
        objective
            .raws(&views, readout, &assigned, &calibration)
            .into_data()
            .try_to_vec::<f32>()
            .unwrap()
    }

    fn request(slot: u16, where_: Vec<u8>) -> RequestSpec {
        let code = CodeSpec { block: 0, slot, code: [1.0, 0.0, 0.0], target: TargetSpec::Point, where_: Some(where_) };
        RequestSpec { id: 1, respond: Some(RespondSpec { weight: 0.3, code }), look: None }
    }

    /// A field with the given strengths at the given cells, 0 elsewhere.
    fn painted(strengths: &[(usize, u8)]) -> Vec<u8> {
        let mut field = vec![0; CELLS];
        for &(cell, strength) in strengths {
            field[cell] = strength;
        }
        field
    }

    fn area(cells: &[usize]) -> Vec<u8> {
        painted(&cells.iter().map(|&cell| (cell, FULL_STRENGTH)).collect::<Vec<_>>())
    }

    #[test]
    fn path_uses_projected_targets_and_each_targets_own_norm() {
        let device = Device::flex().autodiff();
        let frames = BTreeMap::from([(0, identity_frame(&device))]);
        let mut spec = ObjectiveSpec { requests: vec![request(5, painted(&[(0, 25), (1, 50), (2, 25)]))], ..Default::default() };
        spec.requests[0].respond.as_mut().unwrap().code.target = TargetSpec::Path { codes: [[2.0, 0.0, 0.0], [4.0, 0.0, 0.0]], anchors: [0, 2] };
        let objective = Objective::build(&spec, &frames, &mut ReferenceCache::default(), &device).unwrap();
        let mut readout = readout_with(&[(5, 1.0), (6, 4.0), (7, 6.0)], &device);
        readout.native_BTD = readout.native_BTD.require_grad();
        assert!((raw_values(&objective, &readout, &device)[0] - 13.0 / 144.0).abs() < 1e-6);
        let calibration = Calibration::new(Tensor::zeros([WIDTH], &device), 1.0);
        let raws_NB = objective.raws(&Tensor::zeros([1, 3, 256, 256], &device), &readout, &Assigned(vec![]), &calibration);
        let gradients = raws_NB.sum().backward();
        let gradient_TD = readout.native_BTD.grad(&gradients).unwrap().into_data().try_to_vec::<f32>().unwrap();
        for (slot, expected) in [(5, -0.0625), (6, 1.0 / 18.0), (7, 0.03125)] {
            assert!((gradient_TD[slot * WIDTH] - expected).abs() < 1e-6);
        }
        let probes = Probes::build(&[ProbeSpec { request_id: 1, code: spec.requests[0].respond.as_ref().unwrap().code.clone() }], &frames, &device).unwrap();
        assert_eq!(probes.0[0].errors(&[1.0, 0.0, 0.0, 4.0, 0.0, 0.0, 6.0, 0.0, 0.0]), (vec![1.0, 1.0, 4.0], vec![4.0, 9.0, 16.0]));
    }

    #[test]
    fn region_weights_attraction_and_coverage_and_normalizes_about_the_origin() {
        let device = Device::flex().autodiff();
        let frames = BTreeMap::from([(0, identity_frame(&device))]);
        let mut spec = ObjectiveSpec { requests: vec![request(5, painted(&[(0, 20), (1, 60)]))], ..Default::default() };
        spec.requests[0].respond.as_mut().unwrap().code.target = TargetSpec::Region { codes: vec![[1.0, 0.0, 0.0], [3.0, 0.0, 0.0]], lambda: 0.5 };
        let objective = Objective::build(&spec, &frames, &mut ReferenceCache::default(), &device).unwrap();
        let mut readout = readout_with(&[(5, 0.0), (6, 4.0)], &device);
        readout.native_BTD = readout.native_BTD.require_grad();
        // p = (1/4, 3/4), peak = 0.6, both distances are 1, rho² = (1+9)/2 = 5.
        assert!((raw_values(&objective, &readout, &device)[0] - 0.18).abs() < 1e-6);
        let calibration = Calibration::new(Tensor::zeros([WIDTH], &device), 1.0);
        let raws_NB = objective.raws(&Tensor::zeros([1, 3, 256, 256], &device), &readout, &Assigned(vec![]), &calibration);
        let gradients = raws_NB.sum().backward();
        let gradient_TD = readout.native_BTD.grad(&gradients).unwrap().into_data().try_to_vec::<f32>().unwrap();
        assert!((gradient_TD[5 * WIDTH] + 0.12).abs() < 1e-6);
        assert!((gradient_TD[6 * WIDTH] - 0.24).abs() < 1e-6);
        let probes = Probes::build(&[ProbeSpec { request_id: 1, code: spec.requests[0].respond.as_ref().unwrap().code.clone() }], &frames, &device).unwrap();
        assert_eq!(probes.0[0].errors(&[0.0, 0.0, 0.0, 4.0, 0.0, 0.0]), (vec![1.0, 1.0], vec![5.0, 5.0]));
    }

    #[test]
    fn invalid_palette_targets_cannot_be_prepared() {
        let device = Device::flex();
        let frames = BTreeMap::from([(0, identity_frame(&device))]);
        let mut code = request(5, area(&[0, 1, 2])).respond.unwrap().code;
        for target in [
            TargetSpec::Region { codes: vec![], lambda: 1.0 },
            TargetSpec::Region { codes: vec![[0.0; 3]], lambda: 1.0 },
            TargetSpec::Region { codes: vec![[1.0; 3]; 4097], lambda: 1.0 },
            TargetSpec::Path { codes: [[1.0; 3]; 2], anchors: [0, 0] },
            TargetSpec::Path { codes: [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0]], anchors: [0, 2] },
        ] {
            code.target = target;
            assert!(code_term(1, &code, &frames, &device).is_err());
        }
        code.target = TargetSpec::Region { codes: vec![[1.0; 3]], lambda: 1.0 };
        code.slot = 0;
        assert!(code_term(1, &code, &frames, &device).is_err());
    }

    #[test]
    fn the_code_error_is_the_mean_over_the_area_divided_by_the_code_length() {
        let device = Device::flex();
        let frames = BTreeMap::from([(0, identity_frame(&device))]);
        let mut spec = ObjectiveSpec { requests: vec![request(PREFIX as u16, area(&[0, 1]))], ..Default::default() };
        spec.requests[0].respond.as_mut().unwrap().code.code = [2.0, 0.0, 0.0];
        let objective = Objective::build(&spec, &frames, &mut ReferenceCache::default(), &device).unwrap();
        // Slot 5 has code [5,0,0] (d² = 9), slot 6 has [2,0,0] (d² = 0); CLS and slot 7 must not enter.
        let readout = readout_with(&[(0, 1e6), (5, 5.0), (6, 2.0), (7, 1e6)], &device);
        let expected = (9.0 + 0.0) / 2.0 / 4.0;
        assert!((raw_values(&objective, &readout, &device)[0] - expected).abs() < 1e-6);
    }

    #[test]
    fn a_painted_code_field_weights_the_cells_by_mass_and_scales_by_its_peak() {
        let device = Device::flex();
        let frames = BTreeMap::from([(0, identity_frame(&device))]);
        let readout = readout_with(&[(5, 5.0), (6, 2.0)], &device);
        let raw = |strengths: &[(usize, u8)]| {
            let mut spec = ObjectiveSpec { requests: vec![request(PREFIX as u16, painted(strengths))], ..Default::default() };
            spec.requests[0].respond.as_mut().unwrap().code.code = [2.0, 0.0, 0.0];
            let objective = Objective::build(&spec, &frames, &mut ReferenceCache::default(), &device).unwrap();
            raw_values(&objective, &readout, &device)[0]
        };
        // d² = 9 at mass 2/3 and 0 at mass 1/3, peak 1: (9 × 2/3) / 4.
        assert!((raw(&[(0, 100), (1, 50)]) - 1.5).abs() < 1e-6);
        // Halving every strength keeps the masses and halves the peak.
        assert!((raw(&[(0, 50), (1, 25)]) - 0.75).abs() < 1e-6);
        // A faint new cell with d² = 0: mass 1/101 moves the mean a little, the peak not at all.
        let faint = raw(&[(0, 100), (1, 1)]);
        assert!((faint - 9.0 * 100.0 / 101.0 / 4.0).abs() < 1e-6);
    }

    #[test]
    fn a_storage_request_measures_its_own_slot_whatever_its_field() {
        let device = Device::flex();
        let frames = BTreeMap::from([(0, identity_frame(&device))]);
        for where_ in [Some(area(&[0, 1, 2])), Some(vec![0; CELLS]), None] {
            let mut spec = ObjectiveSpec { requests: vec![request(2, vec![])], ..Default::default() };
            spec.requests[0].respond.as_mut().unwrap().code.where_ = where_;
            let objective = Objective::build(&spec, &frames, &mut ReferenceCache::default(), &device).unwrap();
            let readout = readout_with(&[(2, -1.0), (5, 100.0)], &device);
            assert_eq!(raw_values(&objective, &readout, &device), [4.0]);
        }
    }

    #[test]
    fn requests_without_a_direction_or_a_valid_field_are_rejected() {
        let device = Device::flex();
        let frames = BTreeMap::from([(0, identity_frame(&device))]);
        let mut zero = request(PREFIX as u16, vec![FULL_STRENGTH; CELLS]);
        zero.respond.as_mut().unwrap().code.code = [0.0; 3];
        let unpainted = request(PREFIX as u16, vec![0; CELLS]);
        let short = request(PREFIX as u16, vec![FULL_STRENGTH; CELLS - 1]);
        let too_strong = request(PREFIX as u16, painted(&[(0, 101)]));
        for bad in [zero, unpainted, short, too_strong] {
            let spec = ObjectiveSpec { requests: vec![bad], ..Default::default() };
            assert!(Objective::build(&spec, &frames, &mut ReferenceCache::default(), &device).is_err());
        }
    }

    #[test]
    fn specs_parse_from_the_worker_json() {
        let json = r#"{
            "requests": [{"id": 3,
                "respond": {"weight": 0.3, "block": 100, "slot": 2, "code": [1, 2, 3], "where": null},
                "look": {"weight": 1, "where": [0, 100, 37], "references": [{"imageId": 9007199254740991, "source": [true]}]}}],
            "tv": 0.1, "l2": null}"#;
        let spec: ObjectiveSpec = serde_json::from_str(json).unwrap();
        let respond = spec.requests[0].respond.as_ref().unwrap();
        assert_eq!((respond.weight, respond.code.block, respond.code.slot), (0.3, 100, 2));
        let look = spec.requests[0].look.as_ref().unwrap();
        assert_eq!((look.where_.as_slice(), look.references[0].image_id), (&[0, 100, 37][..], 9007199254740991));
        let probes: Vec<ProbeSpec> =
            serde_json::from_str(r#"[{"requestId": 3, "block": 7, "slot": 9, "code": [1, 0, 0], "where": [100]}]"#).unwrap();
        assert_eq!(probes[0].code.block, 7);
        // Format 3's booleans are not percentages; the worker upgrades before it applies.
        assert!(serde_json::from_str::<ProbeSpec>(r#"{"requestId": 3, "block": 7, "slot": 9, "code": [1, 0, 0], "where": [true]}"#).is_err());
        assert!(serde_json::from_str::<ProbeSpec>(r#"{"requestId": 3, "block": 7, "slot": 9, "code": [1, 0, 0], "where": [2.5]}"#).is_err());
    }

    /// A reference readout whose channel 0 holds `values` at positions 0.., every other entry zero.
    fn reference_readout(values: &[f32]) -> Vec<f32> {
        let mut readout_LTD = vec![0.0; READOUT_VALUES];
        for layer in 0..LAYERS {
            for (position, &value) in values.iter().enumerate() {
                readout_LTD[(layer * PATCHES + position) * WIDTH] = value;
            }
        }
        readout_LTD
    }

    /// Generated appearance features with channel 0 at `values` at positions 0.., all else zero.
    fn generated(values: &[f32], device: &Device) -> Vec<Tensor<3>> {
        let mut features = vec![0f32; PATCHES * WIDTH];
        for (position, &value) in values.iter().enumerate() {
            features[position * WIDTH] = value;
        }
        (0..LAYERS)
            .map(|_| Tensor::from_data(TensorData::new(features.clone(), [1, PATCHES, WIDTH]), device).require_grad())
            .collect()
    }

    /// The Look term's raw value and its gradient with respect to channel 0 of the generated cells.
    fn look_raw_and_gradient(
        strengths: &[(usize, u8)],
        window_values: &[&[f32]],
        values: &[f32],
        device: &Device,
    ) -> (f32, Vec<f32>) {
        let mut cache = ReferenceCache::default();
        let references = window_values
            .iter()
            .enumerate()
            .map(|(index, window)| {
                cache.put(index as u64, reference_readout(window));
                let mut source = vec![false; CELLS];
                source[..window.len()].fill(true);
                ReferenceSpec { image_id: index as u64, source }
            })
            .collect();
        let look = LookSpec { weight: 1.0, where_: painted(strengths), references };
        let spec = ObjectiveSpec { requests: vec![RequestSpec { id: 1, respond: None, look: Some(look) }], ..Default::default() };
        let objective = Objective::build(&spec, &BTreeMap::new(), &mut cache, device).unwrap();
        let appearance_BPD = generated(values, device);
        let readout = Readout { native_BTD: Tensor::zeros([1, TOKENS, WIDTH], device), intermediate_BPD: appearance_BPD.clone() };
        let calibration = Calibration::new(Tensor::zeros([WIDTH], device), 1.0);
        let assigned = objective.assign(&readout.intermediate_BPD);
        let raw = objective.raws(&Tensor::zeros([1, 3, 256, 256], device), &readout, &assigned, &calibration);
        let value = raw.clone().into_data().try_to_vec::<f32>().unwrap()[0];
        // The four layers carry the same values, so the gradient of a cell's value is the sum
        // over the layers.
        let mut gradients = raw.sum().backward();
        let mut gradient = vec![0f32; strengths.len()];
        for features_BTD in &appearance_BPD {
            let layer = features_BTD.grad_remove(&mut gradients).unwrap().into_data().try_to_vec::<f32>().unwrap();
            for (total, &(cell, _)) in gradient.iter_mut().zip(strengths) {
                *total += layer[cell * WIDTH];
            }
        }
        (value, gradient)
    }

    /// ∫₀¹ (G − Q̄)² dq by a fine Riemann sum, independent of the curve primitives: the sorted
    /// cells occupy mass intervals in value order (ties by cell), Q̄ is the mean of the
    /// windows' midpoint-rule curves.
    fn numeric_distance(strengths: &[(usize, u8)], windows: &[&[f32]], values: &[f32]) -> f64 {
        let total: f64 = strengths.iter().map(|&(_, s)| s as f64).sum();
        let mut cells: Vec<(f64, usize, f64)> = strengths.iter().map(|&(cell, s)| (values[cell] as f64, cell, s as f64 / total)).collect();
        cells.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
        let curve = |window: &[f32], q: f64| {
            let mut sorted: Vec<f64> = window.iter().map(|&v| v as f64).collect();
            sorted.sort_by(f64::total_cmp);
            let m = sorted.len();
            let u = (q * m as f64 - 0.5).clamp(0.0, (m - 1) as f64);
            let (low, weight) = (u.floor() as usize, u - u.floor());
            sorted[low] + weight * (sorted[(low + 1).min(m - 1)] - sorted[low])
        };
        let steps = 400_000;
        let mut sum = 0.0;
        let (mut cursor, mut upper) = (0, cells[0].2);
        for step in 0..steps {
            let q = (step as f64 + 0.5) / steps as f64;
            while q >= upper && cursor + 1 < cells.len() {
                cursor += 1;
                upper += cells[cursor].2;
            }
            let g = cells[cursor].0;
            let mean: f64 = windows.iter().map(|window| curve(window, q)).sum::<f64>() / windows.len() as f64;
            sum += (g - mean) * (g - mean);
        }
        sum / steps as f64
    }

    #[test]
    fn the_look_raw_is_the_interval_distance_of_the_worked_example() {
        // The worked example: window [0, 4, 8, 12], generated [2, 10] at equal strength:
        // the old midpoint loss is 0, the interval loss is 4; at strength 50 everywhere it is 2.
        let device = Device::flex().autodiff();
        let window: &[f32] = &[0.0, 4.0, 8.0, 12.0];
        let per_channel = (LAYERS * WIDTH) as f32 / LAYERS as f32; // one channel of D, averaged over D and L
        let (full, _) = look_raw_and_gradient(&[(0, 100), (1, 100)], &[window], &[2.0, 10.0], &device);
        assert!((full * per_channel - 4.0).abs() < 1e-4, "{full}");
        let (half, _) = look_raw_and_gradient(&[(0, 50), (1, 50)], &[window], &[2.0, 10.0], &device);
        assert!((half * per_channel - 2.0).abs() < 1e-4, "{half}");
    }

    #[test]
    fn the_look_raw_matches_a_numeric_integral_with_unequal_masses_ties_and_two_references() {
        let device = Device::flex().autodiff();
        let cases: [(&[(usize, u8)], &[&[f32]], &[f32]); 4] = [
            (&[(0, 100), (1, 50)], &[&[0.0, 4.0, 8.0, 12.0]], &[2.0, 10.0]),
            (&[(3, 20), (0, 100), (7, 1)], &[&[0.0, 4.0, 8.0, 12.0], &[6.0]], &[9.0, 1.0, 0.0, -3.0, 0.0, 0.0, 0.0, 5.0]),
            // Tied values with unequal masses: the loss is the same in either order.
            (&[(0, 30), (1, 90)], &[&[1.0, 2.0, 7.0]], &[5.0, 5.0]),
            (&[(0, 90), (1, 30)], &[&[1.0, 2.0, 7.0]], &[5.0, 5.0]),
        ];
        let per_channel = WIDTH as f32;
        let mut tied = Vec::new();
        for (strengths, windows, values) in cases {
            let peak = strengths.iter().map(|&(_, s)| s).max().unwrap() as f64 / 100.0;
            let expected = peak * numeric_distance(strengths, windows, values);
            let (raw, gradient) = look_raw_and_gradient(strengths, windows, values, &device);
            assert!((raw as f64 * per_channel as f64 - expected).abs() < 2e-4, "{raw} vs {expected}");
            // Finite differences of the raw value along each painted cell's value, away from
            // ties: at a tie the sorted order, and with it the gradient, differs on either side.
            let tied_values = values == [5.0, 5.0];
            for (index, &(cell, _)) in strengths.iter().enumerate().filter(|_| !tied_values) {
                let step = 1e-2;
                let mut up = values.to_vec();
                up[cell] += step;
                let mut down = values.to_vec();
                down[cell] -= step;
                let (raw_up, _) = look_raw_and_gradient(strengths, windows, &up, &device);
                let (raw_down, _) = look_raw_and_gradient(strengths, windows, &down, &device);
                let numeric = (raw_up - raw_down) / (2.0 * step);
                assert!((gradient[index] - numeric).abs() < 1e-4, "cell {cell}: {} vs {numeric}", gradient[index]);
            }
            if tied_values {
                tied.push(raw);
            }
        }
        assert!((tied[0] - tied[1]).abs() < 1e-7);
    }

    #[test]
    fn rules_match_the_reference_formulas_on_a_small_image() {
        let device = Device::flex();
        // A 2 × 2 image whose normalized red values are [[0, 1], [2, 4]], other channels zero.
        let mut values = vec![0f32; 3 * 4];
        for (index, normalized) in [0.0f32, 1.0, 2.0, 4.0].into_iter().enumerate() {
            values[index] = normalized * RGB_STD[0] + RGB_MEAN[0];
        }
        for channel in 1..3 {
            for index in 0..4 {
                values[channel * 4 + index] = RGB_MEAN[channel];
            }
        }
        let image = Tensor::<4>::from_data(TensorData::new(values, [1, 3, 2, 2]), &device);
        let tv = total_variation(image.clone()).into_data().try_to_vec::<f32>().unwrap()[0];
        let l2 = image_l2(image).into_data().try_to_vec::<f32>().unwrap()[0];
        // Horizontal [−1, −2], vertical [−2, −3], rising [2 − 1], falling [0 − 4].
        let expected_tv = 5f32.sqrt() + 13f32.sqrt() + 1.0 + 4.0;
        assert!((tv - expected_tv).abs() < 1e-4, "{tv} vs {expected_tv}");
        assert!((l2 - 21f32.sqrt()).abs() < 1e-4);
    }
}
