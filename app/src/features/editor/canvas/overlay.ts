// Only the selected request shows its fields: the chosen term is filled, its sibling
// is outlined. Protect hatches its cells; Noise and a held token show the draft
// stroke. Nothing selected leaves a clean picture. Paint strength controls opacity;
// term weights and measured errors do not. Hovering the movement map adds its overlay.

import type { Area, Recipe } from "../../../recipe";
import { areaSize, findRequest, termArea, type AreaTerm } from "../model";
import { termInk, type InkTable } from "../inks";
import type { Selection } from "../state";

/** Fixed opacities: the selected area's fill and a cell at full movement. A field's edge is draw.ts FIELD_EDGE. */
export const OVERLAY_ALPHA = { fill: 0.35, movement: 0.85 } as const;

/** The share of its full opacity that a painted cell keeps, however faint its coat. */
const FAINTEST_SHOWN = 0.25;

/**
 * How strongly a painted cell shows, from 0 to 1: 0.25 + 0.75 × s for a strength s > 0
 * (s = percentage / 100), and 0 for an empty cell. A single 25 % coat stays visible, and a
 * denser coat still shows denser. The readout gives the number.
 */
export function shownStrength(percentage: number): number {
  if (percentage <= 0) return 0;
  return FAINTEST_SHOWN + (1 - FAINTEST_SHOWN) * (percentage / 100);
}

export interface AreaFill {
  area: Area;
  ink: string;
}

export interface AreaOutline {
  area: Area;
  ink: string;
}

export interface CanvasOverlay {
  /** The selected term's area. */
  fill?: AreaFill;
  /** The selected request's other term's area, when it has cells. */
  outlines: AreaOutline[];
  /** Protected cells to hatch; only while Protect is selected. */
  protect?: boolean[];
  /** Per-cell lightness from 0 to 1, laid over the image while the movement map is hovered. */
  movement?: Float32Array;
}

export interface OverlayExtras {
  /** The hovered movement map's lightness per cell (run/movement.ts). */
  movement?: Float32Array;
  /** The stroke in progress of Noise or of the held token, which edit no area; shown only while one of them is selected. */
  stroke?: AreaFill;
}

/** The overlay for one recipe and selection, with what the screen adds beyond the recipe. */
export function canvasOverlay(recipe: Recipe, selection: Selection | null, inks: InkTable, extras: OverlayExtras = {}): CanvasOverlay {
  const { movement, stroke } = extras;
  if (selection?.kind === "noise" || selection?.kind === "held") {
    const fill = stroke && areaSize(stroke.area) > 0 ? stroke : undefined;
    return { outlines: [], movement, fill };
  }
  if (selection?.kind === "protect") return { outlines: [], protect: recipe.protect, movement };
  const request = selection?.kind === "term" ? findRequest(recipe, selection.requestId) : undefined;
  if (selection?.kind !== "term" || !request) return { outlines: [], movement };
  const sibling: AreaTerm = selection.term === "respond" ? "look" : "respond";
  const siblingArea = termArea(request, sibling);
  return {
    outlines: areaSize(siblingArea) > 0 ? [{ area: siblingArea, ink: termInk(inks, request.id, sibling) }] : [],
    movement,
    fill: { area: termArea(request, selection.term), ink: termInk(inks, request.id, selection.term) },
  };
}
