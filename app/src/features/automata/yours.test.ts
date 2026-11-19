import { describe, expect, test } from "vitest";
import { FIGURE_LAYOUT, readFigureMaterial, type FigureMaterialFile } from "../../materials/material-file";
import type { MaterialEntry } from "../gallery/material-index";
import { keptEntry, withKept } from "./yours";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function keptSeed(): FigureMaterialFile {
  const path = fileURLToPath(new URL("../../../../gallery/seed/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as FigureMaterialFile;
}

describe("saved material entries", () => {
  const file = keptSeed();
  const material = readFigureMaterial(file);

  test("builds an index entry under the file's own id and name", () => {
    expect(material.file.format).toBe(4);
    const entry = keptEntry(material);
    expect(entry).toMatchObject({ id: file.id, title: file.name, block: 12002, layout: FIGURE_LAYOUT, start: "noise", pixelsPerCell: 1, fired: true, credit: "" });
    expect(entry.side).toBe(file.reading.side);
    expect(entry.materialId).toBe(file.id);
    expect(entry.measurementDirection).toBeUndefined();
    const onTarget = { ...file, recipe: { ...file.recipe, settings: { ...file.recipe.settings, measurementDirection: "training target" } } };
    expect(keptEntry(readFigureMaterial(onTarget)).measurementDirection).toBe("training target");
  });

  test("resolves saved entries from memory and falls back to the published source", async () => {
    const figures = [{ entry: keptEntry(material), material }];
    const asked: string[] = [];
    const published = {
      load: (entry: MaterialEntry) => { asked.push(entry.id); return Promise.reject(new Error("not kept")); },
      poster: (entry: MaterialEntry) => `/api/materials/${entry.id}/poster.png`,
      keepable: () => true,
    };
    const source = withKept(figures, published);
    const kept = figures[0]!.entry;
    await expect(source.load(kept)).resolves.toBe(figures[0]!.material);
    expect(source.poster(kept)).toBe(file.preview);
    expect(source.keepable(kept)).toBe(false);
    const other = { ...kept, id: "block-1-elsewhere" };
    await expect(source.load(other)).rejects.toThrow("not kept");
    expect(source.poster(other)).toBe("/api/materials/block-1-elsewhere/poster.png");
    expect(source.keepable(other)).toBe(true);
    expect(asked).toEqual(["block-1-elsewhere"]);
  });
});
