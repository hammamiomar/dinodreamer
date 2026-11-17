import { describe, expect, test } from "vitest";
import { FIGURE_LAYOUT, FIGURE_PYRAMID_LAYOUT } from "../materials/material-file";
import type { MaterialEntry } from "../features/gallery/material-index";
import { metadataRows } from "./material-metadata";

function entry(changes: Partial<MaterialEntry>): MaterialEntry {
  return {
    id: "block-1-x", title: "1 · pyramid · strongest · seed 0", credit: "", publishedAt: "2026-10-23T00:00:00.000Z", materialId: "m", block: 1, recipe: "figure-2026-10-23",
    band: "strongest", strength: 1.1399, winnerFraction: 0.9375, fired: true, side: 128, seed: 1, tick: 600, engine: "e", trainerCommit: "t",
    layout: FIGURE_LAYOUT, start: "noise", pixelsPerCell: 1, ...changes,
  };
}

describe("the metadata table", () => {
  test("says the automaton in the site's words, never the file's research name", () => {
    const rows = metadataRows(entry({ layout: FIGURE_PYRAMID_LAYOUT, start: "centre-disc", region: "centre-4x4", measurementDirection: "training target" }), 800);
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Grids", "coarse + fine"],
      ["Start", "central noise"],
      ["Asked for", "basis-group mean matching"],
      ["Reference patch", "Level 4"],
      ["Projection on the target", "1.14 m"],
      ["Central selection fraction", "94%"],
      ["Selection target", "met"],
      ["Updates", "800"],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/pyramid|strongest|seed/);
  });

  test("leads with a title of the person's own, and leaves out what was not measured", () => {
    const rows = metadataRows(entry({ strength: null, winnerFraction: null, fired: false }), 1250, "Garden at dusk");
    expect(rows[0]).toEqual({ label: "Title", value: "Garden at dusk" });
    expect(rows.map((row) => row.label)).toEqual(["Title", "Grids", "Start", "Asked for", "Reference patch", "Selection target", "Updates"]);
    expect(rows.at(-2)).toEqual({ label: "Selection target", value: "not met" });
    expect(rows.at(-1)).toEqual({ label: "Updates", value: "1,250" });
  });

  test("says the place the entry carries: a start and a method the file's own fields cannot tell", () => {
    const rows = metadataRows(entry({ start: "centre-disc", gallery: { start: "circle-anywhere", method: "token-distribution" } }), 1000);
    expect(rows.slice(1, 3).map((row) => row.value)).toEqual(["a circle placed anywhere", "token distribution matching"]);
  });
});
