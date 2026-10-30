import { describe, expect, it } from "vitest";
import type { LookSummary } from "../library/look-cloud";
import type { MaterialAnchor, MaterialRequest } from "../recipe";
import { canonicalFigureFile, readFigureMaterial } from "../materials/material-file";
import {
  FIGURE_SEED, NO_ANCHOR_ERROR, RUNS, afterRun, continuedInput, engineRequest, figureInput, figureMaterial, fired, firstFire, firstFireCondition, runSeed,
  strengthBand,
} from "./figure-recipe";
import { readoutText } from "./live-readout";
import { continuationSource } from "./continuation";
import { DEFAULT_KIND, kindFromSearch, recipeName, type MaterialKind } from "./material-kind";
import type { LiveReading } from "./protocol";

// E18's strongest 12002 occurrence. Look's cuts quarter the distance from the ring (the median
// gate) to the largest norm of the 4,096-patch public sample, 17.620907.
const anchor: MaterialAnchor = {
  band: "strongest",
  norm: 14.966866,
  strength: { ring: 5.166629, cuts: [8.280199, 11.393768, 14.507338], maximum: 17.620907 },
  source: "library",
  imageId: 3536804379159069,
  code: [8.08268928527832, -9.041988372802734, 8.7703857421875],
  slot: 74,
};
const summary: LookSummary = {
  block: 12002, release: "pass-003", gateMedian: 5.166629, medianNorm: 5.719563,
  mainDirection: [0.5573955673693698, -0.5264948169981034, 0.6419605822409284], patchRows: 215830,
};
const request = (extra: Partial<MaterialRequest> = {}): MaterialRequest => ({
  block: 12002, points: [{ source: "library", imageId: 3536804379159069, code: anchor.code, slot: 74 }], anchor, ...extra,
});

/** A saved definition of the run `input` describes, at update 450, as Keep stores it. */
function savedFile(input: ReturnType<typeof figureInput>) {
  return figureMaterial(input, {
    run: 1, stage: "first fire", values: Float32Array.from({ length: 7776 }, () => 0.01), updates: 450, trainingMs: 1, engine: "bundled",
    preview: "data:image/png;base64,iVBORw0KGgo=",
    reading: { status: "measured", strength: 2, winnerFraction: 1, side: 128, seed: 9317, tick: 600, note: "test" },
  });
}

