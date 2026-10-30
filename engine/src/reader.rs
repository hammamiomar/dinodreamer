//! Gain-free dictionary addresses. Projection stays on the GPU; bounded top-32
//! reduction uses one 512-block readback at a time. T patches, G blocks, R=3.
use crate::assets::Weights;
use burn::tensor::{Device, Tensor};

pub const BLOCKS: usize = 16384;
pub const WINNERS: usize = 32;
/// The model's one learned gain, exp(log_gain) of the pass-003 bundle (weights.safetensors
/// SHA-256 fa425dff…): it scales the gain-free codes only to rebuild a token from its winners
/// (bsf.py `decode(encode(x))`). Every code the site shows is gain-free. The 32 frames of a
/// token overlap, so the plain sum Σ F_k c_k overshoots the token; the trained gain corrects it.
pub const RECONSTRUCTION_GAIN: f32 = 0.369_421_452_283_859_25;
/// The pass-003 calibration multiplier, to refuse another dictionary's calibration with this gain.
pub const PASS_003_SCALE: f32 = 2.802_615_880_966_186_5;

/// x̂ = gain · Σ_k F_k c_k, the token rebuilt from its winners in calibrated coordinates
/// (bsf.py `decode`): frames [K, R, D] (row r of block k is its direction r), codes [K, R].
pub fn reconstruction(gain: f32, frames_KRD: &[f32], codes_KR: &[f32]) -> Vec<f32> {
    let width = frames_KRD.len() / codes_KR.len();
    let mut token_D = vec![0.0f32; width];
    for (direction_D, code) in frames_KRD.chunks_exact(width).zip(codes_KR) {
        for (value, axis) in token_D.iter_mut().zip(direction_D) {
            *value += code * axis;
        }
    }
    token_D.iter_mut().for_each(|value| *value *= gain);
    token_D
}

struct FrameChunk {
    first: usize,
    count: usize,
    frame_RD: Tensor<2>,
}
pub struct DictionaryReader {
    chunks: Vec<FrameChunk>,
    loaded: usize,
}

impl Default for DictionaryReader {
    fn default() -> Self {
        Self {
            chunks: Vec::new(),
            loaded: 0,
        }
    }
}
impl DictionaryReader {
    pub fn load(
        &mut self,
        first: usize,
        count: usize,
        bytes: &[u8],
        device: &Device,
    ) -> Result<(), String> {
        if first != self.loaded || count == 0 || count > 512 || first + count > BLOCKS {
            return Err("Reader chunks must cover blocks 0–16383 exactly, in order".into());
        }
        let frame_RD = Weights::new(bytes, device)
            .map_err(|e| e.to_string())?
            .tensor("frames", [count * 3, 768])
            .map_err(|e| e.to_string())?;
        self.chunks.push(FrameChunk {
            first,
            count,
            frame_RD,
        });
        self.loaded += count;
        Ok(())
    }
    pub async fn read(&self, tokens_1TD: Tensor<3>) -> Result<Addresses, String> {
        self.project(tokens_1TD, None)
            .await
            .map(|(addresses, _)| addresses)
    }

    /// Block `block`'s three orthonormal directions [R, D] = [3, 768] in calibrated coordinates:
    /// its rows of the reader chunk that holds it.
    pub fn frame(&self, block: usize) -> Result<Tensor<2>, String> {
        let chunk = self
            .chunks
            .iter()
            .find(|chunk| (chunk.first..chunk.first + chunk.count).contains(&block))
            .ok_or("Load the reader chunk of this block first")?;
        let row = (block - chunk.first) * 3;
        Ok(chunk.frame_RD.clone().slice([row..row + 3, 0..768]))
    }

