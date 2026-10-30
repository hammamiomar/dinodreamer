import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readFigureMaterial } from "../../materials/material-file";
import { keptEntry } from "../playground/yours";
import { fileRecipeCaption, materialCaption } from "./material-caption";

const material = readFigureMaterial(JSON.parse(readFileSync(new URL("../../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8")));
const entry = keptEntry(material);
const file = material.file;

describe("automaton titles and recipes", () => {
  it("shows a creative title above the complete recipe and update count", () => {
    expect(materialCaption({ ...entry, title: "Garden at dusk" }, file)).toEqual({
      title: "Garden at dusk", recipe: `${file.name} · 1,000 updates`,
    });
  });

  it("uses the recipe once when the title is empty, without changing the index", () => {
    expect(materialCaption({ ...entry, title: "" }, file)).toEqual({ title: `${file.name} · 1,000 updates`, recipe: null });
  });

  it("preserves a legacy research title and adds only its missing count", () => {
    expect(materialCaption(entry, file)).toEqual({ title: file.name, recipe: "1,000 updates" });
  });

  it("recognizes the actual file name, without guessing from a creative title's prefix", () => {
    const title = "12002 · Garden at dusk · seed 1";
    expect(materialCaption({ ...entry, title }, file)).toEqual({ title, recipe: `${file.name} · 1,000 updates` });
  });

  it.each(["Block 12002 · final · 1,000 updates", "12002 · pyramid, 1,000 updates · seed 1"])("does not repeat an update count already in the generated name: %s", (name) => {
    const described = { ...file, name };
    expect(fileRecipeCaption(described)).toBe(name);
    expect(materialCaption({ ...entry, title: name }, described)).toEqual({ title: name, recipe: null });
  });

  it("gets the count from training metadata, never the id or the title", () => {
    const described = { ...file, id: "example-update-999999-final", training: { ...file.training, updates: 725 } };
    expect(fileRecipeCaption(described)).toBe(`${file.name} · 725 updates`);
    expect(materialCaption({ ...entry, title: "" }, { ...file, training: { ...file.training, updates: 0 } }).title).toContain("0 updates");
  });

  it("keeps a title during loading and reports unavailable metadata without inventing a count", () => {
    expect(materialCaption(entry, null)).toEqual({ title: entry.title, recipe: "Reading update count…" });
    expect(materialCaption(entry, null, true)).toEqual({ title: entry.title, recipe: "Update count unavailable" });
  });
});
