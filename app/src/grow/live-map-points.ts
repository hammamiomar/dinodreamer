// The live map of a training run, as numbers: the canvas's patches as points of the basis group's own
// space, their mean, and the view they are drawn in. A reading gives each of the 64 patches three
// numbers, the patch's response to the group (engine: figure_reading, patchCodes). They are in the space
// of the group's cloud, so a patch is a point there, and a run is those points moving toward its target.
// No DOM or React here: live-map.tsx draws what this file computes.

import { fitCodes, type Fit, type Vec3 } from "../ui/code-space/projection";
import { MAP_PATCHES, readPatchIndices, type ReadRegion } from "./selection-cells";

/** The values of one reading's patch codes: three for each of the 64 patches, patch t at [3t, 3t + 3). */
export const PATCH_CODE_VALUES = MAP_PATCHES * 3;

/** The canvas's 64 patches as points, in patch order. */
export function patchPoints(patchCodes: ArrayLike<number>): Vec3[] {
  if (patchCodes.length !== PATCH_CODE_VALUES) throw new Error(`A reading gives ${PATCH_CODE_VALUES} patch code values, not ${patchCodes.length}`);
  return Array.from({ length: MAP_PATCHES }, (_, patch) => [patchCodes[3 * patch]!, patchCodes[3 * patch + 1]!, patchCodes[3 * patch + 2]!] as const);
}

/** The mean of some points; the origin for none. */
export function meanOf(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) return [0, 0, 0];
  const sum = points.reduce<[number, number, number]>((total, point) => [total[0] + point[0], total[1] + point[1], total[2] + point[2]], [0, 0, 0]);
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

/** The mean of the patches a run scores: what a mean method compares with its target. */
export function scoredMean(points: readonly Vec3[], region: ReadRegion): Vec3 {
  return meanOf(readPatchIndices(region).map((patch) => points[patch]!));
}

/** The distance between two points in units of the group's median response magnitude, as the page states strengths. */
export function distanceInMedians(a: Vec3, b: Vec3, medianNorm: number): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / medianNorm;
}

/**
 * The points part of the way from one reading to the next, `share` in [0, 1]. Both ends are readings;
 * the way between them is drawn only so the eye can follow which point went where.
 */
export function between(from: readonly Vec3[], to: readonly Vec3[], share: number): Vec3[] {
  const t = Math.max(0, Math.min(1, share));
  return to.map((end, index) => {
    const start = from[index] ?? end;
    return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t, start[2] + (end[2] - start[2]) * t] as const;
  });
}

/** A cloud's rows as points: `count` rows of three interleaved values. */
export function cloudPoints(codes: ArrayLike<number>, count: number): Vec3[] {
  return Array.from({ length: count }, (_, row) => [codes[3 * row]!, codes[3 * row + 1]!, codes[3 * row + 2]!] as const);
}

/**
 * The view's fit: the cloud's rows and the target, and never the canvas's patches. So the view holds
 * still while the patches move, and a patch that starts far outside the cloud is seen arriving.
 */
export function mapFit(cloud: readonly Vec3[], target: readonly Vec3[]): Fit {
  return fitCodes([...cloud, ...target]);
}

/** The most means the map keeps for the mean's path: the last readings, oldest first. */
export const PATH_READINGS = 24;

/** The mean's path with one more reading, the oldest dropped past PATH_READINGS. */
export function withMean(path: readonly Vec3[], mean: Vec3): Vec3[] {
  return [...path, mean].slice(-PATH_READINGS);
}
