import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FigureMaterialFile } from "../../materials/material-file";
import { entryLoss, featuredInBlock, materialEntry, readMaterialIndex, type MaterialEntry } from "./material-index";

const FILE: FigureMaterialFile = JSON.parse(readFileSync(new URL("../../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8"));
const LABEL = { title: "", credit: "DinoDreamer project" };
const AT = "2026-11-02T20:00:00.000Z";

describe("an entry from a file", () => {
  it("names the start and the loss the file records, plain from noise when it records none", () => {
    const entry = materialEntry("plain-noise", FILE, LABEL, AT);
    expect([entry.start, entry.loss, entry.featured, entry.featuredInBlock]).toEqual(["noise", "plain", false, false]);
  });

  it("tells a centre disc from a seeded field by the start's background, and a guided rule by its loss kind", () => {
    const disc = { ...FILE, start: { kind: "centre-disc" as const, radius: 16 } };
    const field = { ...FILE, start: { kind: "centre-disc" as const, radius: 16, backgroundAmplitude: 0.25 } };
    const guided = { ...FILE, recipe: { ...FILE.recipe, settings: { ...FILE.recipe.settings, lossKind: "guided" as const } } };
    const margin = { ...FILE, recipe: { ...FILE.recipe, settings: { ...FILE.recipe.settings, lossKind: "plain-margin" as const } } };
    expect(materialEntry("disc", disc, LABEL, AT).start).toBe("centre-disc");
    expect(materialEntry("field", field, LABEL, AT).start).toBe("seeded-field");
    expect(materialEntry("guided", guided, LABEL, AT).loss).toBe("guided");
    expect(materialEntry("margin", margin, LABEL, AT).loss).toBe("plain");
  });
});

describe("the index's two featured levels and older entries", () => {
  const entry = materialEntry("one", FILE, LABEL, AT);

  it("reads an older entry without the loss or the group mark as plain and not featured", () => {
    const { loss: _loss, featuredInBlock: _mark, featured: _site, ...older } = entry;
    const read = readMaterialIndex({ entries: [older] }).entries[0]!;
    expect([entryLoss(read), featuredInBlock(read)]).toEqual(["plain", false]);
  });

  it("counts a site-featured entry as featured in its basis group", () => {
    expect(featuredInBlock({ featured: true })).toBe(true);
    expect(featuredInBlock({ featured: false, featuredInBlock: true })).toBe(true);
    expect(featuredInBlock({ featured: false, featuredInBlock: false })).toBe(false);
  });

  it("accepts the seeded field and refuses another start, loss or mark", () => {
    const field: MaterialEntry = { ...entry, start: "seeded-field", loss: "guided", featuredInBlock: true };
    expect(readMaterialIndex({ entries: [field] }).entries[0]!.start).toBe("seeded-field");
    expect(() => readMaterialIndex({ entries: [{ ...entry, start: "field" }] })).toThrow("invalid start");
    expect(() => readMaterialIndex({ entries: [{ ...entry, loss: "other" }] })).toThrow("invalid loss");
    expect(() => readMaterialIndex({ entries: [{ ...entry, featuredInBlock: "yes" }] })).toThrow("invalid featured-in-group mark");
  });
});
