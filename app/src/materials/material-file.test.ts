import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  bandOfNorm, canonicalFigureFile, FIGURE_RULE_VALUES, figurePlayback, lossKindOf, methodOfFile,
  readFigureMaterial, hiddenNoise, replayGridSides, startKindOf, strengthStatistic, type FigureMaterialFile,
} from "./material-file";

describe("figure material file (format 4)", () => {
  const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
  const kept = (): FigureMaterialFile => read("../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json");

  it("loads the converted E18 rule with its anchor and readouts", () => {
    const material = readFigureMaterial(kept(), "monet-dtd-seed9-20261004-pass-003");
    expect(material.values).toHaveLength(FIGURE_RULE_VALUES);
    expect(material.file.recipe.name).toBe("figure-2026-10-22");
    expect(material.file.anchor.band).toBe("strongest");
    expect(material.file.reading.strength).toBeCloseTo(2.2456, 4);
  });

  it("keeps the loss kind and a guide's settings, reads plain without them, and refuses a kind it does not know", () => {
    const file = kept();
    expect(lossKindOf(file)).toBe("plain");
    file.recipe.settings = { ...file.recipe.settings, lossKind: "guided", guideRatio: 3, guideReleaseFraction: 0.33, guideReleaseFloor: 0.5, guideUnits: 58 };
    const canonical = canonicalFigureFile(readFigureMaterial(file).file);
    expect(lossKindOf(canonical)).toBe("guided");
    expect(canonical.recipe.settings).toMatchObject({ guideRatio: 3, guideReleaseFraction: 0.33, guideReleaseFloor: 0.5, guideUnits: 58 });
    expect(() => readFigureMaterial({ ...file, recipe: { ...file.recipe, settings: { ...file.recipe.settings, lossKind: "contrastive" } } })).toThrow("loss kind");
  });

  it("reads a rule the research trained on another objective than the request: set matching, a prototype, a unit", () => {
    const file = kept();
    file.recipe.settings = { ...file.recipe.settings, lossKind: "other" };
    expect(lossKindOf(canonicalFigureFile(readFigureMaterial(file).file))).toBe("other");
  });

  it("reads a browser training's method, its layers and its set, and refuses what does not belong to the method", () => {
    const set = { source: "sample-strongest", neighbourhood: "3x3", pictures: [{ imageId: 3536804379159069, patch: 69 }, { imageId: 12, patch: 0 }] };
    const withSettings = (settings: Record<string, unknown>) => {
      const file = kept();
      file.recipe.settings = { ...file.recipe.settings, ...settings };
      return file;
    };
    const tokens = readFigureMaterial(withSettings({ method: "token-distribution", layers: ["block-3", "final"], set })).file;
    expect([methodOfFile(tokens), lossKindOf(tokens)]).toEqual(["token-distribution", "other"]);
    expect(methodOfFile(kept())).toBeNull();
    expect(lossKindOf(readFigureMaterial(withSettings({ method: "basis-group-mean" })).file)).toBe("plain");
    const refusals: [Record<string, unknown>, string][] = [
      [{ method: "token-entropy", set }, "method must be one of"],
      [{ method: "token-mean", set }, "layers"],
      [{ method: "token-mean", layers: ["block-12"], set }, "layers"],
      [{ method: "token-mean", layers: ["final", "final"], set }, "layers"],
      [{ method: "basis-group-distribution", layers: ["final"], set }, "no layers"],
      [{ method: "basis-group-distribution" }, "target set"],
      [{ method: "basis-group-distribution", set, lossKind: "plain" }, "not the request's"],
      [{ method: "basis-group-mean", set }, "no target set"],
      [{ set }, "belong to a set method"],
      [{ method: "basis-group-distribution", set: { ...set, source: "sample" } }, "source"],
      [{ method: "basis-group-distribution", set: { ...set, pictures: [] } }, "1 to 33"],
      [{ method: "basis-group-distribution", set: { ...set, pictures: [{ imageId: 12, patch: 256 }] } }, "16 × 16"],
      [{ method: "basis-group-distribution", set: { ...set, pictures: [{ imageId: 12, patch: 1 }, { imageId: 12, patch: 2 }] } }, "each picture once"],
    ];
    for (const [settings, message] of refusals) expect(() => readFigureMaterial(withSettings(settings)), JSON.stringify(settings)).toThrow(message);
  });

  it("names a start's kind by its background", () => {
    expect(startKindOf(undefined)).toBe("noise");
    expect(startKindOf({ kind: "centre-disc", radius: 16 })).toBe("centre-disc");
    expect(startKindOf({ kind: "centre-disc", radius: 16, backgroundAmplitude: 0.25 })).toBe("seeded-field");
  });

  it.each([1, 2])("rejects unsupported E1 format %i at import", (format) => {
    expect(() => readFigureMaterial({ format })).toThrow("cannot play E1");
  });

  it("preserves float32 bits and refuses invalid weights, identity and dictionary at load", () => {
    const file = kept();
    const bytes = new Uint8Array(FIGURE_RULE_VALUES * 4);
    const view = new DataView(bytes.buffer);
    view.setFloat32(0, 1.0003, true);
    view.setFloat32(4, -1e-8, true);
    file.rule.values = btoa(String.fromCharCode(...bytes));
    expect(readFigureMaterial(file).values.slice(0, 2)).toEqual(new Float32Array([1.0003, -1e-8]));
    view.setFloat32(0, Infinity, true);
    expect(() => readFigureMaterial({ ...file, rule: { ...file.rule, values: btoa(String.fromCharCode(...bytes)) } })).toThrow("finite");
    expect(() => readFigureMaterial(file, "other")).toThrow("basis collection");
    expect(() => readFigureMaterial({ ...file, block: -1 })).toThrow("basis group");
  });

  it("refuses a file whose claims disagree with its numbers", () => {
    const change = (edit: (file: FigureMaterialFile) => void) => { const file = kept(); edit(file); return () => readFigureMaterial(file); };
    expect(change((file) => { file.anchor.band = "strongly"; })).toThrow(/response level must follow/);
    expect(change((file) => { file.anchor.norm = 10; })).toThrow(/length of its response vector/);
    expect(change((file) => { file.reading = { ...file.reading, status: "unmeasured" }; })).toThrow(/must not claim/);
    expect(change((file) => { file.rule.fireRate = 0; })).toThrow(/cell update probability/);
    expect(change((file) => { file.rule.values = btoa("\0".repeat(8064 * 4)); })).toThrow(/7776/);
    expect(change((file) => { (file.reading as { side: number }).side = 64; })).toThrow(/128 or 256/);
    expect(change((file) => { file.recipe.settings.lobeDirection = [1, 1, 0]; })).toThrow(/unit vector/);
    expect(change((file) => { (file as { mode: string }).mode = "plant"; })).toThrow(/area simulation/);
    expect(change((file) => { file.training.seed = -1; })).toThrow(/training seed/);
  });

  it("applies Look's band rule: a norm on a cut belongs to the upper band", () => {
    const strength = { ring: 5, cuts: [6, 7, 8] as [number, number, number], maximum: 9 };
    expect([4, 6, 6.99, 7, 8, 20].map((norm) => bandOfNorm(norm, strength))).toEqual(["barely", "weakly", "weakly", "strongly", "strongest", "strongest"]);
    expect(bandOfNorm(20, { ring: 5, cuts: [5, 5, 5], maximum: 5 })).toBe("barely");
  });
});

