import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FigureMaterialFile } from "../../materials/material-file";
import { entryLoss, featuredInBlock, materialEntry, placeOf, readMaterialIndex, type MaterialEntry } from "./material-index";

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

describe("an entry from a set method's file", () => {
  const set = { source: "selection", neighbourhood: "3x3", pictures: [{ imageId: 3536804379159069, patch: 69 }] };
  const trained = (method: string, extra: Record<string, unknown> = {}, start?: FigureMaterialFile["start"]): FigureMaterialFile => ({
    ...FILE, ...(start ? { start } : {}),
    recipe: { ...FILE.recipe, settings: { ...FILE.recipe.settings, method, set, ...extra } as FigureMaterialFile["recipe"]["settings"] },
  });

  it("files it in its method's column and never names the request's loss", () => {
    const entry = materialEntry("tokens", trained("token-distribution", { layers: ["block-3", "final"] }), LABEL, AT);
    expect(entry.gallery).toEqual({ start: "noise", method: "token-distribution" });
    expect(entry).not.toHaveProperty("loss");
    expect(placeOf(entry)).toEqual({ start: "noise", method: "token-distribution" });
    const disc = materialEntry("codes", trained("basis-group-distribution", {}, { kind: "centre-disc", radius: 16 }), LABEL, AT);
    expect(placeOf(disc)).toEqual({ start: "circle", method: "basis-group-distribution" });
    expect(placeOf(materialEntry("mean", trained("token-mean", { layers: ["final"] }), LABEL, AT)).method).toBe("token-mean");
  });

  it("passes the index's check, and an app that reads the place first finds the same column", () => {
    const entry = materialEntry("tokens", trained("token-distribution", { layers: ["final"] }), LABEL, AT);
    const read = readMaterialIndex(JSON.parse(JSON.stringify({ entries: [entry] }))).entries[0]!;
    expect(placeOf(read)).toEqual({ start: "noise", method: "token-distribution" });
  });

  it("files basis-group mean matching with its method named as before: by its loss, without a place", () => {
    const entry = materialEntry("mean", { ...FILE, recipe: { ...FILE.recipe, settings: { ...FILE.recipe.settings, method: "basis-group-mean" } } }, LABEL, AT);
    expect([entry.loss, entry.gallery, placeOf(entry).method]).toEqual(["plain", undefined, "basis-group-mean"]);
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

describe("an entry's place in its basis group's grid", () => {
  const entry = materialEntry("one", FILE, LABEL, AT);

  it("comes from the file's start and loss when the entry names none: the browser trains by basis-group mean matching", () => {
    expect(placeOf(entry)).toEqual({ start: "noise", method: "basis-group-mean" });
    expect(placeOf({ ...entry, start: "centre-disc", loss: "guided" })).toEqual({ start: "circle", method: "basis-group-mean-guided" });
    expect(placeOf({ ...entry, start: "seeded-field", loss: undefined })).toEqual({ start: "circle-on-noise", method: "basis-group-mean" });
  });

  it("is the one the entry carries, which the owner's publish of a research run wrote", () => {
    const set = { ...entry, gallery: { start: "circle-anywhere", method: "basis-group-distribution" } as const };
    expect(placeOf(set)).toEqual({ start: "circle-anywhere", method: "basis-group-distribution" });
    expect(readMaterialIndex({ entries: [{ ...set, cellPicture: true }] }).entries[0]).toMatchObject({ gallery: set.gallery, cellPicture: true });
  });

  it("is refused at the boundary when the index names a start or a method the gallery does not have", () => {
    expect(() => readMaterialIndex({ entries: [{ ...entry, gallery: { start: "from a picture", method: "basis-group-mean" } }] })).toThrow("place in its basis group's grid");
    expect(() => readMaterialIndex({ entries: [{ ...entry, gallery: { start: "noise", method: "plain" } }] })).toThrow("place in its basis group's grid");
    expect(() => readMaterialIndex({ entries: [{ ...entry, cellPicture: "yes" }] })).toThrow("cell picture mark");
  });
});