describe("Grow's request contract", () => {
  it("aims at the anchor's native code with the summary's median winning norm", () => {
    const input = figureInput(request(), summary, "monet-dtd-seed9-20261004-pass-003", DEFAULT_KIND);
    expect(engineRequest(input)).toEqual({
      block: 12002, code: anchor.code, medianNorm: 5.719563, seed: FIGURE_SEED + 12002, batch: 4, rule: "cell", start: "noise",
    });
    expect(Math.hypot(...input.direction)).toBeCloseTo(1, 12);
  });

  it("measures on the training target's direction, not the group's main direction", () => {
    const input = figureInput(request(), summary, "dictionary", DEFAULT_KIND);
    const length = Math.hypot(...anchor.code);
    anchor.code.forEach((value, axis) => expect(input.direction[axis]).toBeCloseTo(value / length, 12));
    // A reference patch in the opposite extension: the main direction would read it negative.
    const opposite = { ...anchor, code: anchor.code.map((value) => -value) as typeof anchor.code };
    const flipped = figureInput(request({ anchor: opposite }), summary, "dictionary", DEFAULT_KIND);
    const onMain = flipped.direction.reduce((sum, value, axis) => sum + value * summary.mainDirection[axis]!, 0);
    expect(onMain).toBeLessThan(0);
    expect(opposite.code.reduce((sum, value, axis) => sum + value * flipped.direction[axis]!, 0)).toBeCloseTo(length, 9);
  });

  it("refuses an older selection without an anchor", () => {
    const { anchor: _, ...older } = request();
    expect(() => figureInput(older, summary, "dictionary", DEFAULT_KIND)).toThrow(NO_ANCHOR_ERROR);
  });

  it("leaves a localized activity simulation and another basis group's summary alone", () => {
    expect(() => figureInput(request({ mode: "plant" }), summary, "dictionary", DEFAULT_KIND)).toThrow("does not train a localized activity simulation");
    expect(() => figureInput(request(), { ...summary, block: 15498 }, "dictionary", DEFAULT_KIND)).toThrow("another basis group");
  });

  it("names the band of a reached strength with Look's rule on the anchor's cuts", () => {
    const input = figureInput(request(), summary, "dictionary", DEFAULT_KIND);
    // Strength times m = 5.719563 against the cuts 8.28, 11.39 and 14.51.
    expect(strengthBand(1.0, input)).toBe("barely");
    expect(strengthBand(1.7, input)).toBe("weakly");
    expect(strengthBand(2.2, input)).toBe("strongly");
    expect(strengthBand(2.9, input)).toBe("strongest");
  });

  it("writes a format-4 file that Keep's loader accepts", () => {
    const input = figureInput(request(), summary, "monet-dtd-seed9-20261004-pass-003", DEFAULT_KIND);
    const values = Float32Array.from({ length: 7776 }, (_, index) => Math.sin(index) / 8);
    const file = figureMaterial(input, {
      run: 1, stage: "final", values, updates: 1000, trainingMs: 300000, engine: "bundled",
      preview: "data:image/png;base64,iVBORw0KGgo=",
      reading: { status: "measured", strength: 2.39, winnerFraction: 1, side: 128, seed: 9317, tick: 600, note: "test" },
    });
    const material = readFigureMaterial(file, "monet-dtd-seed9-20261004-pass-003");
    expect(Array.from(material.values)).toEqual(Array.from(values));
    expect(material.file.recipe.settings).toMatchObject({ medianNorm: 5.719563, batch: 4, pool: 64, measurementDirection: "training target" });
    // Publishing keeps which direction the measurement projected on.
    expect(canonicalFigureFile(material.file).recipe.settings.measurementDirection).toBe("training target");
    expect(material.file.recipe.name).toBe("figure-2026-10-23");
    expect(material.file.training).toEqual({ seed: FIGURE_SEED + 12002, updates: 1000 });
    expect(material.file.start).toBeUndefined();
    expect(material.file.reading.region).toBeUndefined();
  });

  it("a continued run trains with its source's seed and batch and records where it came from", () => {
    const base = figureInput(request(), summary, "monet-dtd-seed9-20261004-pass-003", DEFAULT_KIND);
    const source = continuationSource({ file: savedFile(base), values: Float32Array.from({ length: 7776 }, () => 0.01) });
    const input = continuedInput(base, { ...source, seed: 77, batch: 1 }, "start");
    expect([input.seed, input.batch]).toEqual([77, 1]);
    const file = figureMaterial(input, {
      run: 1, stage: "final", values: source.values, updates: 1000, trainingMs: 1, engine: "bundled",
      preview: "data:image/png;base64,iVBORw0KGgo=",
      reading: { status: "measured", strength: 2, winnerFraction: 1, side: 128, seed: 9317, tick: 600, note: "test" },
    });
    expect(file.ancestorId).toBe(source.id);
    expect(file.id.endsWith(`-from-${source.fromUpdate}`)).toBe(true);
    expect(file.recipe.settings).toMatchObject({ continuedFromUpdate: source.fromUpdate, continuedOptimizer: "fresh", continuedChange: "start" });
    // It is its training's only run.
    expect(file.recipe.settings.runs).toBe(1);
    expect(file.name).toBe("Block 12002 · strongest anchor · Fine · noise · final · 1,000 updates · continued from update 450");
    // Publishing keeps the lineage.
    expect(canonicalFigureFile(readFigureMaterial(file).file).recipe.settings).toMatchObject({ continuedFromUpdate: 450, continuedChange: "start" });
  });
});

describe("the four kinds", () => {
  const kept = (values: number) => ({
    run: 1, stage: "first fire" as const, values: Float32Array.from({ length: values }, (_, index) => Math.cos(index) / 9),
    updates: 250, trainingMs: 1, engine: "bundled", preview: "data:image/png;base64,iVBORw0KGgo=",
    reading: { status: "measured" as const, strength: 2.1, winnerFraction: 1, side: 128 as const, seed: 9317, tick: 600, note: "test" },
  });

  it("asks the engine for the chosen rule and start", () => {
    const kind: MaterialKind = { rule: "pyramid", start: "centre-disc" };
    expect(engineRequest(figureInput(request(), summary, "dictionary", kind))).toMatchObject({ rule: "pyramid", start: "centre-disc" });
  });

  it("keeps the seeded pyramid in the supported replay layouts", () => {
    const input = figureInput(request(), summary, "monet-dtd-seed9-20261004-pass-003", { rule: "pyramid", start: "centre-disc" });
    const file = figureMaterial(input, kept(17088));
    const material = readFigureMaterial(file, "monet-dtd-seed9-20261004-pass-003");
    expect(material.values.length).toBe(17088);
    expect(material.file.rule.layout).toBe("figure-pyramid-16-96-torus-v1");
    expect(material.file.start).toEqual({ kind: "centre-disc", radius: 16 });
    expect(material.file.reading.region).toBe("centre-4x4");
    expect(material.file.recipe.name).toBe("figure-pyramid-seeded-2026-10-23");
    expect(material.file.picture).toBeUndefined();
    expect(file.id).toMatch(/^grow-figure-pyramid-seeded-12002-/);
    expect(file.name).toBe("Block 12002 · strongest anchor · Coarse + fine · seed at the center · run 1 of 3 · first fire · 250 updates");
  });

  it("names each kind as the shipped files do", () => {
    const names = (["cell", "pyramid"] as const).flatMap((rule) => (["noise", "centre-disc"] as const)
      .map((start) => recipeName({ rule, start })));
    expect(names).toEqual(["figure-2026-10-23", "figure-seeded-2026-10-23", "figure-pyramid-2026-10-23", "figure-pyramid-seeded-2026-10-23"]);
  });

  it("refuses a rule of the wrong size for its kind", () => {
    const input = figureInput(request(), summary, "dictionary", { rule: "pyramid", start: "noise" });
    expect(() => figureMaterial(input, kept(7776))).toThrow("17,088 values");
  });

  it("reads the kind from a Grow another variation address, and falls back to the fine rule from noise", () => {
    expect(kindFromSearch(new URLSearchParams("block=4009&rule=pyramid&start=centre-disc"))).toEqual({ rule: "pyramid", start: "centre-disc" });
    expect(kindFromSearch(new URLSearchParams("block=4009&rule=pyramid"))).toEqual({ rule: "pyramid", start: "noise" });
    expect(kindFromSearch(new URLSearchParams("block=4009&rule=alive&start=disc"))).toEqual(DEFAULT_KIND);
  });
});

