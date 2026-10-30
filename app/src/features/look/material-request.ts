import type { MaterialAnchor, MaterialCoverage, MaterialPoint, MaterialRequest, StrengthCuts } from "../../recipe";
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
 * across pictures. A selected anchor stays in the points: it replaces the drawn index
 * nearest to it in that order. A region within the limit is returned unchanged.
 */
export function evenSubsample(selected: readonly number[], limit: number, anchor: number | null): readonly number[] {
  if (selected.length <= limit) return selected;
  const drawn = Array.from({ length: limit }, (_, slot) => Math.floor(slot * selected.length / limit));
  const at = anchor === null ? -1 : selected.indexOf(anchor);
  if (at >= 0 && !drawn.includes(at)) {
    let nearest = 0;
    for (let slot = 1; slot < limit; slot++) if (Math.abs(drawn[slot] - at) < Math.abs(drawn[nearest] - at)) nearest = slot;
    drawn[nearest] = at;
  }
  return drawn.map((position) => selected[position]);
}