describe("material playback settings", () => {
  const folder = new URL("../../../gallery/seed/materials/", import.meta.url);
  const read = (name: string): FigureMaterialFile => JSON.parse(readFileSync(new URL(name, folder), "utf8"));

  it("refuses a pyramid file that claims playback noise, 2 px per cell or the wrong number of values", () => {
    const file = read("block-4009-figure-pyramid-strongest-seed-0.material.json");
    expect(() => readFigureMaterial({ ...file, playback: { hiddenNoise: 0.01 } })).toThrow(/no playback noise/);
    expect(() => readFigureMaterial({ ...file, reading: { ...file.reading, side: 64 }, picture: { pixelsPerCell: 2 } })).toThrow(/one pixel per fine-grid cell/);
    expect(() => readFigureMaterial({ ...file, rule: { ...file.rule, layout: "figure-16-96-torus-v1" } })).toThrow(/7776 float32 values/);
  });

  it("keeps every picture 128 or 256 pixels wide, at 1 or 2 pixels per cell", () => {
    const file = read("block-12002-figure-strongest-mean-seed-1.material.json");
    expect(replayGridSides(file)).toEqual([128, 256]);
    expect(() => readFigureMaterial({ ...file, picture: { pixelsPerCell: 3 as never } })).toThrow(/1 or 2 pixels per cell/);
    expect(() => readFigureMaterial({ ...file, picture: { pixelsPerCell: 2 } })).not.toThrow();
    expect(() => readFigureMaterial({ ...file, reading: { ...file.reading, side: 64 } })).toThrow(/128 or 256 pixels wide/);
    expect(() => readFigureMaterial({ ...file, reading: { ...file.reading, side: 256 }, picture: { pixelsPerCell: 2 } })).toThrow(/128 or 256 pixels wide/);
  });

  it("starts from noise unless the file names a seeded disc with a positive radius", () => {
    const file = read("block-12002-figure-strongest-mean-seed-1.material.json");
    expect(figurePlayback(readFigureMaterial(file).file).startDisc).toBe(0);
    expect(figurePlayback(readFigureMaterial({ ...file, start: { kind: "noise" } }).file).startDisc).toBe(0);
    expect(() => readFigureMaterial({ ...file, start: { kind: "centre-disc", radius: 0 } })).toThrow(/positive radius/);
    expect(() => readFigureMaterial({ ...file, start: { kind: "corner" } as never })).toThrow(/start/);
    expect(figurePlayback(readFigureMaterial({ ...file, start: { kind: "centre-disc", radius: 16 } }).file).startBackground).toBe(0);
    expect(() => readFigureMaterial({ ...file, reading: { ...file.reading, region: "edge" as never } })).toThrow(/region/);
  });

  it("reads a seeded field's background amplitude, from 0 to 1, and keeps it in the canonical file", () => {
    const file = read("block-12002-figure-strongest-mean-seed-1.material.json");
    const field = readFigureMaterial({ ...file, start: { kind: "centre-disc", radius: 16, backgroundAmplitude: 0.25 } }).file;
    expect(figurePlayback(field)).toMatchObject({ startDisc: 16, startBackground: 0.25 });
    expect(canonicalFigureFile(field).start).toEqual({ kind: "centre-disc", radius: 16, backgroundAmplitude: 0.25 });
    const none = readFigureMaterial({ ...file, start: { kind: "centre-disc", radius: 16, backgroundAmplitude: 0 } }).file;
    expect(canonicalFigureFile(none).start).toEqual({ kind: "centre-disc", radius: 16 });
    expect(() => readFigureMaterial({ ...file, start: { kind: "centre-disc", radius: 16, backgroundAmplitude: 1.5 } })).toThrow(/background amplitude/);
    expect(() => readFigureMaterial({ ...file, start: { kind: "centre-disc", radius: 16, backgroundAmplitude: "0.25" } as never })).toThrow(/background amplitude/);
  });

  it("keeps hidden-channel noise optional, zero by default and never negative", () => {
    const file = read("block-12002-figure-strongest-mean-seed-1.material.json");
    expect(hiddenNoise(readFigureMaterial({ ...file, playback: { hiddenNoise: 0.01 } }).file)).toBe(0.01);
    expect(() => readFigureMaterial({ ...file, playback: { hiddenNoise: -0.01 } })).toThrow(/zero or positive/);
    expect(() => readFigureMaterial({ ...file, playback: {} as { hiddenNoise: number } })).toThrow(/noise/);
  });
});

