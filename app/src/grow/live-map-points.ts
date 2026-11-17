// The live map of a training run, as numbers: the canvas's patches as points of the basis group's own
// space, their mean, and the view they are drawn in. A reading gives each of the 64 patches three
// numbers, the patch's response to the group (engine: figure_reading, patchCodes). They are in the space
// of the group's cloud, so a patch is a point there, and a run is those points moving toward its target.
// No DOM or React here: live-map.tsx draws what this file computes.

import { fitCodes, type Fit, type Vec3 } from "../ui/code-space/projection";
import type { FigureMethod } from "../materials/material-file";
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
 * The map's own frame, a rotation of the group's space: `up` runs from the origin, where a canvas of noise
 * starts, toward the target's mean; `across` is the direction at right angles to it in which the group's cloud
 * is widest; `toward` faces the viewer. So a run reads from the bottom of the map to the top whatever the
 * group, and never along the line of sight.
 */
export interface MapFrame {
  across: Vec3;
  up: Vec3;
  toward: Vec3;
}

/** The group's own axes: the frame when there is no target to face yet. */
export const NATIVE_FRAME: MapFrame = { across: [1, 0, 0], up: [0, 1, 0], toward: [0, 0, 1] };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scaled = (a: Vec3, by: number): Vec3 => [a[0] * by, a[1] * by, a[2] * by];
const unit = (a: Vec3): Vec3 => scaled(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** The frame for a target and the group's cloud (MapFrame); the group's own axes for a target at the origin. */
export function mapFrame(target: readonly Vec3[], cloud: readonly Vec3[]): MapFrame {
  const mean = meanOf(target);
  if (Math.hypot(mean[0], mean[1], mean[2]) < 1e-9) return NATIVE_FRAME;
  const up = unit(mean);
  // Two directions at right angles to `up`: from the group's axis least along it.
  const least = [0, 1, 2].reduce((best, axis) => (Math.abs(up[axis]!) < Math.abs(up[best]!) ? axis : best), 0);
  const a = unit(cross(up, [least === 0 ? 1 : 0, least === 1 ? 1 : 0, least === 2 ? 1 : 0]));
  const b = cross(up, a);
  // The cloud's widest direction among them: the first principal direction of its rows in that plane.
  const centre = meanOf(cloud);
  let aa = 0;
  let ab = 0;
  let bb = 0;
  for (const row of cloud) {
    const offset: Vec3 = [row[0] - centre[0], row[1] - centre[1], row[2] - centre[2]];
    const alongA = dot(offset, a);
    const alongB = dot(offset, b);
    aa += alongA * alongA;
    ab += alongA * alongB;
    bb += alongB * alongB;
  }
  const angle = 0.5 * Math.atan2(2 * ab, aa - bb);
  const widest: Vec3 = [
    a[0] * Math.cos(angle) + b[0] * Math.sin(angle), a[1] * Math.cos(angle) + b[1] * Math.sin(angle), a[2] * Math.cos(angle) + b[2] * Math.sin(angle),
  ];
  // Either sense is the widest direction; take the one along the group's axis it leans on most, so it does not flip.
  const leading = [0, 1, 2].reduce((best, axis) => (Math.abs(widest[axis]!) > Math.abs(widest[best]!) ? axis : best), 0);
  const across = widest[leading]! < 0 ? scaled(widest, -1) : widest;
  return { across, up, toward: cross(across, up) };
}

/** A point of the group's space in the map's frame: across, up, toward the viewer. */
export function inFrame(frame: MapFrame, point: Vec3): Vec3 {
  return [dot(point, frame.across), dot(point, frame.up), dot(point, frame.toward)];
}

/** The room the view leaves around the origin and the target, as a share of the sphere that holds them. */
const JOURNEY_MARGIN = 1.25;
/** The room it leaves around a patch that lay outside it. */
const WIDENED_MARGIN = 1.05;

/**
 * The view's fit, in the map's frame: the origin and the target, and never the group's whole cloud, whose
 * far rows would make a run's way a small part of the map. The cloud's rows outside it are not drawn.
 */
export function journeyFit(target: readonly Vec3[]): Fit {
  const fit = fitCodes([[0, 0, 0], ...target]);
  return { center: fit.center, radius: fit.radius * JOURNEY_MARGIN };
}

/**
 * The radius that also holds these patches: the view widens for a patch outside it, so no patch is lost
 * from the map, and the caller never narrows it again, so the view holds still while the patches move.
 */
export function widenedRadius(fit: Fit, patches: readonly Vec3[]): number {
  let radius = fit.radius;
  for (const patch of patches) {
    radius = Math.max(radius, Math.hypot(patch[0] - fit.center[0], patch[1] - fit.center[1], patch[2] - fit.center[2]) * WIDENED_MARGIN);
  }
  return radius;
}

/** The most means the map keeps for the mean's path: the last readings, oldest first. */
export const PATH_READINGS = 24;

/** The mean's path with one more reading, the oldest dropped past PATH_READINGS. */
export function withMean(path: readonly Vec3[], mean: Vec3): Vec3[] {
  return [...path, mean].slice(-PATH_READINGS);
}

/**
 * What a run trains toward, as points of the map: basis-group mean matching, the reference patch's code;
 * a set method, every token of its prepared set (the engine's set codes, N x 3), none until the worker has
 * prepared it.
 */
export function mapTarget(method: FigureMethod, anchorCode: Vec3, setCodes: Float32Array | null): Vec3[] {
  if (method === "basis-group-mean") return [anchorCode];
  return setCodes ? cloudPoints(setCodes, setCodes.length / 3) : [];
}
