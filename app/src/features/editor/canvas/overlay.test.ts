import { describe, expect, it } from "vitest";
import { CELLS, patchSlot, type Recipe, type Token } from "../../../recipe";
import { applyAreaStroke, applyProtectStroke, createRecipe, createRequest, setTermEnabled, setTermWeight } from "../model";
import { NO_INK_CHOICES, inkTable, termInk } from "../inks";
import { defaultInkPairs, palette } from "../presentation";
import type { Selection } from "../state";
import { canvasOverlay, type OverlayExtras } from "./overlay";

/** The default tones of a recipe's requests (inks.ts), as the editor session builds them with no picks. */
const inksOf = (recipe: Recipe) => inkTable(recipe, NO_INK_CHOICES, () => true, defaultInkPairs());
const overlayOf = (recipe: Recipe, selection: Selection | null, extras?: OverlayExtras) => canvasOverlay(recipe, selection, inksOf(recipe), extras);
const requestInk = (recipe: Recipe, requestId: number) => termInk(inksOf(recipe), requestId, "respond");
const lookInk = (recipe: Recipe, requestId: number) => termInk(inksOf(recipe), requestId, "look");

const patch = (imageId: number, row: number, column: number): Token => ({ imageId, role: "patch", slot: patchSlot(row, column) });
const handoff = (token: Token) => ({ token, block: 1398, code: [0.4, -0.2, 0.9] as [number, number, number] });

function cells(list: number[]): number[] {
  const area = new Array<number>(CELLS).fill(0);
  for (const cell of list) area[cell] = 100;
  return area;
}

/** Two patch requests; request 1's Appearance area also holds cell 0, so its two areas differ. */
function twoRequests(): Recipe {
  let recipe = createRequest(createRecipe("pass-003"), handoff(patch(7, 2, 8)));
  recipe = createRequest(recipe, handoff(patch(8, 10, 10)));
  recipe = applyAreaStroke(recipe, 1, "look", { mode: "paint", cells: cells([0]) });
  return applyProtectStroke(recipe, { mode: "paint", cells: cells([255]) });
}

describe("canvasOverlay", () => {
  it("draws no field when nothing is selected: the clean picture", () => {
    const overlay = overlayOf(twoRequests(), null);
    expect(overlay).toEqual({ outlines: [], movement: undefined });
  });

  it("fills the selected term and keeps only its sibling's edge, in the two tones of its request; no other request's field", () => {
    const recipe = twoRequests();
    const overlay = overlayOf(recipe, { kind: "term", requestId: 1, term: "look" });
    const [first] = recipe.requests;
    expect(overlay.fill?.area).toBe(first.lookLike.where);
    expect(overlay.fill?.ink).toBe(lookInk(recipe, 1));
    expect(overlay.outlines).toEqual([{ area: first.respondLike.where, ink: requestInk(recipe, 1) }]);
    expect(overlay.protect).toBeUndefined();
    // The two tones of one request differ, so its Code and Appearance areas read apart.
    expect(lookInk(recipe, 1)).not.toBe(requestInk(recipe, 1));
    const second = overlayOf(recipe, { kind: "term", requestId: 2, term: "respond" });
    expect(second.fill?.area).toBe(recipe.requests[1].respondLike.where);
    expect(second.outlines.map((outline) => outline.area)).toEqual([recipe.requests[1].lookLike.where]);
  });

  it("keeps stored strength in the fill without mixing in measured Code error", () => {
    const recipe = twoRequests();
    recipe.requests[0].respondLike.where[0] = 1;
    const fill = overlayOf(recipe, { kind: "term", requestId: 1, term: "respond" }).fill!;
    expect(fill.area[0]).toBe(1);
    expect(Object.keys(fill).sort()).toEqual(["area", "ink"]);
  });

  it("draws no outline for an empty area: a CLS request's Code", () => {
    const recipe = createRequest(createRecipe("pass-003"), handoff({ imageId: 9, role: "cls", slot: 0 }));
    const overlay = overlayOf(recipe, { kind: "term", requestId: 1, term: "look" });
    expect(overlay.fill).toBeDefined();
    expect(overlay.outlines).toHaveLength(0);
  });

  it("hatches Protect while Protect is selected, and shows no request's field", () => {
    const recipe = twoRequests();
    const overlay = overlayOf(recipe, { kind: "protect" });
    expect(overlay.protect).toBe(recipe.protect);
    expect(overlay.fill).toBeUndefined();
    expect(overlay.outlines).toHaveLength(0);
  });

  it("does not encode the weight or the switch", () => {
    const recipe = twoRequests();
    const selection = { kind: "term", requestId: 1, term: "look" } as const;
    const heavy = setTermWeight(recipe, "request:1:look", 2);
    const off = setTermEnabled(recipe, "request:1:look", false);
    expect(overlayOf(heavy, selection)).toEqual(overlayOf(recipe, selection));
    expect(overlayOf(off, selection)).toEqual(overlayOf(recipe, selection));
  });

  it("lays the hovered movement map over every cell, under the areas, whatever is selected", () => {
    const recipe = twoRequests();
    const movement = new Float32Array(CELLS).fill(0.25);
    const plain = overlayOf(recipe, null, { movement });
    expect(plain.movement).toBe(movement);
    expect(plain.outlines).toHaveLength(0);
    const withSelection = overlayOf(recipe, { kind: "term", requestId: 1, term: "look" }, { movement });
    expect(withSelection.movement).toBe(movement);
    expect(withSelection.fill?.area).toEqual(recipe.requests[0].lookLike.where);
    expect(overlayOf(recipe, null).movement).toBeUndefined();
  });

  it("fills the Noise stroke in progress in the accent and shows no request's field; nothing of it is in the recipe", () => {
    const recipe = twoRequests();
    const stroke = { area: cells([5, 6]).map((inside) => inside ? 100 : 0), ink: palette().ask };
    const overlay = overlayOf(recipe, { kind: "noise" }, { stroke });
    expect(overlay.fill).toEqual(stroke);
    expect(overlay.outlines).toHaveLength(0);
    expect(overlay.protect).toBeUndefined();
    expect(overlayOf(recipe, { kind: "noise" }).fill).toBeUndefined();
    expect(overlayOf(recipe, { kind: "noise" }, { stroke: { area: cells([]).map((inside) => inside ? 100 : 0), ink: palette().ask } }).fill).toBeUndefined();
  });

  it("fills the held token's first stroke in its ink, and nothing before the stroke", () => {
    const recipe = twoRequests();
    const stroke = { area: cells([40, 41]).map((inside) => inside ? 100 : 0), ink: palette().inks[2] };
    expect(overlayOf(recipe, { kind: "held" }, { stroke }).fill).toEqual(stroke);
    expect(overlayOf(recipe, { kind: "held" }).fill).toBeUndefined();
    expect(overlayOf(recipe, { kind: "held" }).outlines).toHaveLength(0);
  });
});
