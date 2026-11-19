//! Recipe objective specifications, painted field parsing, and code-target preparation.

use crate::{
    encoder::{PATCHES, PREFIX, TOKENS},
    image::GRID,
};
use burn::tensor::{Device, Tensor, TensorData};
use serde::Deserialize;

/// Below this squared length a requested code has no direction; the loss would divide by it.
pub const MIN_CODE_NORM_SQUARED: f32 = 1e-12;
pub const CELLS: usize = PATCHES;
/// A painted strength is an integer percentage; 100 is full strength.
pub const FULL_STRENGTH: u8 = 100;
/// Maximum number of target codes accepted in a region target.
pub const MAX_REGION_CODES: usize = 4096;

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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RespondSpec {
    pub weight: f32,
    #[serde(flatten)]
    pub code: CodeSpec,
}

/// One block's requested code at a token role. A CLS or storage slot measures itself and
/// ignores `where`; a patch slot measures the painted cells of its Respond like field.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    Path {
        codes: [[f32; 3]; 2],
        anchors: [usize; 2],
    },
    Region {
        codes: Vec<[f32; 3]>,
        lambda: f32,
    },
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

/// A painted field, prepared once per objective. Cell c has strength `s_c = W_c / 100`. The
/// field measures the cells with `s_c > 0`; they share the term by mass `p_c = s_c / Σ s`, and
/// the field pulls with its peak `max s_c`. An all-100 field has equal masses and peak 1.
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
    let masses = cells
        .iter()
        .map(|&cell| (percentages[cell] as f64 / total) as f32)
        .collect();
    let peak = cells
        .iter()
        .map(|&cell| percentages[cell])
        .max()
        .unwrap_or(0) as f32
        / FULL_STRENGTH as f32;
    Ok(Field { cells, masses, peak })
}

/// What a code readout measures: its slots with their masses and the field's peak. A CLS or
/// storage request measures its own slot with mass and peak 1 and ignores its field; a patch
/// request measures the painted cells of its Respond like field.
pub(super) struct Measured {
    pub slots: Vec<u16>,
    pub masses: Vec<f32>,
    pub peak: f32,
}

pub(super) fn measured(spec: &CodeSpec) -> Result<Measured, String> {
    let slot = spec.slot as usize;
    if slot < PREFIX {
        return Ok(Measured {
            slots: vec![spec.slot],
            masses: vec![1.0],
            peak: 1.0,
        });
    }
    if slot >= TOKENS {
        return Err(format!("token slot {slot} is outside the {TOKENS} slots"));
    }
    let where_ = spec
        .where_
        .as_deref()
        .ok_or("a patch request needs a Respond like field")?;
    let field = field(where_)?;
    Ok(Measured {
        slots: field.cells.iter().map(|&cell| (PREFIX + cell) as u16).collect(),
        masses: field.masses,
        peak: field.peak,
    })
}

pub(super) struct PathTarget {
    pub(super) codes_PR: Vec<[f32; 3]>,
    pub(super) codes_1PR: Tensor<3>,
    pub(super) inverse_norm_1P: Tensor<2>,
}

pub(super) struct RegionTarget {
    pub(super) codes_MR: Vec<[f32; 3]>,
    pub(super) codes_11MR: Tensor<4>,
    pub(super) inverse_norm_squared: f32,
    pub(super) lambda: f32,
}

/// Frozen target tensors. M is the number of region codes (at most `MAX_REGION_CODES`).
pub(super) enum CodeTarget {
    Point,
    Path(Box<PathTarget>),
    Region(Box<RegionTarget>),
}

pub(super) fn squared_norm(code: &[f32; 3]) -> f32 {
    code.iter().map(|value| value * value).sum()
}

/// Masses as a `[1, P]` row on the device.
pub(super) fn masses_tensor(masses: &[f32], device: &Device) -> Tensor<2> {
    Tensor::from_data(TensorData::new(masses.to_vec(), [1, masses.len()]), device)
}

