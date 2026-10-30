// Qualification of the shipped material collection and dated Grow evidence.
// Run after changes to these artifacts, their loader, their exporter or the firing interval:
//   MATERIAL_AUDIT=1 pnpm vitest run src/materials/material-files.audit.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { FIRING_BOUNDARY_M, firingBoundary } from "../grow/firing-boundary";
import {
  canonicalFigureFile, figurePlayback, fired, hiddenNoise, readingPictureSide,
  readFigureMaterial, replayGridSides, strengthStatistic, type FigureMaterialFile,
} from "./material-file";

describe.skipIf(!process.env.MATERIAL_AUDIT)("published material artifacts", () => {
  const folder = new URL("../../../gallery/seed/materials/", import.meta.url);
  let names: string[];
  const files = new Map<string, FigureMaterialFile>();

  // A skipped audit must not read the collection during test discovery.
  beforeAll(() => {
    names = readdirSync(folder).filter((name) => name.endsWith(".material.json"));
    for (const name of names) {
      files.set(name, JSON.parse(readFileSync(new URL(name, folder), "utf8")));
    }
  });

  const read = (name: string): FigureMaterialFile => files.get(name)!;
  const recipe = (name: string) => read(name).recipe.name;
  // E20 and E21 share recipe names; the experiment identifies stage 5.
  const ofStage5 = (name: string) => read(name).recipe.settings.experiment === "E20";

  it("names each shipped file's stored value by its settings, as the file's note does", () => {
    for (const name of names) {
      const file = read(name);
      const notedMedian = file.reading.note.includes("median over those patches of |c|/m");
      const { experiment, measurementDirection } = file.recipe.settings;
      expect(strengthStatistic(experiment, measurementDirection), name).toBe(notedMedian ? "median-magnitude" : "projection-on-main-direction");
    }
  });

  it("ships all 44 trained rules of E18 and E19, 26 that fired, each with its source record and a reading at tick 600 on 128 cells", () => {
    const figure = names.filter((name) => recipe(name) === "figure-2026-10-22");
    expect(figure).toHaveLength(44);
    const firedCount = figure.filter((name) => fired(read(name).reading)).length;
    expect(firedCount).toBe(26);
    for (const name of figure) {
      const { file } = readFigureMaterial(read(name), "monet-dtd-seed9-20261004-pass-003");
      expect(file.reading.status).toBe("measured");
      expect([file.reading.side, file.reading.tick]).toEqual([128, 600]);
      expect(file.recipe.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.recipe.settings.trainerSha256).toBe("5c10352e424989e1f423b8fa05745127e922ae3b98ab4410fea79225da516bdf");
      expect(file.recipe.settings.runFolder).toMatch(/^research\/2026-10-22-strength\/out\//);
      expect(hiddenNoise(file)).toBe(0);
    }
  });

  it("ships the three seeded-centre rules from stage 5, read on the central 4 × 4 patches", () => {
    const seeded = names.filter((name) => recipe(name) === "figure-seeded-2026-10-23" && ofStage5(name)).sort();
    expect(seeded).toEqual([
      "block-14552-figure-seeded-strongest-seed-0.material.json",
      "block-2632-figure-seeded-strongest-seed-0.material.json",
      "block-2632-figure-seeded-strongest-seed-1.material.json",
    ]);
    for (const name of seeded) {
      const { file } = readFigureMaterial(read(name), "monet-dtd-seed9-20261004-pass-003");
      expect(file.start).toEqual({ kind: "centre-disc", radius: 16 });
      expect(figurePlayback(file)).toEqual({ hiddenNoise: 0, startDisc: 16, pixelsPerCell: 1 });
      expect([file.reading.side, file.reading.tick, file.reading.region]).toEqual([128, 600, "centre-4x4"]);
      expect(file.recipe.settings.runFolder).toMatch(/^research\/2026-10-22-optimizer-schedule\/out\/stage-5\/pool-64-seeded-centre\//);
      expect(file.recipe.settings.trainerSha256).toBe("5c10352e424989e1f423b8fa05745127e922ae3b98ab4410fea79225da516bdf");
      expect(canonicalFigureFile(file)).toEqual(file);
    }
    // 2632 seed 1 fired at update 825; the saved update-1000 rule does not, and says so.
    const late = read("block-2632-figure-seeded-strongest-seed-1.material.json");
    expect(fired(late.reading)).toBe(false);
    expect(late.reading.note).toContain("first fired at update 825");
  });

  it("ships the six 2 px per cell rules that fired in stage 5, each a 64-cell grid with a 128-pixel picture", () => {
    const coarse = names.filter((name) => recipe(name) === "figure-2px-2026-10-23" && ofStage5(name)).sort();
    expect(coarse.map((name) => name.replace("-figure-2px-strongest", "").replace(".material.json", ""))).toEqual([
      "block-13633-seed-0", "block-13633-seed-1", "block-2632-seed-0", "block-2632-seed-1", "block-4009-seed-0", "block-4009-seed-1",
    ]);
    for (const name of coarse) {
      const { file } = readFigureMaterial(read(name), "monet-dtd-seed9-20261004-pass-003");
      expect(fired(file.reading)).toBe(true);
      expect(figurePlayback(file)).toEqual({ hiddenNoise: 0, startDisc: 0, pixelsPerCell: 2 });
      expect([file.reading.side, readingPictureSide(file), file.reading.region]).toEqual([64, 128, undefined]);
      expect(replayGridSides(file)).toEqual([64, 128]);
      expect(canonicalFigureFile(file)).toEqual(file);
    }
  });

  it("ships the eleven stage-5 pyramid rules, each in the 17,088-value pyramid layout with its plain status", () => {
    const pyramids = names.filter((name) => recipe(name) === "figure-pyramid-2026-10-23" && ofStage5(name)).sort();
    const runs = pyramids.map((name) => name.replace("-figure-pyramid-strongest", "").replace(".material.json", ""));
    expect(runs).toEqual([
      "block-12002-seed-0", "block-12002-seed-1", "block-13633-seed-0", "block-13633-seed-1", "block-14552-seed-1",
      "block-15498-seed-0", "block-15498-seed-1", "block-2632-seed-0", "block-2632-seed-1", "block-4009-seed-0", "block-4009-seed-1",
    ]);
    for (const name of pyramids) {
      const material = readFigureMaterial(read(name), "monet-dtd-seed9-20261004-pass-003");
      expect(material.file.rule.layout).toBe("figure-pyramid-16-96-torus-v1");
      expect(material.values).toHaveLength(17088);
      expect([material.file.reading.side, readingPictureSide(material.file)]).toEqual([128, 128]);
      expect(canonicalFigureFile(material.file)).toEqual(material.file);
    }
    // 13633 seed 1 and 14552 seed 1 fired during training; the rules saved at the stop do not.
    const quiet = pyramids.filter((name) => !fired(read(name).reading));
    expect(quiet).toEqual(["block-13633-figure-pyramid-strongest-seed-1.material.json", "block-14552-figure-pyramid-strongest-seed-1.material.json"]);
    expect(read(quiet[1]).reading.note).toContain("first fired at update 900");
  });

  it("ships the 108 stage-6 video rules with their updates and fire records", () => {
    const stage6 = names.filter((name) => name.includes("-stage-6-")).map((name) => readFigureMaterial(read(name), "monet-dtd-seed9-20261004-pass-003").file);
    const variants = new Map<string, number>();
    for (const file of stage6) variants.set(String(file.recipe.settings.variant), (variants.get(String(file.recipe.settings.variant)) ?? 0) + 1);
    // The 112 runs less the four alive-mask runs, which the replay cannot play.
    expect(Object.fromEntries(variants)).toEqual({
      "pool-64": 19, "pool-64-seeded-centre": 21, "pool-64-render-2-2000-updates": 8,
      "pool-64-pyramid": 22, "pool-64-pyramid-2000-updates": 9, "pool-64-pyramid-seeded-centre": 29,
    });
    for (const file of stage6) {
      const settings = file.recipe.settings;
      expect([settings.experiment, settings.sweepStage]).toEqual(["E21", "stage-6"]);
      expect(settings.runFolder).toMatch(/^research\/2026-10-22-optimizer-schedule\/out\/stage-6\//);
      expect(file.recipe.source).toMatch(/\/(rules\/update-\d{4}|rule)\.pt$/);
      expect(canonicalFigureFile(file)).toEqual(file);
      // A run that fired ships its first firing rule; the never-fired runs (all on 7178) ship the rule at the stop.
      if (settings.firstFireUpdate === null) expect(file.block).toBe(7178);
      else expect(file.training.updates).toBe(settings.firstFireUpdate);
      expect(fired(file.reading)).toBe(settings.firstFireUpdate !== null);
    }
    expect(stage6.filter((file) => !fired(file.reading))).toHaveLength(6);
    const seededPyramid = stage6.filter((file) => file.recipe.name === "figure-pyramid-seeded-2026-10-23");
    expect(seededPyramid).toHaveLength(29);
    for (const file of seededPyramid) {
      expect(file.rule.layout).toBe("figure-pyramid-16-96-torus-v1");
      expect(figurePlayback(file)).toEqual({ hiddenNoise: 0, startDisc: 16, pixelsPerCell: 1 });
      expect(file.reading.region).toBe("centre-4x4");
    }
  });

  it("leaves the browser Grow's own files unchanged", () => {
    const grown = new URL("../../fixtures/materials/browser-grow/", import.meta.url);
    const names = readdirSync(grown).filter((name) => name.endsWith(".material.json"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const file = readFigureMaterial(JSON.parse(readFileSync(new URL(name, grown), "utf8"))).file;
      expect(canonicalFigureFile(file)).toEqual(file);
    }
  });

  it("marks where the seed's E18 and E19 runs pass from missing to meeting the selection target, rounded outward", () => {
    const runs = names.map(read)
      .filter((file) => file.recipe.settings.experiment === "E18" || file.recipe.settings.experiment === "E19")
      .map((file) => {
        const { strength, winnerFraction } = file.reading;
        if (strength === null || winnerFraction === null) throw new Error(`Missing firing measurement: ${file.id}`);
        return { strength, winnerFraction };
      });
    expect(runs).toHaveLength(44);
    const [lowest, highest] = firingBoundary(runs);
    expect([Math.floor(lowest * 100) / 100, Math.ceil(highest * 100) / 100]).toEqual([...FIRING_BOUNDARY_M]);
  });
});
