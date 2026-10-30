import { describe, expect, it } from "vitest";
import { CELLS, GRID } from "../../../recipe";
import { combineStroke, emptyArea } from "../model";
import {
  BRUSH_SIZES, DEFAULT_BRUSH, FOOTPRINT_GLYPH_SIDE, brushSizeAfterWheel, cellAt, clampBrushSize,
  clampBrushOpacity, dabCells, dabFootprint, footprintDeposit, footprintGlyph, paintSegment, quantizeDeposit,
  startStroke, strokeModeOfButton,
} from "./brush";

const at = (row: number, column: number) => row * GRID + column;
const point = { x: 8.5, y: 8.5 };
const low = { ...DEFAULT_BRUSH, opacity: 25 };

describe("round deposits", () => {
  it("uses size 3, full opacity and paint as the initial settings", () => {
    expect(DEFAULT_BRUSH).toEqual({ size: 3, opacity: 100, erasing: false });
    expect(dabCells(point, { size: 1 })).toEqual([at(8, 8)]);
  });

  it("deposits the specified smooth falloff and clips the edge without rescaling", () => {
    const dab = quantizeDeposit(startStroke(point, low));
    expect([7, 8, 9].map((row) => [7, 8, 9].map((column) => dab[at(row, column)]))).toEqual([[5, 13, 5], [13, 25, 13], [5, 13, 5]]);
    expect(dab[at(6, 8)]).toBe(0);
    const edge = quantizeDeposit(startStroke({ x: 0.1, y: 0.1 }, low));
    expect(edge.filter(Boolean)).toHaveLength(4);
    expect([edge[0], edge[1], edge[16], edge[17]]).toEqual([25, 13, 13, 5]);
  });

  it("keeps fast moves connected and retracing one gesture does not add coats", () => {
    const brush = { size: 1, opacity: 25 };
    const from = { x: 0.5, y: 4.5 };
    const to = { x: 15.5, y: 4.5 };
    const once = paintSegment(new Array<number>(CELLS).fill(0), from, to, brush);
    for (let column = 0; column < GRID; column++) expect(once[at(4, column)]).toBe(25);
    const retraced = paintSegment(once, to, from, brush);
    expect(retraced).toEqual(once);
    expect(retraced.filter(Boolean)).toHaveLength(GRID);
  });

  it("adds separate strokes, clips at 100, and erases by subtraction", () => {
    const cells = quantizeDeposit(startStroke(point, low));
    let field = emptyArea();
    for (const expected of [25, 50, 75, 100, 100]) {
      field = combineStroke(field, { mode: "paint", cells });
      expect(field[at(8, 8)]).toBe(expected);
    }
    field = combineStroke(field, { mode: "erase", cells });
    expect(field[at(8, 8)]).toBe(75);
    const empty = emptyArea();
    expect(combineStroke(empty, { mode: "erase", cells })).toBe(empty);
  });

  it("rounds half points up once, with no hidden carry and no zero-opacity edit", () => {
    expect(quantizeDeposit([0.49, 0.5, 1.49, 1.5])).toEqual([0, 1, 1, 2]);
    const empty = emptyArea();
    const zero = quantizeDeposit(startStroke(point, { ...low, opacity: 0 }));
    expect(combineStroke(empty, { mode: "paint", cells: zero })).toBe(empty);
    expect(clampBrushOpacity(101)).toBe(100);
    expect(clampBrushOpacity(-1)).toBe(0);
    expect(clampBrushOpacity(24.6)).toBe(25);
  });

  it("gives Boolean tools the full footprint before percentage rounding", () => {
    const continuous = startStroke(point, { size: 8, opacity: 100 });
    const selected = footprintDeposit(continuous);
    expect(selected.flatMap((value, cell) => value > 0 ? [cell] : [])).toEqual(dabCells(point, { size: 8 }));
    expect(selected.every((value) => value === 0 || value === 100)).toBe(true);
  });
});

