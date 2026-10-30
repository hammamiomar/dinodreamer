// Train toward the picture's strongest patch when it reaches Level 3 or Level 4.
// Weaker patches use the nearest Level 4 library patch in the same direction:
// requests near the ring can fail to meet the selection target.

import type { BlockCloud } from "../../library/block-cloud";
import { MATERIAL_REQUEST_MAX_POINTS, type MaterialRequest, type StrengthCuts } from "../../recipe";
import { pageToken, prepareCloud } from "./cloud-geometry";
import type { CloudToken } from "./cloud-token";
import { evenSubsample, makeMaterialRequest } from "./material-request";
import { nearestInBand } from "./request-anchor";
import { STRONGEST, type BandIndex } from "./strength-bands";

/** Level 3 is the minimum response level used directly as a picture's training target. */
export const FIRING_BAND: BandIndex = 2;

export type PictureAnchorReason = "own" | "lift";

/**
 * The patch the material grows toward: the picture's own strongest patch when its band is
 * Strongly or Strongest, else the lift to Strongest; null when there is no lift to take.
 */
export function pictureAnchor(ownBand: BandIndex, own: number, lift: number | null): { index: number; reason: PictureAnchorReason } | null {
  if (ownBand >= FIRING_BAND) return { index: own, reason: "own" };
  if (lift !== null) return { index: lift, reason: "lift" };
  return null;
}

export interface PictureGrow {
  request: MaterialRequest;
  reason: PictureAnchorReason;
}

/**
 * The request for Grow from the visitor's patches in a block (`own`, as the reader lists them
 * for the block): every one of them, plus the lift when the anchor is one. Null when the picture
 * has no patch here, or its patch is too weak and the public sample has no Strongest patch with
 * a picture to lift to.
 */
export function pictureGrowRequest(cloud: BlockCloud, own: readonly CloudToken[], strength: StrengthCuts): PictureGrow | null {
  if (own.length === 0) return null;
  const prepared = prepareCloud(cloud, own, strength);
  const main = prepared.ownByStrength[0]!;
  const lift = nearestInBand(cloud.sample, prepared.native[main]!, STRONGEST, strength);
  const chosen = pictureAnchor(prepared.bands[main]!, main, lift === null ? null : prepared.own + lift.index);
  if (chosen === null) return null;
  const points = chosen.index === main ? prepared.ownByStrength : [...prepared.ownByStrength, chosen.index];
  const request = makeMaterialRequest({
    block: cloud.whole.block,
    token: (index) => pageToken(cloud, own, index),
    points: evenSubsample(points, MATERIAL_REQUEST_MAX_POINTS, chosen.index),
    anchor: chosen.index,
    strength,
    coverage: { source: cloud.source, loadedRows: prepared.libraryRows, blockRows: cloud.whole.rows, selectedPoints: points.length },
  });
  return { request, reason: chosen.reason };
}
