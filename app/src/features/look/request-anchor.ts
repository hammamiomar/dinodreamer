import type { CloudRows } from "../../library/block-cloud";
import type { StrengthCuts } from "../../recipe";
import type { Vec3 } from "../../ui/code-space/projection";
import type { LookSelection } from "./selection";
import { bandIndex, type BandIndex } from "./strength-bands";

// The anchor is the one patch a request asks Grow for. The person can choose it
// explicitly; otherwise it follows the selection by the rule below. The page names
// its band before Send because patches near the ring may not meet the training target.

/**
 * The anchor of a selection when the person has not chosen one.
 *
 * | Selection             | Anchor                                   |
 * | --------------------- | ---------------------------------------- |
 * | Wand                  | its first seed: the patch the person clicked |
 * | Lasso                 | the strongest selected patch             |
 * | Your picture's patches| the strongest of them                    |
 * | A band                | its patch nearest the lobe's direction (bandSelection) |
 * | Nothing selected      | none                                     |
 *
 * Equal norms keep the lower index.
 */
export function anchorFollowingSelection(selection: LookSelection, selected: readonly number[], norms: ArrayLike<number>): number | null {
  if (selection.kind === "none") return null;
  if (selection.kind === "wand") return selection.seeds[0] ?? null;
  if (selection.kind === "band") return selection.anchor;
  let strongest: number | null = null;
  for (const index of selected) {
    if (strongest === null || norms[index] > norms[strongest] || (norms[index] === norms[strongest] && index < strongest)) strongest = index;
  }
  return strongest;
}

export interface Lift {
  /** A row of the loaded library cloud. */
  index: number;
  /** The angle between the two native codes. */
  degrees: number;
}

/**
 * The library patch in a band whose direction is nearest a given code: "lift
 * this patch to Strongest" keeps the direction and asks for more strength.
 * Candidates are loaded rows with public pictures, so the person sees what they
 * ask for. Equal angles fall back to image ID, then slot. One pass over the loaded
 * rows; no neighbour graph.
 */
export function nearestInBand(rows: CloudRows, from: Vec3, band: BandIndex, strength: StrengthCuts): Lift | null {
  const fromNorm = Math.hypot(from[0], from[1], from[2]);
  if (!(fromNorm > 0)) return null;
  let best: number | null = null;
  let bestCosine = -Infinity;
  for (let index = 0; index < rows.count; index++) {
    if (rows.publicPreview[index] !== 1 || bandIndex(rows.norms[index], strength) !== band) continue;
    const x = rows.codes[3 * index];
    const y = rows.codes[3 * index + 1];
    const z = rows.codes[3 * index + 2];
    const norm = Math.hypot(x, y, z);
    if (!(norm > 0)) continue;
    const cosine = (x * from[0] + y * from[1] + z * from[2]) / (norm * fromNorm);
    const tie = best !== null && cosine === bestCosine
      && (rows.imageIds[index] < rows.imageIds[best] || (rows.imageIds[index] === rows.imageIds[best] && rows.slots[index] < rows.slots[best]));
    if (cosine > bestCosine || tie) {
      best = index;
      bestCosine = cosine;
    }
  }
  if (best === null) return null;
  return { index: best, degrees: Math.acos(Math.min(1, Math.max(-1, bestCosine))) * 180 / Math.PI };
}

/**
 * Every loaded library patch of one band, each occurrence once. Its anchor is the
 * band's sample patch with a picture nearest the lobe's main direction. `first` is the
 * first library page index; `repeats` marks prefix rows that repeat a sample row.
 */
export function bandSelection(bands: readonly BandIndex[], repeats: Uint8Array, first: number, band: BandIndex,
  sample: CloudRows, lobe: Vec3, strength: StrengthCuts): Extract<LookSelection, { kind: "band" }> {
  const indices: number[] = [];
  for (let index = first; index < bands.length; index++) {
    if (bands[index] === band && repeats[index] === 0) indices.push(index);
  }
  const nearest = nearestInBand(sample, lobe, band, strength);
  return { kind: "band", band, indices, anchor: nearest && first + nearest.index };
}
