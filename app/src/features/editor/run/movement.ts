// What one update did to the image: for each cell of the 16 × 16 grid, the mean
// absolute change of its pixels, all three colour channels, in 8-bit units, between
// two consecutive delivered frames. Computed by the session when a frame arrives
// (session.ts receiveFrame); the first frame after an apply or a restart has none,
// since its predecessor shows another objective or another image.

import { GRID, CELLS } from "../../../recipe";

/**
 * The movement that draws as full white, in 8-bit units per pixel per update. One
 * fixed scale, so maps compare across steps and runs and the image's settling shows
 * as the map dimming. For one patch request of block 1398 from a fresh image, seed 1,
 * the first update moved the cells by 1.75 levels on average and 2.26 at most; by
 * steps 10 to 30 the largest cell moved 0.75, after step 60 about 0.25, the mean 0.08.
 * At 2 the first updates of a fresh image read near full white and a settled run as
 * near black.
 */
export const MOVEMENT_FULL_SCALE = 2;

export interface MovementRecord {
  /** The step of the later of the two frames. */
  step: number;
  /** Per cell, row-major 16 × 16: mean |Δ| over the cell's pixels and the RGB channels. */
  cells: Float32Array;
  /** The mean over all cells. */
  mean: number;
}

/** The movement series is kept in the session history under this key, beside the term ids. */
export const MOVEMENT_SERIES = "movement";

/**
 * Per-cell movement between two RGBA images of the same square size, or undefined when
 * the images do not match the grid (a different size, or a side not divisible by 16).
 */
export function frameMovement(previous: Uint8ClampedArray, next: Uint8ClampedArray): Float32Array | undefined {
  if (previous.length !== next.length) return undefined;
  const side = Math.round(Math.sqrt(next.length / 4));
  if (side * side * 4 !== next.length || side % GRID !== 0) return undefined;
  const cellSide = side / GRID;
  const sums = new Float32Array(CELLS);
  for (let y = 0; y < side; y++) {
    const cellRow = Math.floor(y / cellSide) * GRID;
    for (let x = 0; x < side; x++) {
      const cell = cellRow + Math.floor(x / cellSide);
      const offset = (y * side + x) * 4;
      // The alpha channel is always 255 in a frame and carries no change.
      sums[cell] +=
        Math.abs(next[offset] - previous[offset]) +
        Math.abs(next[offset + 1] - previous[offset + 1]) +
        Math.abs(next[offset + 2] - previous[offset + 2]);
    }
  }
  const samplesPerCell = cellSide * cellSide * 3;
  for (let cell = 0; cell < CELLS; cell++) sums[cell] /= samplesPerCell;
  return sums;
}

export function meanMovement(cells: Float32Array): number {
  let sum = 0;
  for (let cell = 0; cell < cells.length; cell++) sum += cells[cell];
  return cells.length === 0 ? 0 : sum / cells.length;
}

/** Each cell's movement as a lightness from 0 to 1 on the fixed scale, clipped at full white. */
export function movementLightness(cells: Float32Array): Float32Array {
  return cells.map((value) => Math.min(1, Math.max(0, value / MOVEMENT_FULL_SCALE)));
}
