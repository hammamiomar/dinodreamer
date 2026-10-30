// Each Train action uses one occurrence as its request's anchor. The points carry
// the anchor's band, so a downloaded request records the patches it represents.

import type { BlockCloud } from "../../library/block-cloud";
import { MATERIAL_REQUEST_MAX_POINTS, type MaterialRequest, type StrengthCuts } from "../../recipe";
import type { PreparedCloud } from "./cloud-geometry";
import type { CloudToken } from "./cloud-token";
import { evenSubsample, makeMaterialRequest } from "./material-request";
import { bandSelection, nearestInBand } from "./request-anchor";
import { STRONGEST } from "./strength-bands";

/** What the page already holds about its cloud; the requests are built from it on a click. */
export interface OccurrenceSource {
  cloud: BlockCloud;
  prepared: PreparedCloud;
  strength: StrengthCuts;
  /** A page index as a patch: the visitor's picture first, then the library rows (pageToken). */
  token: (index: number) => CloudToken;
}

/**
 * Grow's default occurrence for the block: the Strongest sample patch with a picture nearest the
 * lobe's main direction, the anchor of strongestBandRequest and of /train?block=N. Null when the
 * public sample has no Strongest patch with a picture.
 */
export function defaultOccurrence({ cloud, prepared, strength }: OccurrenceSource): number | null {
  const nearest = nearestInBand(cloud.sample, cloud.whole.axes[0], STRONGEST, strength);
  return nearest === null ? null : prepared.own + nearest.index;
}

/**
 * A request anchored at one page index. Its points are every loaded library patch of the
 * anchor's band, each occurrence once, with the anchor added when it is not one of them (your
 * picture's patch); at most 4,352 are sent, spread evenly, the anchor kept.
 */
export function occurrenceRequest({ cloud, prepared, strength, token }: OccurrenceSource, index: number): MaterialRequest {
  const band = prepared.bands[index];
  const selection = bandSelection(prepared.bands, prepared.repeats, prepared.own, band, cloud.sample, cloud.whole.axes[0], strength);
  const { indices } = selection;
  const region = indices.includes(index) || prepared.repeats[index] === 1 ? indices : [index, ...indices];
  return makeMaterialRequest({
    block: cloud.whole.block,
    token,
    points: evenSubsample(region, MATERIAL_REQUEST_MAX_POINTS, index),
    anchor: index,
    strength,
    coverage: { source: cloud.source, loadedRows: prepared.libraryRows, blockRows: cloud.whole.rows, selectedPoints: region.length },
  });
}

/**
 * The first `count` pictures of a band's members, `lead` first when it is among them: the
 * Strongest row opens with the picture Grow a material grows toward.
 */
export function leadingPictures(members: readonly number[], lead: number | null, count: number): number[] {
  if (lead === null || !members.includes(lead)) return members.slice(0, count);
  return [lead, ...members.filter((index) => index !== lead)].slice(0, count);
}
