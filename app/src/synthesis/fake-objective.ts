// Deterministic numerical fixtures for the fake worker. These are synthetic
// channels and colours, not DINO features or a simulation of its image gradients.

import { CELLS, GRID, PATCH_SLOT_OFFSET, type Recipe, type Request } from "../recipe";
import type { CodeMeasurement } from "./protocol";

/** Code raw = peak × weighted squared error / requested code norm. Prefix mass is 1. */
export function paintedCodeLoss(request: Request, measurement: CodeMeasurement): number {
  const term = request.respondLike;
  const norm = term.code.reduce((sum, value) => sum + value * value, 0);
  if (norm <= 1e-12 || measurement.errors.length === 0) return 0;
  if (term.source.role !== "patch") return measurement.errors[0] / norm;
  const sum = term.where.reduce((total, value) => total + value, 0);
  if (sum === 0) return 0;
  const peak = Math.max(...term.where) / 100;
  let error = 0;
  measurement.slots.forEach((slot, row) => {
    error += term.where[slot - PATCH_SLOT_OFFSET] / sum * measurement.errors[row] / (measurement.normalizers?.[row] ?? norm);
  });
  return peak * error;
}

/** Every active Code request contributes its global weight × peak × cell mass. */
export function cellPulls(recipe: Recipe): { colours_N3: Float64Array; pull_N: Float64Array } {
  const colours_N3 = new Float64Array(CELLS * 3);
  const pull_N = new Float64Array(CELLS);
  for (const { respondLike: term } of recipe.requests) {
    if (!term.enabled || term.weight <= 0 || term.source.role !== "patch") continue;
    const sum = term.where.reduce((total, value) => total + value, 0);
    if (sum === 0) continue;
    const peak = Math.max(...term.where) / 100;
    const norm = Math.hypot(...term.code);
    const colour = term.code.map((value) => 0.5 + 0.45 * value / norm);
    term.where.forEach((value, cell) => {
      const pull = term.weight * peak * value / sum;
      pull_N[cell] += pull;
      for (let channel = 0; channel < 3; channel++) colours_N3[cell * 3 + channel] += pull * colour[channel];
    });
  }
  for (let cell = 0; cell < CELLS; cell++) {
    if (pull_N[cell] === 0) continue;
    for (let channel = 0; channel < 3; channel++) colours_N3[cell * 3 + channel] /= pull_N[cell];
  }
  return { colours_N3, pull_N };
}

/** One invented channel and one view exercise the same interval contract as the engine. */
export function syntheticAppearanceLoss(request: Request, decay: number): number {
  const generated_N = request.lookLike.where.map((_, cell) => (cell % GRID) / (GRID - 1) + 0.5 * decay);
  const windows = request.lookLike.references.map(({ token, source }) => source.flatMap((inside, cell) =>
    inside ? [(cell % GRID) / (GRID - 1) + ((token.imageId % 7) - 3) * 0.025] : [],
  ));
  return intervalAppearanceLoss(generated_N, request.lookLike.where, windows);
}

/**
 * Exact one-channel integral of (G(q) - Q(q))², times field peak. G is the
 * strength-weighted empirical quantile. Q equally averages each window's linear
 * curve through knots (k + 0.5) / M, with constant tails. Inputs share cell order.
 */
export function intervalAppearanceLoss(generated_N: readonly number[], field_N: readonly number[], referenceWindows: readonly number[][]): number {
  const sum = field_N.reduce((total, value) => total + value, 0);
  if (sum === 0 || referenceWindows.length === 0 || referenceWindows.some((window) => window.length === 0)) return 0;
  const windows = referenceWindows.map((window) => [...window].sort((a, b) => a - b));
  const knots = [...new Set([0, 1, ...windows.flatMap((window) => window.map((_, index) => (index + 0.5) / window.length))])].sort((a, b) => a - b);
  const curve = (q: number) => windows.reduce((total, window) => total + windowQuantile(window, q), 0) / windows.length;
  const values = knots.map(curve);
  const order = field_N.flatMap((weight, cell) => weight > 0 ? [cell] : []).sort((a, b) => generated_N[a] - generated_N[b] || a - b);
  let mass = 0;
  let segment = 0;
  let error = 0;
  for (const cell of order) {
    const lower = mass / sum;
    mass += field_N[cell];
    const upper = mass / sum;
    let start = lower;
    while (start < upper) {
      while (segment < knots.length - 2 && knots[segment + 1] <= start) segment++;
      const end = Math.min(upper, knots[segment + 1]);
      const width = knots[segment + 1] - knots[segment];
      const slope = (values[segment + 1] - values[segment]) / width;
      const qStart = values[segment] + slope * (start - knots[segment]);
      const qEnd = values[segment] + slope * (end - knots[segment]);
      const residualStart = generated_N[cell] - qStart;
      const residualEnd = generated_N[cell] - qEnd;
      error += (end - start) * (residualStart ** 2 + residualStart * residualEnd + residualEnd ** 2) / 3;
      start = end;
    }
  }
  return Math.max(...field_N) / 100 * error;
}

function windowQuantile(sorted: readonly number[], q: number): number {
  const position = Math.max(0, Math.min(sorted.length - 1, q * sorted.length - 0.5));
  const left = Math.floor(position);
  const right = Math.min(sorted.length - 1, left + 1);
  return sorted[left] + (position - left) * (sorted[right] - sorted[left]);
}
