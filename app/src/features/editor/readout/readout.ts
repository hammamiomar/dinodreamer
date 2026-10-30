// What the columns display, computed from one measurement of the image with no shift (computation.md §12).
// Symbols: c is the requested code (3 numbers, fixed by the recipe); m_p is the
// measured code of token p, for the P measured tokens; d_p² = |m_p − c|² is the
// worker's per-token `errors` entry. All quantities are in code-space units.

import { CELLS, PATCH_SLOT_OFFSET, type Area } from "../../../recipe";
import type { CodeMeasurement } from "../../../synthesis/protocol";

export type Code = [number, number, number];

/** Below this length a code has no direction, so the angle is not reported. */
const DIRECTION_EPSILON = 1e-6;

export interface CodeStats {
  /** P, the number of measured tokens. */
  count: number;
  /** Mean achieved code, weighted by the applied field. */
  mean: Code;
  /** sqrt( Σ_p mass_p d_p² ): the root-mean-square distance to the request. */
  distance: number;
  /** sqrt( Σ_p mass_p |m_p − mean|² ): how far the tokens scatter around their own mean. */
  spread: number;
  /** Angle between the mean and the request, in degrees; undefined when either is near zero length. */
  angleDegrees?: number;
  /** mean₃ − c₃: the plot shows coordinates 1 and 2, so the third is reported as a number. */
  thirdDifference: number;
}

/** The mean measured code of [P, 3] codes, or undefined when nothing was measured. */
export function meanCode(codes_P3: Float32Array, masses_P?: readonly number[]): Code | undefined {
  const count = codes_P3.length / 3;
  if (count === 0) return undefined;
  const mean: Code = [0, 0, 0];
  for (let token = 0; token < count; token++) {
    for (let axis = 0; axis < 3; axis++) mean[axis] += codes_P3[token * 3 + axis] * (masses_P?.[token] ?? 1 / count);
  }
  return mean;
}

export function codeStats(measurement: CodeMeasurement, requested: Code, appliedField?: Area): CodeStats | undefined {
  const masses = codeMasses(measurement.slots, appliedField);
  const mean = meanCode(measurement.codes, masses);
  if (!mean) return undefined;
  const count = measurement.errors.length;

  const meanSquaredDistance = measurement.errors.reduce((sum, error, token) => sum + masses[token] * error, 0);
  let scatter = 0;
  for (let token = 0; token < count; token++) {
    for (let axis = 0; axis < 3; axis++) scatter += masses[token] * (measurement.codes[token * 3 + axis] - mean[axis]) ** 2;
  }

  const meanLength = Math.hypot(...mean);
  const requestedLength = Math.hypot(...requested);
  const hasDirection = meanLength > DIRECTION_EPSILON && requestedLength > DIRECTION_EPSILON;
  const cosine = hasDirection ? dot(mean, requested) / (meanLength * requestedLength) : 0;

  return {
    count,
    mean,
    distance: Math.sqrt(meanSquaredDistance),
    spread: Math.sqrt(scatter),
    angleDegrees: hasDirection ? (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI : undefined,
    thirdDifference: mean[2] - requested[2],
  };
}

/** Normalized masses in measurement slot order. Prefix slots each have unit mass. */
export function codeMasses(slots: Uint16Array, appliedField?: Area): number[] {
  const weights = Array.from(slots, (slot) => slot < PATCH_SLOT_OFFSET || !appliedField ? 1 : appliedField[slot - PATCH_SLOT_OFFSET]);
  const sum = weights.reduce((total, weight) => total + weight, 0);
  return sum > 0 ? weights.map((weight) => weight / sum) : weights.map(() => 0);
}

/**
 * Per-cell match for the match map: d_p² / |c|² for each measured patch token, null for
 * a cell that was not measured. The scale is the code loss's own normalization: 0 is an
 * exact match, 1 means the token is as far from the request as the request is from zero.
 * A CLS or storage measurement has no cell, so its map is all null.
 */
export function matchMap(measurement: CodeMeasurement, requested: Code): (number | null)[] {
  const cells: (number | null)[] = new Array(CELLS).fill(null);
  const requestedSquaredLength = dot(requested, requested);
  if (requestedSquaredLength <= 0 && !measurement.normalizers) return cells;
  measurement.slots.forEach((slot, row) => {
    if (slot < PATCH_SLOT_OFFSET) return;
    const normSquared = measurement.normalizers?.[row] ?? requestedSquaredLength;
    cells[slot - PATCH_SLOT_OFFSET] = normSquared > 0 ? measurement.errors[row] / normSquared : null;
  });
  return cells;
}

function dot(a: Code, b: Code): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
