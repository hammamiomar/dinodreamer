// The relay on the home's entrance (home-material-view.tsx, carryCells): an arrow press keeps the
// field's cells and gives them to the next automaton's rule, so one automaton grows out of the last,
// as in the opening of the essay on computervision.vision. These are its rules as plain functions:
// how the cells change between grids so that the picture stays the same, when a rule that cannot
// grow from another rule's cells starts again from its own start, and which automaton the entrance
// runs while the next one's file loads.
//
// A cell holds 16 values; the first three are its colour, shown as clamp(x + 0.5, 0, 1). The cells
// of a grid of `side` cells are side² rows of 16 values, row by row (the replay's state, `_NC`: N
// cells, C channels). A coarse + fine automaton also has a coarse grid of side / 2 under the fine one;
// its picture is the fine colour plus the coarse colour upsampled by two on the torus (figure-shaders.ts,
// PYRAMID_PICTURE). A file at 2 px per cell has half the cells, and its picture upsamples its colour
// by two (CELL_PICTURE).

import { FIGURE_PYRAMID_LAYOUT, type FigureMaterial } from "../../materials/material-file";
import type { FigureReplayState } from "../../replay/figure-replay";
import type { Loaded } from "../../ui/use-loaded";
import type { MaterialEntry } from "../gallery/material-index";
import type { Shown } from "./home-panel";

/** The values a cell holds, and how many of them are its colour. */
const CHANNELS = 16;
const COLOUR_CHANNELS = 3;

/** The grids of an automaton: cells per side of its fine grid, and whether a coarse grid lies under it. */
export interface Grids {
  side: number;
  coarse: boolean;
}

export function gridsOf(entry: Pick<MaterialEntry, "side" | "layout">): Grids {
  return { side: entry.side, coarse: entry.layout === FIGURE_PYRAMID_LAYOUT };
}

/**
 * The two cells of a grid of `side` that cell `j` of a grid of 2 × side reads along one axis, with
 * their weights: bilinear upsampling by two on the torus (figure-shaders.ts, torus_axis). For
 * k = floor(j / 2), an even j weighs cells k − 1 and k by 0.25 and 0.75, an odd j cells k and k + 1
 * by 0.75 and 0.25, wrapped.
 */
function upsampledAxis(j: number, side: number): { i0: number; i1: number; w0: number; w1: number } {
  const k = j >> 1;
  if (j % 2 === 0) return { i0: (k + side - 1) % side, i1: k, w0: 0.25, w1: 0.75 };
  return { i0: k, i1: (k + 1) % side, w0: 0.75, w1: 0.25 };
}

/**
 * Grid `cells_NC` of `side` cells per side, upsampled by two on the torus, added `weight` times to
 * `into_NC` (2 × side per side): its first `channels` values per cell.
 */
function addUpsampled(cells_NC: Float32Array, side: number, into_NC: Float32Array, channels: number, weight: number): void {
  const doubled = 2 * side;
  for (let y = 0; y < doubled; y++) {
    const rows = upsampledAxis(y, side);
    for (let x = 0; x < doubled; x++) {
      const columns = upsampledAxis(x, side);
      const cell = (y * doubled + x) * CHANNELS;
      for (let channel = 0; channel < channels; channel++) {
        const at = (row: number, column: number) => cells_NC[(row * side + column) * CHANNELS + channel];
        const top = at(rows.i0, columns.i0) * columns.w0 + at(rows.i0, columns.i1) * columns.w1;
        const bottom = at(rows.i1, columns.i0) * columns.w0 + at(rows.i1, columns.i1) * columns.w1;
        into_NC[cell + channel] += weight * (top * rows.w0 + bottom * rows.w1);
      }
    }
  }
}

/** Grid `cells_NC` of `side` cells per side as a grid of side / 2: each cell the mean of the 2 × 2 cells it covers, all 16 values. */
function halved(cells_NC: Float32Array, side: number): Float32Array {
  const half = side / 2;
  const halved_NC = new Float32Array(half * half * CHANNELS);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const from = (y * side + x) * CHANNELS;
      const into = ((y >> 1) * half + (x >> 1)) * CHANNELS;
      for (let channel = 0; channel < CHANNELS; channel++) halved_NC[into + channel] += cells_NC[from + channel] / 4;
    }
  }
  return halved_NC;
}

