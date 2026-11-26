import { describe, expect, test } from "vitest";
import { FIGURE_LAYOUT, FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import type { MaterialEntry } from "../gallery/material-index";
import type { StoryRecord } from "../how/training-story";
import {
  collectionCoverage,
  groupsWithAutomata,
  KEEP_AUTOMATON_IDS,
  PROPERTY_AUTOMATA,
  randomUnexploredGroup,
  resolveKeepCandidates,
  resolvePropertyView,
  selectTrainStories,
  storyEntryForRecord,
  TOTAL_BASIS_GROUPS,
  TRAIN_STORY_MATERIAL_IDS,
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

function makeStoryRecord(material: string, block: number): StoryRecord {
  return {
    material,
    block,
    anchor: {
      imageId: 1001,
      slot: 59,
      band: "strongest",
      atlasPoint: [1.2, 0.3],
      atlasPlane: [[1, 0, 0], [0, 1, 0]],
    },
    training: {
      strip: `${material}-training.webp`,
      frameSide: 128,
      tick: 600,
      medianNorm: 1.0,
      frames: [
        { update: 0, winnerFraction: 0.0, strength: 0.1 },
        { update: 400, winnerFraction: 0.94, strength: 1.5 },
      ],
    },
    run: "run-0",
  };
}

describe("property stage resolution", () => {
  test("selects the exact paired automaton when present and falls back cleanly on fixture indices", () => {
    const groupEntry = makeEntry({ id: PROPERTY_AUTOMATA[6638].group, block: 6638 });
    const tokenEntry = makeEntry({ id: PROPERTY_AUTOMATA[6638].token, block: 6638, start: "centre-disc" });
    const lipsEntry = makeEntry({ id: PROPERTY_AUTOMATA[2632].group, block: 2632 });
    const fixtureOnly = makeEntry({ id: "block-4009-figure-pyramid-strongest-seed-0", block: 4009 });

    expect(PROPERTY_AUTOMATA[2632].group).toBe("2632-guided-release-floor-0p5-all-noise-seed-0");
    expect(resolvePropertyView([groupEntry, tokenEntry], 6638, "group")).toEqual({ entry: groupEntry, exact: true });
    expect(resolvePropertyView([groupEntry, tokenEntry], 6638, "token")).toEqual({ entry: tokenEntry, exact: true });
    expect(resolvePropertyView([lipsEntry], 2632, "group")).toEqual({ entry: lipsEntry, exact: true });
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
    expect(randomUnexploredGroup(entries, 0, 1)).toBe(3);
    expect(randomUnexploredGroup(entries, 0, null)).toBe(1);
    expect(randomUnexploredGroup(entries, 0.999999, 1)).toBe(TOTAL_BASIS_GROUPS - 1);
  });
});

describe("recorded training stories selection", () => {
  test("selects the three curated training stories in order and matches published entries", () => {
    const r13345 = makeStoryRecord(TRAIN_STORY_MATERIAL_IDS[2], 13345);
    const r4009 = makeStoryRecord(TRAIN_STORY_MATERIAL_IDS[0], 4009);
    const r14544 = makeStoryRecord(TRAIN_STORY_MATERIAL_IDS[1], 14544);
    const rExtra = makeStoryRecord("block-2632-stage-6-pyramid-seeded-strongest-seed-0", 2632);

    const selected = selectTrainStories([rExtra, r13345, r4009, r14544]);
    expect(selected.map((record) => record.material)).toEqual([...TRAIN_STORY_MATERIAL_IDS]);

    const fallback = selectTrainStories([rExtra]);
    expect(fallback.map((record) => record.material)).toEqual([rExtra.material]);

    const exactEntry = makeEntry({ id: r4009.material, block: 4009 });
    const otherSameBlock = makeEntry({ id: "other-4009", block: 4009 });
    expect(storyEntryForRecord([otherSameBlock, exactEntry], r4009)).toBe(exactEntry);
    expect(storyEntryForRecord([otherSameBlock], r4009)).toBe(otherSameBlock);
    expect(storyEntryForRecord([], r4009)).toBeNull();
  });
});

describe("standalone embed candidates", () => {
  test("returns curated moving embed automata in order and falls back to the first fixture entry", () => {
    const leafVeins = makeEntry({ id: KEEP_AUTOMATON_IDS[0], block: 2801 });
    const paintings = makeEntry({ id: KEEP_AUTOMATON_IDS[1], block: 2088 });
    const wings = makeEntry({ id: KEEP_AUTOMATON_IDS[2], block: 12956 });
    const curves = makeEntry({ id: KEEP_AUTOMATON_IDS[3], block: 16250, layout: FIGURE_LAYOUT });

    expect(resolveKeepCandidates([curves, wings, paintings, leafVeins]).map((entry) => entry.id)).toEqual([
      ...KEEP_AUTOMATON_IDS,
    ]);

    const fixture = makeEntry({ id: "fixture-only", block: 4009 });
    expect(resolveKeepCandidates([fixture]).map((entry) => entry.id)).toEqual(["fixture-only"]);
  });
});
