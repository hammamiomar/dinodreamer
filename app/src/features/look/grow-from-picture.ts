// Train from your picture: toward the reference patch you chose on the page, else your own
// strongest patch here. The page never swaps a weak patch for a library patch on its own. It warns
// at Level 1 and Level 2 (in the training tests so far, reference patches near the ring did not
// meet the selection target) and offers the lift, the nearest Level 4 library patch in the same
// direction, as a choice.

import type { BlockCloud } from "../../library/block-cloud";
import { MATERIAL_REQUEST_MAX_POINTS, type MaterialRequest, type StrengthCuts } from "../../recipe";
import { pageToken, prepareCloud, type PreparedCloud } from "./cloud-geometry";
import type { CloudToken } from "./cloud-token";
import { evenSubsample, makeMaterialRequest } from "./material-request";
import { nearestInBand } from "./request-anchor";
import { STRONGEST, type BandIndex } from "./strength-bands";

/** Level 3 is the first response level a reference patch trains from without the warning. */
export const WARNED_BELOW: BandIndex = 2;

/** Why Train aims where it does: your own patch, its lift, or another patch you made the reference. */
export type PictureAnchorReason = "own" | "lift" | "chosen";

/** The patch the automaton trains toward: the reference patch you chose, else your own strongest patch. */
export function pictureAnchor(own: number, chosen: number | null, lift: number | null): { index: number; reason: PictureAnchorReason } {
  if (chosen === null || chosen === own) return { index: own, reason: "own" };
  if (chosen === lift) return { index: chosen, reason: "lift" };
  return { index: chosen, reason: "chosen" };
}

export interface PictureGrow {
  request: MaterialRequest;
  reason: PictureAnchorReason;
}

/**
 * The request for Train from your patches in a block (`own`, as the reader lists them for the
 * block): every one of them, plus the reference patch when it is a library patch. `chosen` is the
 * page index of the reference patch you chose, or null for your own strongest patch. Null when
 * the picture has no patch here.
 */
export function pictureGrowRequest(
  cloud: BlockCloud, own: readonly CloudToken[], strength: StrengthCuts, chosen: number | null = null,
  prepared: PreparedCloud = prepareCloud(cloud, own, strength),
): PictureGrow | null {
  if (own.length === 0) return null;
  const main = prepared.ownByStrength[0]!;
  const lift = nearestInBand(cloud.sample, prepared.native[main]!, STRONGEST, strength);
  const anchor = pictureAnchor(main, chosen, lift === null ? null : prepared.own + lift.index);
  const points = anchor.index < prepared.own ? prepared.ownByStrength : [...prepared.ownByStrength, anchor.index];
  const request = makeMaterialRequest({
    block: cloud.whole.block,
    token: (index) => pageToken(cloud, own, index),
    points: evenSubsample(points, MATERIAL_REQUEST_MAX_POINTS, anchor.index),
    anchor: anchor.index,
    strength,
    coverage: { source: cloud.source, loadedRows: prepared.libraryRows, blockRows: cloud.whole.rows, selectedPoints: points.length },
  });
  return { request, reason: anchor.reason };
}
