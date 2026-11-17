import { describe, expect, it, test } from "vitest";
import type { MaterialEntry } from "../features/gallery/material-index";
import { brushAfterWheel, readingLine, recipeWord, stageZoom, variationName } from "./material-stage";
import { growVariationPath } from "./published-material";

const entry: MaterialEntry = {
  id: "block-12002-figure-strongest-seed-1", title: "12002 · strongest · seed 1", credit: "DinoDreamer project", publishedAt: "2026-10-23T00:00:00Z",
  materialId: "block-12002-figure-strongest-seed-1", block: 12002, recipe: "figure-2026-10-22", band: "strongest",
  strength: 2.387, winnerFraction: 1, fired: true, side: 128, seed: 2026102201, tick: 600, engine: "pytorch", trainerCommit: "9822ee64",
  layout: "figure-16-96-torus-v1", start: "noise", pixelsPerCell: 1, experiment: "E18",
};

describe("material stage wording", () => {
  it("names a variation without repeating its block", () => {
    expect(variationName(entry)).toBe("strongest · seed 1");
    expect(variationName({ ...entry, title: "Scales" })).toBe("Scales");
  });

  it("says in one line what the automaton was trained toward and what it reached", () => {
    expect(readingLine(entry)).toBe("Basis group 12002 · figure · trained toward a Level 4 reference patch · projection on the main direction 2.39 m · selection fraction 100% · selection target met");
    expect(readingLine({ ...entry, fired: false, winnerFraction: 0.266, strength: null }))
      .toBe("Basis group 12002 · figure · trained toward a Level 4 reference patch · selection fraction 27% · selection target not met");
  });

  it("names the stored value by what the rule's settings say it holds", () => {
    const seeded = { ...entry, recipe: "figure-seeded-2026-10-23", region: "centre-4x4" as const, strength: 1.433, experiment: "E21" };
    expect(readingLine(seeded))
      .toBe("Basis group 12002 · figure-seeded · trained toward a Level 4 reference patch · median response magnitude 1.43 m · central selection fraction 100% · selection target met");
    const { experiment: _, ...grownInTheBrowser } = entry;
    expect(readingLine(grownInTheBrowser)).toContain(" · projection on the main direction 2.39 m · ");
    expect(readingLine({ ...grownInTheBrowser, measurementDirection: "training target" })).toContain(" · projection on the target 2.39 m · ");
    expect(readingLine({ ...entry, experiment: "E99" })).toContain(" · recorded measurement 2.39 m · ");
  });

  it("sends 'Train another variation' to Train with the automaton's kind", () => {
    expect(growVariationPath(entry)).toBe("/train?block=12002&rule=cell&start=noise");
    expect(growVariationPath({ ...entry, layout: "figure-pyramid-16-96-torus-v1", start: "centre-disc" })).toBe("/train?block=12002&rule=pyramid&start=centre-disc");
    // A set method's place names its method; a place Train does not train leaves the default.
    expect(growVariationPath({ ...entry, gallery: { start: "noise", method: "token-distribution" } }))
      .toBe("/train?block=12002&rule=cell&start=noise&method=token-distribution");
    expect(growVariationPath({ ...entry, gallery: { start: "noise", method: "basis-group-mean-guided" } })).toBe("/train?block=12002&rule=cell&start=noise");
    expect(growVariationPath({ ...entry, pixelsPerCell: 2 })).toBe("/train?block=12002&rule=cell&start=noise");
  });

  it("names the recipe without its date", () => {
    expect(["figure-2026-10-22", "figure-pyramid-2026-10-23", "e1-fill"].map(recipeWord)).toEqual(["figure", "figure-pyramid", "e1-fill"]);
  });
});

describe("the stage's zoom: whole pixels per picture pixel", () => {
  test("the stage shows the largest zoom that fits the cells' room", () => {
    expect(stageZoom(128, 608)).toBe(4);
    expect(stageZoom(256, 608)).toBe(2);
    expect(stageZoom(128, 768)).toBe(6);
    expect(stageZoom(128, 300)).toBe(2);
  });

  test("a room smaller than the picture still shows it at one pixel per pixel", () => {
    expect(stageZoom(256, 200)).toBe(1);
  });
});

describe("the wheel over the stage sets the brush", () => {
  test("each notch steps the radius by the Brush slider's step, up larger, held to its ends", () => {
    expect(brushAfterWheel(12, 1)).toBe(13);
    expect(brushAfterWheel(12, -1)).toBe(11);
    expect(brushAfterWheel(32, 1)).toBe(32);
    expect(brushAfterWheel(2, -1)).toBe(2);
  });
});