/** Grid `cells_NC` of `side` cells per side as a grid of 2 × side: every value upsampled bilinearly on the torus. */
function doubled(cells_NC: Float32Array, side: number): Float32Array {
  const doubled_NC = new Float32Array(4 * side * side * CHANNELS);
  addUpsampled(cells_NC, side, doubled_NC, CHANNELS, 1);
  return doubled_NC;
}

/** One grid from two: the coarse colour upsampled and added to the fine colour, which then shows the same picture alone. */
function folded(cells: FigureReplayState, side: number): Float32Array {
  if (!cells.coarse) return cells.fine;
  const fine_NC = Float32Array.from(cells.fine);
  addUpsampled(cells.coarse, side / 2, fine_NC, COLOUR_CHANNELS, 1);
  return fine_NC;
}

/**
 * Split a single grid into coarse and fine grids with the same composite image.
 * The coarse grid takes the 2x2 block average of all 16 channels, and its upsampled RGB
 * is subtracted from the fine grid. Starting with an all-zero coarse grid displays the same
 * initial image, but coarse + fine rules then often collapse to a uniform background instead
 * of growing their figure.
 */
function split(fine_NC: Float32Array, side: number): { fine: Float32Array; coarse: Float32Array } {
  const coarse_NC = halved(fine_NC, side);
  const rest_NC = Float32Array.from(fine_NC);
  addUpsampled(coarse_NC, side / 2, rest_NC, COLOUR_CHANNELS, -1);
  return { fine: rest_NC, coarse: coarse_NC };
}

/**
 * Convert `cells` from layout `from` to layout `to` while preserving the rendered image.
 * Returns null if grid sides differ by a factor other than 1 or 2 so the next automaton
 * restarts from its own initial state.
 */
export function cellsForGrids(cells: FigureReplayState, from: Grids, to: Grids): FigureReplayState | null {
  if (from.side === to.side && from.coarse === to.coarse) return cells;
  let fine_NC = folded(cells, from.side);
  if (to.side === 2 * from.side) fine_NC = doubled(fine_NC, from.side);
  else if (2 * to.side === from.side) fine_NC = halved(fine_NC, from.side);
  else if (to.side !== from.side) return null;
  return to.coarse ? { tick: cells.tick, ...split(fine_NC, to.side) } : { tick: cells.tick, fine: fine_NC };
}

/** Tick interval between flat-field checks on relayed automata (1 s at 60 ticks/s). */
export const FLAT_CHECK_EVERY_TICKS = 60;

/**
 * Mean per-channel RGB standard deviation below which a field appears uniform (~5 of 255 levels).
 * Flat fields can drift slightly upward, so detection compares directly against this bound instead
 * of requiring a strictly decreasing spread.
 */
const FLAT_BELOW = 0.02;

/** Mean per-channel standard deviation over RGBA pixel bytes, normalized to [0, 1]. */
export function pictureSpread(pixels_N4: Uint8ClampedArray): number {
  const count = pixels_N4.length / 4;
  let spread = 0;
  for (let channel = 0; channel < COLOUR_CHANNELS; channel++) {
    let sum = 0;
    let squares = 0;
    for (let pixel = 0; pixel < count; pixel++) {
      const value = pixels_N4[pixel * 4 + channel] / 255;
      sum += value;
      squares += value * value;
    }
    const mean = sum / count;
    spread += Math.sqrt(Math.max(squares / count - mean * mean, 0));
  }
  return spread / COLOUR_CHANNELS;
}

/** Restart from the automaton's own initial state after two consecutive flat-field readings. */
export function startsAgain(spreadBefore: number | null, spreadNow: number): boolean {
  return spreadBefore !== null && spreadBefore < FLAT_BELOW && spreadNow < FLAT_BELOW;
}

/**
 * Select the automaton displayed on the entrance: use `choice` once loaded, keep `running` while
 * the next file downloads so cells relay smoothly, or fall back to the `choice` poster.
 */
export function entranceAutomaton(choice: MaterialEntry | null, file: Loaded<FigureMaterial>, running: Shown | null): Shown | null {
  if (!choice) return null;
  if (file.status === "ready") return { entry: choice, material: file.value };
  if (file.status === "loading" && running) return running;
  return { entry: choice, material: null };
}
