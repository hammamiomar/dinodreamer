// Where a finished stroke goes. A stroke painted with Noise selected does not edit the
// recipe: when it ends, its cells go to the worker as one re-seed (protocol.ts `reseed`)
// with a 32-bit seed drawn here, so the operation can be replayed from the run sequence.
// Every other selection's stroke is a numerical edit of the recipe (state.ts), where the
// lock rule decides whether it reaches one area of a request or both.

import type { Dispatch } from "react";
import type { Stroke } from "./model";
import type { EditorAction, Selection, StrokeTarget } from "./state";

/**
 * Whether erasing means something for the selection: it does for every area. Noise only
 * re-seeds what it paints, and the held token has no area until its first stroke.
 */
export function selectionErases(selection: Selection | null): boolean {
  return selection?.kind !== "noise" && selection?.kind !== "held";
}

/**
 * Whether the primary button (a finger) erases: the brush's Erase toggle does where
 * erasing means something. The toggle's setting is kept for the next area, but cannot suppress
 * a Noise stroke.
 */
export function primaryErasesFor(selection: Selection | null, touchErase: boolean): boolean {
  return touchErase && selectionErases(selection);
}

/** A fresh 32-bit seed for one re-seed stroke. */
export function drawReseedSeed(): number {
  const [seed] = crypto.getRandomValues(new Uint32Array(1));
  return seed;
}

export interface StrokeDelivery {
  dispatch: Dispatch<EditorAction>;
  reseed(cells: boolean[], seed: number): void;
  seed?(): number;
}

/** Delivers a finished stroke: the worker as a re-seed with Noise selected, else the recipe. */
export function deliverStroke(selection: Selection | null, stroke: Stroke, delivery: StrokeDelivery, target?: StrokeTarget): void {
  const { dispatch, reseed, seed = drawReseedSeed } = delivery;
  if (selection?.kind === "noise") {
    // Erasing has no meaning for a re-seed: only painted cells are sent.
    if (stroke.mode === "paint" && stroke.cells.some(Boolean)) reseed(stroke.cells.map(Boolean), seed());
    return;
  }
  dispatch({ type: "paintSelection", stroke, ...(target ? { target } : {}) });
}