describe("retry on the outcome", () => {
  it("keeps a run that fires and tries the next seed otherwise, at most three runs", () => {
    expect(RUNS).toBe(3);
    expect(afterRun(1, true)).toBe("fired");
    expect(afterRun(1, false)).toBe("retry");
    expect(afterRun(2, false)).toBe("retry");
    expect(afterRun(3, false)).toBe("stop");
    expect(afterRun(3, true)).toBe("fired");
    expect(fired({ winnerFraction: 0.9 })).toBe(true);
    expect(fired({ winnerFraction: 0.89 })).toBe(false);
    expect(fired({ winnerFraction: null })).toBe(false);
  });

  it("gives each run its own seed and names a run that did not fire", () => {
    expect([1, 2, 3].map((run) => runSeed(12002, run))).toEqual([FIGURE_SEED + 12002, FIGURE_SEED + 12003, FIGURE_SEED + 12004]);
    const input = figureInput(request(), summary, "dictionary", DEFAULT_KIND, 4, 2);
    expect(engineRequest(input).seed).toBe(FIGURE_SEED + 12003);
    const file = figureMaterial(input, {
      run: 2, stage: "final", values: new Float32Array(7776), updates: 1000, trainingMs: 1, engine: "bundled",
      preview: "data:image/png;base64,iVBORw0KGgo=",
      reading: { status: "measured", strength: 0.52, winnerFraction: 0, side: 128, seed: 9317, tick: 600, note: "test" },
    });
    expect(file.name).toBe("Block 12002 · strongest anchor · Fine · noise · run 2 of 3 · final · 1,000 updates · did not fire");
    expect(file.recipe.settings).toMatchObject({ run: 2, runs: 3, fires: 0.9, stage: "final" });
  });
});

describe("first fire", () => {
  it("is a checkpoint that fires at tick 600 and still fires at tick 2,000, for the noise kinds", () => {
    for (const rule of ["cell", "pyramid"] as const) {
      const kind: MaterialKind = { rule, start: "noise" };
      expect(firstFire(kind, { winnerFraction: 0.97 }, { winnerFraction: 1 })).toBe(true);
      expect(firstFire(kind, { winnerFraction: 0.97 }, { winnerFraction: 0.44 })).toBe(false);
      expect(firstFire(kind, { winnerFraction: 0.97 }, null)).toBe(false);
      expect(firstFire(kind, { winnerFraction: 0.5 }, { winnerFraction: 1 })).toBe(false);
    }
  });

  it("is the centre's fire at tick 600 for the seeded kinds: the figure may dissolve by tick 2,000", () => {
    for (const rule of ["cell", "pyramid"] as const) {
      const kind: MaterialKind = { rule, start: "centre-disc" };
      // The 12002 seeded pyramid in the page: the centre won at tick 600 and none of it at tick 2,000.
      expect(firstFire(kind, { winnerFraction: 1 }, { winnerFraction: 0 })).toBe(true);
      expect(firstFire(kind, { winnerFraction: 0.94 }, null)).toBe(true);
      expect(firstFire(kind, { winnerFraction: 0.875 }, { winnerFraction: 1 })).toBe(false);
    }
    expect(firstFireCondition({ rule: "cell", start: "centre-disc" })).toBe("fires at tick 600");
    expect(firstFireCondition(DEFAULT_KIND)).toBe("fires at tick 600 and still at tick 2,000");
  });
});

describe("live readout", () => {
  const reading = (winnerFraction: number, completed: number): LiveReading => ({
    strength: 2.3137, band: "strongly", winnerFraction, seed: 9317, tick: completed * 8, rule: "training", completed,
    elapsedMs: completed * 300, readMs: 40, selectedPatches: new Uint8Array(64), coSelection: { readPatches: 64, top: [], requested: { group: 12002, rank: 1, patches: 63, positionSum: 63 } },
  });

  it("states the selected patch count and target for the read region", () => {
    expect(readoutText(reading(0.984, 10), 12002)).toBe("DINO sees 12002 on 63 of the 64 patches. The target is 58 patches.");
    expect(readoutText(reading(0.9375, 10), 12002, "centre-4x4")).toBe("DINO sees 12002 on 15 of the central 16 patches. The target is 15 patches.");
  });
});
