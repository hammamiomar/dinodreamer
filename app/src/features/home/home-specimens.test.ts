import { describe, expect, test } from "vitest";
import { FIGURE_LAYOUT, FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import type { MaterialEntry } from "../gallery/material-index";
import {
  buildTrainMatrix,
  chooseTrainMatrixGroup,
  collectionCoverage,
  groupsWithAutomata,
  PROPERTY_AUTOMATA,
  randomUnexploredGroup,
  resolveKeepCandidates,
  resolvePropertyView,
  TOTAL_BASIS_GROUPS,
  TRAIN_STAGE_GROUP,
} from "./home-specimens";

function makeEntry(overrides: Partial<MaterialEntry>): MaterialEntry {
  return {
    id: "sample-0",
    title: "",
    credit: "Omar Hammami",
    publishedAt: "2026-11-18T00:00:00.000Z",
    materialId: "m-0",
    block: 6638,
    recipe: "figure-2026-10-23",
    band: "strongest",
    strength: 1.8,
    winnerFraction: 0.95,
    fired: true,
    side: 128,
    seed: 0,
    tick: 600,
    engine: "e",
    trainerCommit: "c",
    layout: FIGURE_PYRAMID_LAYOUT,
    start: "noise",
    pixelsPerCell: 1,
    ...overrides,
  };
}

describe("property stage resolution", () => {
  test("selects the exact paired automaton when present and falls back cleanly on fixture indices", () => {
    const groupEntry = makeEntry({ id: PROPERTY_AUTOMATA[6638].group, block: 6638 });
    const tokenEntry = makeEntry({ id: PROPERTY_AUTOMATA[6638].token, block: 6638, start: "centre-disc" });
    const fixtureOnly = makeEntry({ id: "block-4009-figure-pyramid-strongest-seed-0", block: 4009 });

    expect(resolvePropertyView([groupEntry, tokenEntry], 6638, "group")).toEqual({ entry: groupEntry, exact: true });
    expect(resolvePropertyView([groupEntry, tokenEntry], 6638, "token")).toEqual({ entry: tokenEntry, exact: true });
    expect(resolvePropertyView([fixtureOnly], 6638, "group")).toEqual({ entry: fixtureOnly, exact: false });
    expect(resolvePropertyView([], 6638, "group")).toEqual({ entry: null, exact: false });
  });
});

describe("collection coverage and unbiased random draws", () => {
  test("counts unique groups with automata and leaves the complement open", () => {
    const entries = [
      makeEntry({ id: "a", block: 6638 }),
      makeEntry({ id: "b", block: 6638 }),
      makeEntry({ id: "c", block: 729 }),
    ];
    expect(groupsWithAutomata(entries)).toEqual([729, 6638]);
    const coverage = collectionCoverage(entries);
    expect(coverage.total).toBe(TOTAL_BASIS_GROUPS);
    expect(coverage.withAutomaton).toBe(2);
    expect(coverage.withoutAutomaton).toBe(TOTAL_BASIS_GROUPS - 2);
  });

  test("draws uniformly among groups with no automaton and never repeats the current group", () => {
    const entries = [makeEntry({ id: "a", block: 0 }), makeEntry({ id: "b", block: 2 })];
    // Blocks 0 and 2 have automata; current is 1 -> first available open group at random=0 is 3.
    expect(randomUnexploredGroup(entries, 0, 1)).toBe(3);
    // Without a current group, random=0 picks block 1 (since 0 has an automaton).
    expect(randomUnexploredGroup(entries, 0, null)).toBe(1);
    // Near 1, picks the final open group (16383).
    expect(randomUnexploredGroup(entries, 0.999999, 1)).toBe(TOTAL_BASIS_GROUPS - 1);
  });
});

describe("trainable starts by methods matrix", () => {
  test("places best published entries into matching cells and links empty cells directly to Train", () => {
    const entries = [
      makeEntry({ id: "6638-plain-all-noise-seed-0", block: 6638, start: "noise", loss: "plain", fired: false }),
      makeEntry({ id: "6638-guided-all-noise-seed-0", block: 6638, start: "noise", loss: "guided", fired: true, featuredInBlock: true }),
      makeEntry({ id: "6638-plain-centre-disc-seed-0", block: 6638, start: "centre-disc", loss: "plain", fired: true }),
      makeEntry({
        id: "6638-given-set-centre-disc-seed-0",
        block: 6638,
        start: "centre-disc",
        gallery: { start: "circle", method: "token-distribution" },
      }),
    ];
    expect(chooseTrainMatrixGroup(entries)).toBe(TRAIN_STAGE_GROUP);
    const matrix = buildTrainMatrix(entries, TRAIN_STAGE_GROUP);
    expect(matrix.cells).toHaveLength(8);
    expect(matrix.filledCount).toBe(3);

    const noiseMean = matrix.cells.find((cell) => cell.start === "noise" && cell.method === "basis-group-mean")!;
    expect(noiseMean.entry?.id).toBe("6638-guided-all-noise-seed-0");

    const noiseDist = matrix.cells.find((cell) => cell.start === "noise" && cell.method === "basis-group-distribution")!;
    expect(noiseDist.entry).toBeNull();
    expect(noiseDist.trainPath).toBe("/train?block=6638&start=noise&method=basis-group-distribution");

    const discTokenMean = matrix.cells.find((cell) => cell.start === "circle" && cell.method === "token-mean")!;
    expect(discTokenMean.entry).toBeNull();
    expect(discTokenMean.trainPath).toBe("/train?block=6638&start=centre-disc&method=token-mean");
  });
});

describe("standalone embed candidates", () => {
  test("returns curated embed automata in order and falls back to the first fixture entry", () => {
    const eyes = makeEntry({ id: "block-12002-figure-strongest-mean-seed-0", block: 12002, layout: FIGURE_LAYOUT });
    const leafVeins = makeEntry({ id: "2801-plain-all-noise-seed-0", block: 2801 });
    expect(resolveKeepCandidates([leafVeins, eyes]).map((entry) => entry.id)).toEqual([
      "block-12002-figure-strongest-mean-seed-0",
      "2801-plain-all-noise-seed-0",
    ]);

    const fixture = makeEntry({ id: "fixture-only", block: 4009 });
    expect(resolveKeepCandidates([fixture]).map((entry) => entry.id)).toEqual(["fixture-only"]);
  });
});
