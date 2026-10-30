import { describe, expect, test } from "vitest";
import { FIGURE_LAYOUT, FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import type { MaterialEntry } from "../gallery/material-index";
import { kindWords, nextSeed, REGROW_AT_TICK, strokeOnTorus, tiledCanvas } from "./home-material";

function entry(changes: Partial<MaterialEntry>): MaterialEntry {
  return {
    id: "block-1-x", title: "1 · x", credit: "", publishedAt: "2026-10-23T00:00:00.000Z", materialId: "m", block: 1, recipe: "figure-2026-10-23",
    band: "strongest", strength: 2, winnerFraction: 1, fired: true, side: 128, seed: 1, tick: 600, engine: "e", trainerCommit: "t",
    layout: FIGURE_LAYOUT, start: "noise", pixelsPerCell: 1, ...changes,
  };
}

describe("the home's material", () => {
  test("regrows after a seeded figure has had time to dissolve, from the next seed", () => {
    expect(REGROW_AT_TICK).toBe(2000);
    expect(nextSeed(1)).toBe(2);
    expect(nextSeed(0xffffffff)).toBe(0);
  });
});

describe("the kind in words", () => {
  test("names the grids in Train's words, then the start", () => {
    expect(kindWords(entry({}))).toBe("fine automaton, from noise");
    expect(kindWords(entry({ start: "centre-disc" }))).toBe("fine automaton, from central noise");
    expect(kindWords(entry({ layout: FIGURE_PYRAMID_LAYOUT, start: "centre-disc" }))).toBe("coarse + fine automaton, from central noise");
    expect(kindWords(entry({ pixelsPerCell: 2 }))).toBe("fine automaton at 2 px per cell, from noise");
  });
});

describe("the tiled field", () => {
  test("is the field's size in device pixels, with whole device pixels per cell held to the replay's 1 to 8", () => {
    expect(tiledCanvas(1440, 512, 4, 2)).toEqual({ width: 2880, height: 1024, scale: 8 });
    expect(tiledCanvas(390, 384, 2, 3)).toEqual({ width: 1170, height: 1152, scale: 6 });
    // A dense screen would want 12 device pixels per cell; the replay draws at most 8.
    expect(tiledCanvas(1440, 512, 4, 3).scale).toBe(8);
    expect(tiledCanvas(0.2, 0.2, 0.1, 1)).toEqual({ width: 1, height: 1, scale: 1 });
  });

  test("brushes a segment that crosses a tile's edge as one short stroke on the torus, not across the grid", () => {
    // From the second tile's last cells to the third tile's first: shifted together by one tile.
    expect(strokeOnTorus({ x: 255, y: 10 }, { x: 258, y: 12 }, 128)).toEqual({ x0: 127, y0: 10, x1: 130, y1: 12 });
    expect(strokeOnTorus({ x: 5, y: 300 }, { x: 4, y: 301 }, 128)).toEqual({ x0: 5, y0: 44, x1: 4, y1: 45 });
    expect(strokeOnTorus({ x: 64, y: 64 }, { x: 70, y: 60 }, 128)).toEqual({ x0: 64, y0: 64, x1: 70, y1: 60 });
  });
});