    /// The BSF's view of one calibrated token [1, 1, D]: its 32 winners strongest first with their
    /// gain-free codes and norms (as `read` ranks them), and the token rebuilt from them.
    pub async fn gate(&self, calibrated_11D: Tensor<3>) -> Result<Gate, String> {
        let addresses = self.read(calibrated_11D).await?;
        let frames: Result<Vec<Tensor<2>>, String> =
            addresses.blocks.iter().map(|&block| self.frame(block as usize)).collect();
        let frames_KRD = Tensor::cat(frames?, 0)
            .into_data_async()
            .await
            .map_err(|e| e.to_string())?
            .try_to_vec::<f32>()
            .map_err(|e| e.to_string())?;
        let reconstruction_D = reconstruction(RECONSTRUCTION_GAIN, &frames_KRD, &addresses.codes);
        Ok(Gate { addresses, reconstruction_D })
    }

    /// Return one block's codes from the same projection that ranks the dictionary.
    pub async fn read_block(
        &self,
        tokens_1TD: Tensor<3>,
        block: usize,
    ) -> Result<(Addresses, Vec<f32>), String> {
        if block >= BLOCKS {
            return Err("Invalid dictionary block".into());
        }
        self.project(tokens_1TD, Some(block)).await
    }

    async fn project(
        &self,
        tokens_1TD: Tensor<3>,
        requested_block: Option<usize>,
    ) -> Result<(Addresses, Vec<f32>), String> {
        if self.loaded != BLOCKS {
            return Err("Load the whole dictionary before reading addresses".into());
        }
        let patches = tokens_1TD.dims()[1];
        let mut winners = AddressAccumulator::new(patches);
        let mut requested_codes_TR = Vec::new();
        for chunk in &self.chunks {
            #[cfg(feature = "gpu")]
            let codes_1TR =
                crate::kernels::frozen_linear(tokens_1TD.clone(), chunk.frame_RD.clone());
            #[cfg(not(feature = "gpu"))]
            let codes_1TR = tokens_1TD
                .clone()
                .matmul(chunk.frame_RD.clone().transpose().unsqueeze());
            let codes = codes_1TR
                .into_data_async()
                .await
                .map_err(|e| e.to_string())?
                .try_to_vec::<f32>()
                .map_err(|e| e.to_string())?;
            if let Some(block) = requested_block
                .filter(|block| (chunk.first..chunk.first + chunk.count).contains(block))
            {
                for patch in 0..patches {
                    let offset = (patch * chunk.count + block - chunk.first) * 3;
                    requested_codes_TR.extend_from_slice(&codes[offset..offset + 3]);
                }
            }
            winners.add(chunk.first, chunk.count, &codes)?;
        }
        Ok((winners.finish(), requested_codes_TR))
    }
}

#[derive(Clone)]
struct Winner {
    block: u16,
    code: [f32; 3],
    squared: f32,
}
pub struct Addresses {
    pub blocks: Vec<u16>,
    pub codes: Vec<f32>,
    pub norms: Vec<f32>,
}

/// One token through the gate: its winners (`addresses` of one patch) and the token rebuilt from
/// them, gain · Σ_k F_k c_k [D], in calibrated coordinates.
pub struct Gate {
    pub addresses: Addresses,
    pub reconstruction_D: Vec<f32>,
}
impl Addresses {
    /// E1 credits all ties at the cutoff: fewer than 32 blocks have strictly larger energy.
    /// Address display still breaks ties by block id, so membership alone is insufficient.
    pub fn winner_fraction(&self, requested_codes_TR: &[f32]) -> f32 {
        let winners = self.winners(requested_codes_TR);
        winners.iter().filter(|&&wins| wins).count() as f32 / winners.len() as f32
    }

    /// Per patch, whether the requested block wins there (the rule of `winner_fraction`).
    pub fn winners(&self, requested_codes_TR: &[f32]) -> Vec<bool> {
        let squared = |code: &[f32]| code.iter().map(|value| value * value).sum::<f32>();
        requested_codes_TR
            .chunks_exact(3)
            .enumerate()
            .map(|(patch, code)| {
                let offset = (patch * WINNERS + WINNERS - 1) * 3;
                squared(code) >= squared(&self.codes[offset..offset + 3])
            })
            .collect()
    }
}

