import { describe, expect, test } from "vitest";
import { FIGURE_LAYOUT, FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import type { MaterialEntry } from "../gallery/material-index";
import { entryKind, kindLine, tileName } from "./kind-line";

function entry(changes: Partial<MaterialEntry>): MaterialEntry {
  return {
    id: "block-1-x",
    title: "1 · x",
    credit: "",
    publishedAt: "2026-10-23T00:00:00.000Z",
    materialId: "m",
    block: 1,
    recipe: "figure-2026-10-23",
    band: "strongest",
    strength: 2,
    winnerFraction: 1,
    fired: true,
    side: 128,
    seed: 1,
    tick: 600,
    engine: "e",
    trainerCommit: "t",
    layout: FIGURE_LAYOUT,
    start: "noise",
    pixelsPerCell: 1,
    ...changes,
  };
}

describe("automaton kind formatting", () => {
  test("maps layout and start to a MaterialKind", () => {
    expect(entryKind(entry({}))).toEqual({ rule: "cell", start: "noise" });
    expect(entryKind(entry({ layout: FIGURE_PYRAMID_LAYOUT, start: "centre-disc" }))).toEqual({
      rule: "pyramid",
      start: "centre-disc",
    });
  });

  test("formats short two-line tile labels", () => {
    expect(tileName(entry({}))).toEqual({ rule: "fine", start: "noise field" });
    expect(tileName(entry({ layout: FIGURE_PYRAMID_LAYOUT, start: "centre-disc" }))).toEqual({
      rule: "coarse + fine",
      start: "noise disc",
    });
    expect(tileName(entry({ pixelsPerCell: 2 }))).toEqual({ rule: "fine · 2 px", start: "noise field" });
  });

  test("formats the single-line kind description", () => {
    expect(kindLine(entry({ layout: FIGURE_PYRAMID_LAYOUT }))).toBe("coarse + fine · noise field");
    expect(kindLine(entry({ pixelsPerCell: 2, start: "centre-disc" }))).toBe("fine · 2 px per cell · noise disc");
  });
});
