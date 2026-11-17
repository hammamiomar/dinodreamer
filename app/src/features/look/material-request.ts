import { MATERIAL_REQUEST_MAX_POINTS, type MaterialAnchor, type MaterialCoverage, type MaterialPoint, type MaterialRequest, type StrengthCuts } from "../../recipe";
import { setChoice } from "../../grow/target-set";
import type { CloudToken } from "./cloud-token";
import { bandIndex, STRENGTH_BANDS } from "./strength-bands";

export interface RequestInput {
  block: number;
  /** A patch of the page's cloud: the picture's patches, then library rows. */
  token: (index: number) => CloudToken;
  /** The points to carry: the whole region, or evenSubsample of it. */
  points: readonly number[];
  anchor: number;
  strength: StrengthCuts;
  coverage: MaterialCoverage;
  mode?: MaterialRequest["mode"];
}

/** Copy native codes, never display coordinates, so PCA and camera changes cannot alter the request. */
export function materialPoint(point: CloudToken): MaterialPoint {
  if (point.source === "upload") return { source: "upload", code: [...point.code], slot: point.slot };
  const hidden = point.publicPreview ? {} : { publicPreview: false as const };
  return { source: "library", imageId: point.imageId, code: [...point.code], slot: point.slot, ...hidden };
}

/** The band comes first, so it is the first thing a reader of the request sees. */
export function materialAnchor(point: CloudToken, strength: StrengthCuts): MaterialAnchor {
  return {
    band: STRENGTH_BANDS[bandIndex(point.norm, strength)],
    norm: point.norm,
    strength: { ring: strength.ring, cuts: [...strength.cuts], maximum: strength.maximum },
    ...materialPoint(point),
  };
}

export function makeMaterialRequest(input: RequestInput): MaterialRequest {
  return {
    anchor: materialAnchor(input.token(input.anchor), input.strength),
    block: input.block,
    points: input.points.map((index) => materialPoint(input.token(index))),
    ...(input.mode ? { mode: input.mode } : {}),
    coverage: { ...input.coverage },
  };
}

/**
 * At most `limit` of a region's page indices, evenly spaced in row order. Full-file
 * rows are stored in image-balanced shuffled order, so even spacing is a fair draw
 * across pictures. A selected anchor stays in the points, and so does each index of
 * `kept`: each replaces the drawn index nearest to it in that order that nothing kept
 * holds yet, and the points stay in row order. The rest of the even spread is unchanged.
 * A region within the limit is returned unchanged.
 */
export function evenSubsample(selected: readonly number[], limit: number, anchor: number | null, kept: readonly number[] = []): readonly number[] {
  if (selected.length <= limit) return selected;
  const drawn = Array.from({ length: limit }, (_, slot) => Math.floor(slot * selected.length / limit));
  const fixed = new Set<number>();
  const positions = (anchor === null ? kept : [anchor, ...kept]).map((index) => selected.indexOf(index)).filter((at) => at >= 0);
  for (const at of positions) {
    const already = drawn.indexOf(at);
    if (already >= 0) {
      fixed.add(already);
      continue;
    }
    let nearest = -1;
    for (let slot = 0; slot < limit; slot++) {
      if (fixed.has(slot)) continue;
      if (nearest < 0 || Math.abs(drawn[slot] - at) < Math.abs(drawn[nearest] - at)) nearest = slot;
    }
    if (nearest < 0) break;
    drawn[nearest] = at;
    fixed.add(nearest);
  }
  return [...drawn].sort((a, b) => a - b).map((position) => selected[position]);
}

/**
 * The region's patches that Train's set methods train toward (grow/target-set.ts setChoice): the
 * strongest patch of each of its strongest distinct public library pictures, at most 33, ranked by
 * the norm of the code as Train ranks the points it receives.
 */
export function setPatches(selected: readonly number[], token: (index: number) => CloudToken): number[] {
  const library = selected.filter((index) => token(index).source === "library");
  const candidates = library.map((index) => {
    const point = token(index) as Extract<CloudToken, { source: "library" }>;
    return { imageId: point.imageId, slot: point.slot, norm: Math.hypot(...point.code), publicPreview: point.publicPreview };
  });
  return setChoice(candidates).map((position) => library[position]!);
}

/**
 * The points a Send to Train carries: the region, or at most MATERIAL_REQUEST_MAX_POINTS of it evenly
 * spread, always with the anchor and the patches of the set Train would take from the whole region.
 */
export function sentPoints(selected: readonly number[], token: (index: number) => CloudToken, anchor: number | null): readonly number[] {
  if (selected.length <= MATERIAL_REQUEST_MAX_POINTS) return selected;
  return evenSubsample(selected, MATERIAL_REQUEST_MAX_POINTS, anchor, setPatches(selected, token));
}