pub struct AddressAccumulator {
    rows: Vec<Vec<Winner>>,
}
impl AddressAccumulator {
    pub fn new(patches: usize) -> Self {
        Self {
            rows: vec![Vec::new(); patches],
        }
    }
    pub fn add(&mut self, first: usize, count: usize, codes_TGR: &[f32]) -> Result<(), String> {
        if codes_TGR.len() != self.rows.len() * count * 3
            || codes_TGR.iter().any(|v| !v.is_finite())
        {
            return Err("Reader produced invalid patch codes".into());
        }
        for (patch, winners) in self.rows.iter_mut().enumerate() {
            for block in 0..count {
                let offset = (patch * count + block) * 3;
                let code: [f32; 3] = codes_TGR[offset..offset + 3].try_into().unwrap();
                let squared = code.iter().map(|v| v * v).sum::<f32>();
                if !squared.is_finite() {
                    return Err("Reader produced an invalid code norm".into());
                }
                let id = (first + block) as u16;
                if let Some(last) = winners.last() {
                    if winners.len() == WINNERS
                        && (squared < last.squared || (squared == last.squared && id > last.block))
                    {
                        continue;
                    }
                }
                let position = winners.partition_point(|w| {
                    w.squared > squared || (w.squared == squared && w.block < id)
                });
                winners.insert(
                    position,
                    Winner {
                        block: id,
                        code,
                        squared,
                    },
                );
                winners.truncate(WINNERS);
            }
        }
        Ok(())
    }
    pub fn finish(self) -> Addresses {
        let mut result = Addresses {
            blocks: Vec::new(),
            codes: Vec::new(),
            norms: Vec::new(),
        };
        for row in self.rows {
            for w in row {
                result.blocks.push(w.block);
                result.codes.extend(w.code);
                result.norms.push(w.squared.sqrt());
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn growth_wins_include_equal_energy_outside_the_address_display() {
        let mut result = AddressAccumulator::new(1);
        result.add(0, 33, &[1.0, 0.0, 0.0].repeat(33)).unwrap();
        let addresses = result.finish();
        assert!(!addresses.blocks.contains(&32));
        assert_eq!(addresses.winner_fraction(&[1.0, 0.0, 0.0]), 1.0);
        assert_eq!(addresses.winner_fraction(&[0.9, 0.0, 0.0]), 0.0);
    }

    #[test]
    fn the_reconstruction_sums_each_frame_times_its_code_then_applies_the_gain() {
        // Two blocks of three directions in a 4-wide space: e0, e1, e2 and e1, e2, e3.
        let unit = |axis: usize| (0..4).map(|index| if index == axis { 1.0 } else { 0.0 }).collect::<Vec<f32>>();
        let frames_KRD: Vec<f32> = [0, 1, 2, 1, 2, 3].iter().flat_map(|&axis| unit(axis)).collect();
        let codes_KR = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        // e0·1 + e1·(2 + 4) + e2·(3 + 5) + e3·6, halved.
        assert_eq!(reconstruction(0.5, &frames_KRD, &codes_KR), [0.5, 3.0, 4.0, 3.0]);
    }

    #[test]
    fn ties_follow_block_id_across_chunk_boundaries() {
        let mut result = AddressAccumulator::new(1);
        result.add(32, 32, &vec![1.0; 32 * 3]).unwrap();
        result.add(0, 32, &vec![1.0; 32 * 3]).unwrap();
        assert_eq!(result.finish().blocks, (0..32).collect::<Vec<_>>());
    }
    #[test]
    fn keeps_rank_code_and_norm_together_per_patch() {
        let mut codes = vec![0.0; 2 * 64 * 3];
        for patch in 0..2 {
            for block in 0..64 {
                codes[(patch * 64 + block) * 3] = if patch == 0 {
                    block as f32
                } else {
                    (64 - block) as f32
                };
            }
        }
        let mut result = AddressAccumulator::new(2);
        result.add(0, 64, &codes).unwrap();
        let result = result.finish();
        assert_eq!(result.blocks[0], 63);
        assert_eq!(result.blocks[32], 0);
        assert_eq!(result.codes[0], 63.0);
        assert_eq!(result.norms[32], 64.0);
    }
}
