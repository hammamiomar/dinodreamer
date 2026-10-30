// One round brush on the 16 × 16 grid. A gesture keeps the maximum dab at each
// cell. The completed deposit is rounded once, then model.ts adds or subtracts it.

import type { StepRule } from "../cards/stepping";
import { CELLS, GRID, type Area } from "../../../recipe";
import type { BrushMode } from "../model";

export interface GridPoint {
  x: number;
  y: number;
}

/** Shared editor settings, never saved in a recipe. Opacity is a percentage. */
export interface Brush {
  size: number;
  opacity: number;
  erasing: boolean;
}

export const BRUSH_SIZES = { min: 1, max: 9, initial: 3 } as const;
export const BRUSH_OPACITY = { min: 0, max: 100, initial: 100, step: 5 } as const;
export const DEFAULT_BRUSH: Brush = { size: BRUSH_SIZES.initial, opacity: BRUSH_OPACITY.initial, erasing: false };

/** The brush's steppers: size by 1; opacity by 5 %, with Shift by a quarter. */
export const BRUSH_SIZE_STEPS: StepRule = { step: 1, largeStep: 1, min: BRUSH_SIZES.min, max: BRUSH_SIZES.max };
export const BRUSH_OPACITY_STEPS: StepRule = { step: BRUSH_OPACITY.step, largeStep: 25, min: BRUSH_OPACITY.min, max: BRUSH_OPACITY.max };

/** Half-cell spacing keeps fast pointer movement connected. */
const DAB_SPACING = 0.5;

export function strokeModeOfButton(button: number, primaryErases = false): BrushMode | undefined {
  if (button === 0) return primaryErases ? "erase" : "paint";
  if (button === 2) return "erase";
  return undefined;
}

export function brushSizeAfterWheel(size: number, deltaY: number): number {
  if (deltaY === 0) return size;
  return clampBrushSize(deltaY < 0 ? size + 1 : size - 1);
}

export function clampBrushSize(size: number): number {
  return Math.min(BRUSH_SIZES.max, Math.max(BRUSH_SIZES.min, Math.round(size)));
}

export function clampBrushOpacity(opacity: number): number {
  return Math.min(BRUSH_OPACITY.max, Math.max(BRUSH_OPACITY.min, Math.round(opacity)));
}

/** Fixed smooth falloff; distance and radius are in cell units. */
export function roundFalloff(distance: number, size: number): number {
  const t = Math.min(1, distance / ((size + 1) / 2));
  return 1 - 3 * t * t + 2 * t * t * t;
}

/** Positive round footprint, independent of opacity: the cells a Boolean tool (Protect, Noise) selects. */
export function dabCells(point: GridPoint, brush: Pick<Brush, "size">): number[] {
  return dabValues(point, brush.size).map(({ cell }) => cell);
}

/** The cells one dab touches around `point`'s cell, each with its falloff (1 at the centre cell), clipped at the edge. */
export function dabValues(point: GridPoint, size: number): { cell: number; falloff: number }[] {
  const centreRow = clampCell(Math.floor(point.y));
  const centreColumn = clampCell(Math.floor(point.x));
  const radius = (size + 1) / 2;
  const reach = Math.ceil(radius) - 1;
  const values: { cell: number; falloff: number }[] = [];
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const row = centreRow + dr;
      const column = centreColumn + dc;
      const distance = Math.hypot(dr, dc);
      if (row < 0 || row >= GRID || column < 0 || column >= GRID || distance >= radius) continue;
      values.push({ cell: row * GRID + column, falloff: roundFalloff(distance, size) });
    }
  }
  return values;
}

/**
 * What one dab at `point` would write at each cell it touches, in percent: the rounded deposit
 * (opacity × falloff, as quantizeDeposit rounds it) for a brush that paints strength, 100 for
 * a tool that selects the whole footprint (Protect, Noise). The canvas outlines these cells.
 */
export function dabFootprint(point: GridPoint, brush: Pick<Brush, "size" | "opacity">, selects: boolean): { cell: number; deposit: number }[] {
  return dabValues(point, brush.size).map(({ cell, falloff }) => ({
    cell,
    deposit: selects ? 100 : Math.floor(brush.opacity * falloff + 0.5),
  }));
}

/** The palette's size glyph: the 9 × 9 cells around a dab's centre, the largest brush's whole reach. */
export const FOOTPRINT_GLYPH_SIDE = 9;

/** The falloff of each cell of the size glyph, row-major, 0 outside the footprint: the brush's shape and soft edge. */
export function footprintGlyph(size: number): number[] {
  const reach = (FOOTPRINT_GLYPH_SIDE - 1) / 2;
  const glyph = new Array<number>(FOOTPRINT_GLYPH_SIDE * FOOTPRINT_GLYPH_SIDE).fill(0);
  // A dab at the grid cell (reach, reach): its cells' rows and columns are the glyph's, unclipped.
  for (const { cell, falloff } of dabValues({ x: reach + 0.5, y: reach + 0.5 }, size)) {
    glyph[Math.floor(cell / GRID) * FOOTPRINT_GLYPH_SIDE + (cell % GRID)] = falloff;
  }
  return glyph;
}

/** Continuous percentages accumulated by maximum, not addition, within a gesture. */
export function paintSegment(deposit: number[], from: GridPoint, to: GridPoint, brush: Pick<Brush, "size" | "opacity">): number[] {
  const next = deposit.slice();
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const dabs = Math.max(1, Math.ceil(distance / DAB_SPACING));
  for (let dab = 0; dab <= dabs; dab++) {
    const t = dab / dabs;
    const point = { x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) };
    for (const { cell, falloff } of dabValues(point, brush.size)) {
      next[cell] = Math.max(next[cell], brush.opacity * falloff);
    }
  }
  return next;
}

export function startStroke(point: GridPoint, brush: Pick<Brush, "size" | "opacity">): number[] {
  return paintSegment(new Array<number>(CELLS).fill(0), point, point, brush);
}

/** The same rounded deposit is used for preview and commit. No fractional carry remains. */
export function quantizeDeposit(deposit: number[]): Area {
  return deposit.map((value) => Math.floor(value + 0.5));
}

/** Protect and Noise select the whole positive footprint, regardless of brush opacity. */
export function footprintDeposit(deposit: number[]): Area {
  return deposit.map((value) => value > 0 ? 100 : 0);
}

export function cellAt(point: GridPoint): { row: number; column: number } | undefined {
  if (point.x < 0 || point.y < 0 || point.x >= GRID || point.y >= GRID) return undefined;
  return { row: Math.floor(point.y), column: Math.floor(point.x) };
}

function clampCell(value: number): number {
  return Math.min(GRID - 1, Math.max(0, value));
}
