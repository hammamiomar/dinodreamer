import { describe, expect, it } from "vitest";
import { CELLS, GRID, patchSlot, type Recipe, type Token } from "../../../recipe";
import type { InkTable } from "../inks";
import { applyAreaStroke, createRecipe, createRequest, setProtect } from "../model";
import { cellReadout } from "./cell-readout";

const handoff = (token: Token) => ({ token, block: 1398, code: [0.4, -0.2, 0.9] as [number, number, number] });
const CENTRE = { row: 4, column: 11 };
const AT = CENTRE.row * GRID + CENTRE.column;
const PAIR = { code: "oklch(66% 0.170 293.5)", look: "oklch(86% 0.120 323.5)" };
const INKS: InkTable = { pairs: new Map([[1, PAIR]]), defaults: [PAIR] };

/** One patch request painted at row 4, column 11 (100 % in both fields), with 25 % more Appearance one cell to the right. */
function oneRequest(): Recipe {
  const recipe = createRequest(createRecipe("pass-003"), handoff({ imageId: 7, role: "patch", slot: patchSlot(2, 8) }), CENTRE);
  const deposit = new Array<number>(CELLS).fill(0);
  deposit[AT + 1] = 25;
  return applyAreaStroke(recipe, 1, "look", { mode: "paint", cells: deposit });
}

describe("cellReadout", () => {
  it("names the cell from 1 at the top left and both of the request's fields, Code first, each in its ink", () => {
    const recipe = oneRequest();
    const code = recipe.requests[0]!.respondLike.where[AT + 1]!;
    const look = recipe.requests[0]!.lookLike.where[AT + 1]!;
    expect(look).toBe(code + 25);
    // The brush paints Appearance; Code is read beside it.
    expect(cellReadout(recipe, { kind: "term", requestId: 1, term: "look" }, INKS, { row: 4, column: 12 }, undefined)).toEqual({
      column: 13,
      row: 5,
      fields: [
        { name: "Response", percentage: code, ink: PAIR.code },
        { name: "Appearance", percentage: look, ink: PAIR.look },
      ],
      protect: null,
      codeError: null,
    });
  });

  it("carries the measured Code error at the cell", () => {
    const readout = cellReadout(oneRequest(), { kind: "term", requestId: 1, term: "respond" }, INKS, CENTRE, 0.25);
    expect(readout?.fields.map((field) => field.percentage)).toEqual([100, 100]);
    expect(readout?.codeError).toBe(0.25);
  });

  it("shows only Appearance for a CLS request, which has no Code field", () => {
    const recipe = createRequest(createRecipe("pass-003"), handoff({ imageId: 9, role: "cls", slot: 0 }), CENTRE);
    expect(cellReadout(recipe, { kind: "term", requestId: 1, term: "look" }, INKS, CENTRE, undefined)?.fields.map((field) => field.name)).toEqual(["Appearance"]);
  });

  it("reads Protect as protected or free, and names the cell alone for Noise and the held token", () => {
    const protect = new Array<boolean>(CELLS).fill(false);
    protect[AT] = true;
    const recipe = setProtect(oneRequest(), protect);
    expect(cellReadout(recipe, { kind: "protect" }, INKS, CENTRE, undefined)).toEqual({ column: 12, row: 5, fields: [], protect: true, codeError: null });
    expect(cellReadout(recipe, { kind: "protect" }, INKS, { row: 0, column: 0 }, undefined)?.protect).toBe(false);
    expect(cellReadout(recipe, { kind: "noise" }, INKS, CENTRE, undefined)).toEqual({ column: 12, row: 5, fields: [], protect: null, codeError: null });
  });

  it("is empty off the canvas, without a selection, and for a request that is gone", () => {
    const recipe = oneRequest();
    expect(cellReadout(recipe, { kind: "term", requestId: 1, term: "respond" }, INKS, undefined, undefined)).toBeNull();
    expect(cellReadout(recipe, null, INKS, CENTRE, undefined)).toBeNull();
    expect(cellReadout(recipe, { kind: "term", requestId: 2, term: "look" }, INKS, CENTRE, undefined)).toBeNull();
  });
});