describe("canonical recipe settings", () => {
  const folder = new URL("../../../gallery/seed/materials/", import.meta.url);
  const seed = (): FigureMaterialFile => JSON.parse(readFileSync(new URL("block-12002-figure-strongest-mean-seed-1.material.json", folder), "utf8"));

  it("names the statistic recorded by the measurement settings", () => {
    expect(strengthStatistic("E18", undefined)).toBe("projection-on-main-direction");
    expect(strengthStatistic("E19", undefined)).toBe("projection-on-main-direction");
    expect(strengthStatistic(undefined, "training target")).toBe("projection-on-target");
    expect(strengthStatistic(undefined, undefined)).toBe("projection-on-main-direction");
    expect(strengthStatistic("2026-10-26-selection-margin", undefined)).toBe("median-magnitude");
    expect(strengthStatistic("2026-10-30-7178-investigation", undefined)).toBe("median-magnitude");
    expect(strengthStatistic("E99", undefined)).toBe("unknown");
  });

  it("keeps only the named settings, dropping an unknown key even when its value is short", () => {
    const file = seed();
    file.recipe.settings = { ...file.recipe.settings, shader: "@compute fn main() {}", fire_rate: 0.5 };
    const settings = canonicalFigureFile(readFigureMaterial(file).file).recipe.settings;
    expect(settings).not.toHaveProperty("shader");
    expect(settings.fire_rate).toBe(0.5);
    expect(settings.medianNorm).toBe(file.recipe.settings.medianNorm);
  });

  it("keeps the selection margin of a converted margin run", () => {
    const file = seed();
    const margin = { selectionMargin: "top-32-margin-delta-0.25", marginRivalRank: 32, marginDeltaOverM2: 0.25, marginWeight: 1 };
    file.recipe.settings = { ...file.recipe.settings, ...margin };
    expect(canonicalFigureFile(readFigureMaterial(file).file).recipe.settings).toMatchObject(margin);
  });
});
