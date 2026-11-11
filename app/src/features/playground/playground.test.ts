import { describe, expect, test } from "vitest";
import { FIGURE_LAYOUT, FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import { materialsByBlock, type MaterialEntry } from "../gallery/material-index";
import { choiceRows, chosenWord, EVERY_MATERIAL, familiesPresent, familyName, featuredMaterials, firstToPlay, keptByChoices, kindLine, materialToPlay, tileName, tileReading } from "./playground";

function entry(changes: Partial<MaterialEntry>): MaterialEntry {
  return {
    id: "block-1-x", title: "1 · x", credit: "", publishedAt: "2026-10-23T00:00:00.000Z", materialId: "m", block: 1, recipe: "figure-2026-10-23",
    band: "strongest", strength: 2, winnerFraction: 1, fired: true, side: 128, seed: 1, tick: 600, engine: "e", trainerCommit: "t",
    layout: FIGURE_LAYOUT, start: "noise", pixelsPerCell: 1, ...changes,
  };
}

describe("a material's words", () => {
  test("a tile names the grids over the start, each short enough for 128 px", () => {
    expect(tileName(entry({}))).toEqual({ rule: "fine", start: "noise" });
    expect(tileName(entry({ layout: FIGURE_PYRAMID_LAYOUT, start: "centre-disc" }))).toEqual({ rule: "coarse + fine", start: "central noise" });
    expect(tileName(entry({ pixelsPerCell: 2 }))).toEqual({ rule: "fine · 2 px", start: "noise" });
  });

  test("the head says the kind on one line", () => {
    expect(kindLine(entry({ layout: FIGURE_PYRAMID_LAYOUT }))).toBe("coarse + fine · noise");
    expect(kindLine(entry({ pixelsPerCell: 2, start: "centre-disc" }))).toBe("fine · 2 px per cell · central noise");
  });

  test("under a tile: the stored value in m it reached, met or not; the dimming tells a missed target", () => {
    expect(tileReading(entry({ strength: 1.5849 }))).toBe("1.58 m");
    expect(tileReading(entry({ fired: false, strength: 0.86 }))).toBe("0.86 m");
    expect(tileReading(entry({ fired: false, strength: null }))).toBe("");
  });
});

describe("the choices", () => {
  const fine = entry({ id: "a" });
  const pyramidSeeded = entry({ id: "b", layout: FIGURE_PYRAMID_LAYOUT, start: "centre-disc" });

  test("keep everything by default", () => {
    expect(keptByChoices(fine, EVERY_MATERIAL, undefined)).toBe(true);
    expect(keptByChoices(pyramidSeeded, EVERY_MATERIAL, "local")).toBe(true);
  });

  test("keep by rule, by start and by the block's family, together", () => {
    expect(keptByChoices(fine, { ...EVERY_MATERIAL, rule: "pyramid" }, "local")).toBe(false);
    expect(keptByChoices(pyramidSeeded, { ...EVERY_MATERIAL, rule: "pyramid" }, "local")).toBe(true);
    expect(keptByChoices(pyramidSeeded, { ...EVERY_MATERIAL, rule: "pyramid", start: "noise" }, "local")).toBe(false);
    expect(keptByChoices(fine, { ...EVERY_MATERIAL, family: "surround" }, "local")).toBe(false);
    expect(keptByChoices(fine, { ...EVERY_MATERIAL, family: "surround" }, "surround")).toBe(true);
  });

  test("a block without a family record is unknown", () => {
    expect(keptByChoices(fine, { ...EVERY_MATERIAL, family: "unknown" }, undefined)).toBe(true);
    expect(keptByChoices(fine, { ...EVERY_MATERIAL, family: "local" }, undefined)).toBe(false);
  });
});

describe("the choices' line", () => {
  test("has a rule, a start and a family row, Any first, the response categories as the Index names them", () => {
    const [rule, start, family] = choiceRows(["local", "unknown"]);
    expect(rule.options.map((option) => option.value)).toEqual(["all", "cell", "pyramid"]);
    expect(start.options.map((option) => option.label)).toEqual(["Any", "noise", "central noise"]);
    expect(family.options.map((option) => option.label)).toEqual(["Any", "Own-token", "Unmeasured"]);
  });

  test("shows each row's chosen word, any when nothing is chosen", () => {
    const [rule, , family] = choiceRows(["surround"]);
    expect(chosenWord(rule, "all")).toBe("any");
    expect(chosenWord(rule, "pyramid")).toBe("coarse + fine");
    expect(chosenWord(family, "surround")).toBe("Distant-patch");
  });
});

describe("the family choice", () => {
  test("names a response category as the Index does, and an unknown one by its own word", () => {
    expect(familyName("surround")).toBe("Distant-patch");
    expect(familyName("a-new-family")).toBe("a-new-family");
  });

  test("offers the families present once each, in the Index's order, a block without a record as unknown", () => {
    const entries = [entry({ id: "a", block: 1 }), entry({ id: "b", block: 2 }), entry({ id: "c", block: 3 }), entry({ id: "d", block: 4 })];
    const families = new Map([[1, "surround"], [2, "a-new-family"], [3, "local"]]);
    expect(familiesPresent(entries, families)).toEqual(["local", "surround", "unknown", "a-new-family"]);
  });
});

describe("the Featured group", () => {
  test("is empty when no material is featured, an absent mark counting as not featured", () => {
    expect(featuredMaterials([entry({ id: "a" }), entry({ id: "b", featured: false })])).toEqual([]);
    expect(featuredMaterials([])).toEqual([]);
  });

  test("holds the featured materials in the index's order, not the blocks' order", () => {
    const index = [
      entry({ id: "newest", block: 9, featured: true }),
      entry({ id: "plain", block: 1 }),
      entry({ id: "older", block: 2, featured: true }),
      entry({ id: "oldest", block: 9, featured: true, fired: false }),
    ];
    expect(featuredMaterials(index).map((material) => material.id)).toEqual(["newest", "older", "oldest"]);
  });

  test("never holds a hidden material", () => {
    const index = [entry({ id: "shown", featured: true }), entry({ id: "hidden", featured: true })];
    expect(featuredMaterials(index, new Set(["hidden"])).map((material) => material.id)).toEqual(["shown"]);
    expect(featuredMaterials(index, new Set(["shown", "hidden"]))).toEqual([]);
  });
});

describe("what plays first", () => {
  test("is the first material that fired, else the first at all, else nothing", () => {
    expect(firstToPlay([entry({ id: "a", fired: false }), entry({ id: "b" })])?.id).toBe("b");
    expect(firstToPlay([entry({ id: "a", fired: false })])?.id).toBe("a");
    expect(firstToPlay([])).toBeNull();
  });

  test("is the material the address names, kept or published, else the first kept for Yours, else the first that fired", () => {
    const kept = [entry({ id: "mine" })];
    const published = [entry({ id: "a", fired: false }), entry({ id: "b" })];
    expect(materialToPlay({ id: "a", yoursFirst: false }, kept, published)?.id).toBe("a");
    expect(materialToPlay({ id: "mine", yoursFirst: false }, kept, published)?.id).toBe("mine");
    expect(materialToPlay({ id: null, yoursFirst: true }, kept, published)?.id).toBe("mine");
    expect(materialToPlay({ id: null, yoursFirst: true }, [], published)?.id).toBe("b");
    expect(materialToPlay({ id: "gone", yoursFirst: false }, kept, published)?.id).toBe("b");
  });
});

describe("the blocks of the index", () => {
  test("come in number order, each with its fired materials first", () => {
    const index = { entries: [entry({ id: "c", block: 9, fired: false }), entry({ id: "a", block: 2 }), entry({ id: "b", block: 9 })] };
    expect(materialsByBlock(index).map(({ block, materials }) => [block, materials.map((material) => material.id)])).toEqual([
      [2, ["a"]],
      [9, ["b", "c"]],
    ]);
  });
});