pub(super) fn prepare_target(
    spec: &CodeSpec,
    slots: &[u16],
    device: &Device,
) -> Result<CodeTarget, String> {
    if matches!(spec.target, TargetSpec::Point) {
        return Ok(CodeTarget::Point);
    }
    if (spec.slot as usize) < PREFIX {
        return Err("paths and regions require a patch request".into());
    }
    match &spec.target {
        TargetSpec::Point => unreachable!(),
        TargetSpec::Path {
            codes,
            anchors: [a, b],
        } => {
            if a == b || *a >= CELLS || *b >= CELLS {
                return Err("a path needs two distinct anchor cells in 0–255".into());
            }
            let dx = (b % GRID) as f32 - (a % GRID) as f32;
            let dy = (b / GRID) as f32 - (a / GRID) as f32;
            let codes_PR: Vec<[f32; 3]> = slots
                .iter()
                .map(|&slot| {
                    let cell = slot as usize - PREFIX;
                    let x = (cell % GRID) as f32 - (a % GRID) as f32;
                    let y = (cell / GRID) as f32 - (a / GRID) as f32;
                    let t = ((x * dx + y * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
                    std::array::from_fn(|axis| (1.0 - t) * codes[0][axis] + t * codes[1][axis])
                })
                .collect();
            let norms_P: Vec<f32> = codes_PR.iter().map(squared_norm).collect();
            if norms_P
                .iter()
                .any(|norm| !norm.is_finite() || *norm < MIN_CODE_NORM_SQUARED)
            {
                return Err("a path target has length below 0.000001 at a painted cell".into());
            }
            let points = slots.len();
            let codes_1PR = Tensor::from_data(
                TensorData::new(codes_PR.iter().flatten().copied().collect::<Vec<_>>(), [1, points, 3]),
                device,
            );
            let inverse_norm_1P =
                masses_tensor(&norms_P.iter().map(|norm| 1.0 / norm).collect::<Vec<_>>(), device);
            Ok(CodeTarget::Path(Box::new(PathTarget {
                codes_PR,
                codes_1PR,
                inverse_norm_1P,
            })))
        }
        TargetSpec::Region { codes, lambda } => {
            if codes.is_empty() || codes.len() > MAX_REGION_CODES {
                return Err(format!("a region needs 1–{MAX_REGION_CODES} target codes"));
            }
            if !lambda.is_finite() || *lambda < 0.0 {
                return Err("region coverage weight must be non-negative".into());
            }
            let norm_squared = codes.iter().map(squared_norm).sum::<f32>() / codes.len() as f32;
            if !norm_squared.is_finite() || norm_squared < MIN_CODE_NORM_SQUARED {
                return Err("region RMS code length is below 0.000001".into());
            }
            let codes_11MR = Tensor::from_data(
                TensorData::new(
                    codes.iter().flatten().copied().collect::<Vec<_>>(),
                    [1, 1, codes.len(), 3],
                ),
                device,
            );
            Ok(CodeTarget::Region(Box::new(RegionTarget {
                codes_MR: codes.clone(),
                codes_11MR,
                inverse_norm_squared: 1.0 / norm_squared,
                lambda: *lambda,
            })))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(
            (look.where_.as_slice(), look.references[0].image_id),
            (&[0, 100, 37][..], 9007199254740991)
        );
        let probes: Vec<ProbeSpec> = serde_json::from_str(
            r#"[{"requestId": 3, "block": 7, "slot": 9, "code": [1, 0, 0], "where": [100]}]"#,
        )
        .unwrap();
        assert_eq!(probes[0].code.block, 7);
        // Painted fields require integer percentages, not booleans or floats.
        assert!(serde_json::from_str::<ProbeSpec>(
            r#"{"requestId": 3, "block": 7, "slot": 9, "code": [1, 0, 0], "where": [true]}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ProbeSpec>(
            r#"{"requestId": 3, "block": 7, "slot": 9, "code": [1, 0, 0], "where": [2.5]}"#
        )
        .is_err());
    }

    #[test]
    fn field_computes_masses_and_peak_and_rejects_invalid_inputs() {
        let mut percentages = vec![0u8; CELLS];
        percentages[2] = 50;
        percentages[9] = 25;
        let parsed = field(&percentages).unwrap();
        assert_eq!(parsed.cells, [2, 9]);
        assert!((parsed.masses[0] - 2.0 / 3.0).abs() < 1e-6);
        assert!((parsed.masses[1] - 1.0 / 3.0).abs() < 1e-6);
        assert_eq!(parsed.peak, 0.5);

        let empty = field(&vec![0u8; CELLS]).unwrap();
        assert!(empty.cells.is_empty() && empty.masses.is_empty() && empty.peak == 0.0);

        assert!(field(&vec![0u8; CELLS - 1]).is_err());
        percentages[0] = FULL_STRENGTH + 1;
        assert!(field(&percentages).is_err());
    }

    #[test]
    fn measured_handles_prefix_and_patch_slots() {
        let prefix = CodeSpec {
            block: 0,
            slot: 2,
            code: [1.0, 0.0, 0.0],
            target: TargetSpec::Point,
            where_: None,
        };
        let result = measured(&prefix).unwrap();
        assert_eq!((result.slots, result.masses, result.peak), (vec![2], vec![1.0], 1.0));

        let missing_field = CodeSpec { slot: PREFIX as u16, ..prefix.clone() };
        assert!(measured(&missing_field).is_err());

        let out_of_range = CodeSpec { slot: TOKENS as u16, ..prefix.clone() };
        assert!(measured(&out_of_range).is_err());

        let mut where_ = vec![0u8; CELLS];
        where_[4] = FULL_STRENGTH;
        let patch = CodeSpec {
            slot: PREFIX as u16,
            where_: Some(where_),
            ..prefix
        };
        let result = measured(&patch).unwrap();
        assert_eq!(result.slots, vec![(PREFIX + 4) as u16]);
    }
}