describe("brush input", () => {
  it("paints with the left button, erases with the right and ignores the others", () => {
    expect(strokeModeOfButton(0)).toBe("paint");
    expect(strokeModeOfButton(2)).toBe("erase");
    expect(strokeModeOfButton(1)).toBeUndefined();
  });

  it("erases with the primary button while the touch Erase toggle is on", () => {
    expect(strokeModeOfButton(0, true)).toBe("erase");
    expect(strokeModeOfButton(2, true)).toBe("erase");
  });

  it("grows one cell per wheel notch up, shrinks per notch down, within the size range", () => {
    expect(brushSizeAfterWheel(3, -100)).toBe(4);
    expect(brushSizeAfterWheel(3, 4)).toBe(2);
    expect(brushSizeAfterWheel(3, 0)).toBe(3);
    expect(brushSizeAfterWheel(BRUSH_SIZES.max, -1)).toBe(BRUSH_SIZES.max);
    expect(brushSizeAfterWheel(BRUSH_SIZES.min, 1)).toBe(BRUSH_SIZES.min);
  });
});

describe("cellAt", () => {
  it("maps grid points to cells and rejects points outside", () => {
    expect(cellAt({ x: 15.99, y: 0 })).toEqual({ row: 0, column: 15 });
    expect(cellAt({ x: 16, y: 3 })).toBeUndefined();
    expect(cellAt({ x: -0.1, y: 3 })).toBeUndefined();
  });
});

describe("clampBrushSize", () => {
  it("keeps a typed size a whole number of cells from 1 to 9", () => {
    expect(clampBrushSize(12)).toBe(BRUSH_SIZES.max);
    expect(clampBrushSize(0)).toBe(BRUSH_SIZES.min);
    expect(clampBrushSize(-3)).toBe(BRUSH_SIZES.min);
    expect(clampBrushSize(2.6)).toBe(3);
    expect(clampBrushSize(5)).toBe(5);
  });
});

describe("brushHint", () => {
  it("offers erasing for every area and not for Noise, which only re-seeds", async () => {
    const { brushHint } = await import("./brush-palette");
    expect(brushHint(false, false, true)).toBe("left paints, right erases, wheel resizes");
    expect(brushHint(false, true, true)).toBe("left paints, right erases, wheel resizes while painting");
    expect(brushHint(false, false, false, false)).toBe("left re-seeds, wheel resizes");
    expect(brushHint(false, true, false, false)).toBe("left re-seeds, wheel resizes while painting");
    expect(brushHint(true, false, false, false)).toBe("a finger re-seeds");
    expect(brushHint(true, false, true)).toBe("a finger paints; Erase makes it erase");
  });
});

describe("the footprint the canvas and the palette show", () => {
  it("shows at each touched cell exactly what one dab writes there, clipped at the edge as the dab is", () => {
    const nearEdge = { x: 7.3, y: 0.6 };
    for (const size of [1, 3, 5, 9]) {
      for (const opacity of [100, 30, 0]) {
        const written = quantizeDeposit(startStroke(nearEdge, { size, opacity }));
        const footprint = dabFootprint(nearEdge, { size, opacity }, false);
        expect(footprint.map((entry) => entry.cell).sort((a, b) => a - b)).toEqual(dabCells(nearEdge, { size }).sort((a, b) => a - b));
        for (const { cell, deposit } of footprint) expect(deposit, `size ${size}, opacity ${opacity}, cell ${cell}`).toBe(written[cell]);
      }
    }
  });

  it("selects the whole footprint for Protect and Noise, whatever the opacity", () => {
    expect(dabFootprint(point, { size: 5, opacity: 30 }, true).every((entry) => entry.deposit === 100)).toBe(true);
  });

  it("draws size 1 as one cell and size 3 as the 3 × 3 square at its falloff, in the glyph's 9 × 9 cells", () => {
    const glyphAt = (glyph: number[], row: number, column: number) => glyph[row * FOOTPRINT_GLYPH_SIDE + column]!;
    const one = footprintGlyph(1);
    expect(one.filter((falloff) => falloff > 0)).toEqual([1]);
    expect(glyphAt(one, 4, 4)).toBe(1);
    const three = footprintGlyph(3);
    expect(three.filter((falloff) => falloff > 0)).toHaveLength(9);
    expect([glyphAt(three, 4, 4), glyphAt(three, 3, 4), glyphAt(three, 3, 3)].map((falloff) => Number(falloff.toFixed(3)))).toEqual([1, 0.5, 0.207]);
  });

  it("holds the largest brush whole: the glyph's cells are the dab's cells away from any edge", () => {
    for (const size of [1, 3, 5, 7, BRUSH_SIZES.max]) {
      expect(footprintGlyph(size).filter((falloff) => falloff > 0)).toHaveLength(dabCells(point, { size }).length);
    }
  });
});
