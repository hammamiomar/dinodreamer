import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readFigureMaterial } from "../materials/material-file";
import { continuationChange, continuationRequest, continuationSource, continuedKind } from "./continuation";

const seed = (name: string) => readFigureMaterial(JSON.parse(readFileSync(new URL(`../../../gallery/seed/materials/${name}`, import.meta.url), "utf8")));

describe("a definition Train continues", () => {
  it("is read once at the boundary: its rule, start, update, seed, batch and reference patch", () => {
    const material = seed("block-12002-figure-strongest-mean-seed-1.material.json");
    const source = continuationSource(material);
    expect(source).toMatchObject({
      id: material.file.id, block: 12002, dictionaryId: material.file.dictionaryId, rule: "cell", start: "noise",
      fromUpdate: material.file.training.updates, seed: material.file.training.seed, batch: 4,
    });
    expect(source.values).toBe(material.values);
    expect(source.anchor).toEqual(material.file.anchor);
  });

  it("keeps a two-scale definition's model and a central start", () => {
    const source = continuationSource(seed("block-4009-figure-pyramid-strongest-seed-0.material.json"));
    expect(source.rule).toBe("pyramid");
    expect(continuedKind(source, { rule: "cell", start: "centre-disc" })).toEqual({ rule: "pyramid", start: "centre-disc" });
  });

  it("refuses a definition grown two pixels per cell, which Train does not grow", () => {
    const material = seed("block-12002-figure-strongest-mean-seed-1.material.json");
    const twoPixels = { ...material, file: { ...material.file, picture: { pixelsPerCell: 2 as const } } };
    expect(() => continuationSource(twoPixels)).toThrow("one pixel per cell");
  });

  it("aims by default at its own reference patch, and records what a run changed", () => {
    const source = continuationSource(seed("block-12002-figure-strongest-mean-seed-1.material.json"));
    expect(continuationRequest(source)).toEqual({ block: 12002, points: [source.anchor], anchor: source.anchor, mode: "fill" });
    const other = { ...source.anchor, code: [1, 2, 3] as [number, number, number] };
    expect(continuationChange(source, "noise", source.anchor)).toBe("none");
    expect(continuationChange(source, "centre-disc", source.anchor)).toBe("start");
    expect(continuationChange(source, "noise", other)).toBe("reference patch");
    expect(continuationChange(source, "centre-disc", other)).toBe("start and reference patch");
  });
});
