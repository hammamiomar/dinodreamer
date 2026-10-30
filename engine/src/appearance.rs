//! The reference cache: encoded appearance readouts of reference images.
//!
//! Axes: L appearance layers, T = 256 patch positions,
//! D = 768 channels. Arrays are row-major `Vec<f32>`. A Look term builds its reference
//! curves from these readouts once per apply (`curve.rs`); the update sorts the painted
//! cells against them on the GPU (`ranking.rs`).

use crate::encoder::{APPEARANCE_LAYERS, PATCHES, WIDTH};
use std::sync::Arc;

pub const LAYERS: usize = APPEARANCE_LAYERS.len();
/// One readout is [L, T, D] FP32, 3 MiB. A recipe needs at most 4 × 12 + 12 = 60
/// distinct reference images, so 64 entries hold any single recipe's references.
pub const REFERENCE_CACHE_IMAGES: usize = 64;
pub const READOUT_VALUES: usize = LAYERS * PATCHES * WIDTH;

/// Encoded reference readouts by image id, least recently used evicted first.
/// Entries are never mutated and are shared, not copied, while templates are built.
#[derive(Default)]
pub struct ReferenceCache {
    entries: Vec<(u64, Arc<[f32]>)>,
}

impl ReferenceCache {
    pub fn contains(&self, image_id: u64) -> bool {
        self.entries.iter().any(|(id, _)| *id == image_id)
    }

    /// Mark the cached images among `needed` most recently used and return the others,
    /// which must be encoded. Encoding at most `needed.len()` new images then evicts
    /// only images outside `needed`, because a recipe needs at most 60 of the 64 entries.
    pub fn retain_needed(&mut self, needed: &[u64]) -> Vec<u64> {
        assert!(needed.len() <= REFERENCE_CACHE_IMAGES, "a recipe needs at most 60 reference images");
        needed
            .iter()
            .copied()
            .filter(|&image_id| self.get(image_id).is_none())
            .collect()
    }

    pub fn get(&mut self, image_id: u64) -> Option<Arc<[f32]>> {
        let index = self.entries.iter().position(|(id, _)| *id == image_id)?;
        let entry = self.entries.remove(index);
        let readout_LTD = entry.1.clone();
        self.entries.push(entry);
        Some(readout_LTD)
    }

    pub fn put(&mut self, image_id: u64, readout_LTD: Vec<f32>) {
        assert_eq!(readout_LTD.len(), READOUT_VALUES);
        self.entries.retain(|(id, _)| *id != image_id);
        if self.entries.len() == REFERENCE_CACHE_IMAGES {
            self.entries.remove(0);
        }
        self.entries.push((image_id, readout_LTD.into()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_needed_cached_image_survives_encoding_a_new_one_into_a_full_cache() {
        let mut cache = ReferenceCache::default();
        for id in 0..REFERENCE_CACHE_IMAGES as u64 {
            cache.put(id, vec![0.0; READOUT_VALUES]);
        }
        // Image 0 is the least recently used; the next recipe reuses it and adds image 1000.
        assert_eq!(cache.retain_needed(&[0, 1000]), [1000]);
        cache.put(1000, vec![0.0; READOUT_VALUES]);
        assert!(cache.contains(0) && cache.contains(1000) && !cache.contains(1));
    }

    #[test]
    fn cache_evicts_the_least_recently_used_image() {
        let mut cache = ReferenceCache::default();
        for id in 0..REFERENCE_CACHE_IMAGES as u64 {
            cache.put(id, vec![0.0; READOUT_VALUES]);
        }
        assert!(cache.get(0).is_some());
        cache.put(1000, vec![0.0; READOUT_VALUES]);
        assert!(cache.contains(0) && !cache.contains(1) && cache.contains(1000));
    }
}
