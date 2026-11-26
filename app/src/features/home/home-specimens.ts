// Domain selections and curated specimen rules for the four home stages (`features/home/*-stage.tsx`).
// Pure functions with no browser or React dependencies, tested directly in `home-specimens.test.ts`.

import type { MaterialEntry } from "../gallery/material-index";
import type { StoryRecord } from "../how/training-story";

/** Total basis groups in the released DINOv3 block-sparse featurizer. */
export const TOTAL_BASIS_GROUPS = 16384;

// --- Scene 1: Look Inside (Isolated Pattern vs. Surrounding Scene) ---

export const PROPERTY_GROUPS = [6638, 13345, 729, 2632] as const;
export type PropertyGroup = (typeof PROPERTY_GROUPS)[number];
export type PropertyTarget = "group" | "token";

/**
 * Verified published automata pairing an isolated 3-number pattern target against a full 768-number
 * surrounding-patch target on the same group's photographs.
 */
export const PROPERTY_AUTOMATA: Record<PropertyGroup, Record<PropertyTarget, string>> = {
  6638: {
    group: "6638-guided-all-noise-seed-0",
    token: "6638-given-set-centre-disc-seed-0",
  },
  13345: {
    group: "block-13345-stage-6-pyramid-strongest-seed-1",
    token: "13345-given-set-centre-disc-seed-0",
  },
  729: {
    group: "729-guided-centre-disc-seed-0",
    token: "729-given-set-centre-disc-seed-0",
  },
  2632: {
    group: "2632-guided-release-floor-0p5-all-noise-seed-0",
    token: "2632-given-set-centre-disc-seed-0",
  },
};

export interface ResolvedPropertyView {
  entry: MaterialEntry | null;
  exact: boolean;
}

/**
 * Resolve the published entry for `(group, target)`. When a test fixture supplies only a single
 * seed entry rather than the full gallery index, fall back to any entry of that group or the first
 * entry in the index while marking `exact: false` so the caption stays truthful.
 */
export function resolvePropertyView(
  entries: readonly MaterialEntry[],
  group: PropertyGroup,
  target: PropertyTarget,
): ResolvedPropertyView {
  const wantedId = PROPERTY_AUTOMATA[group][target];
  const exact = entries.find((candidate) => candidate.id === wantedId);
  if (exact) return { entry: exact, exact: true };
  const sameGroup = entries.find((candidate) => candidate.block === group);
  if (sameGroup) return { entry: sameGroup, exact: false };
  return { entry: entries[0] ?? null, exact: false };
}

// --- Scene 2: The 16,384 Visual Patterns ---

export interface CollectionCoverage {
  total: number;
  withAutomaton: number;
  withoutAutomaton: number;
  /** Fraction in [0, 1] of patterns that have at least one published living image. */
  fraction: number;
}

/** Distinct basis groups represented in `entries`, sorted in ascending group order. */
export function groupsWithAutomata(entries: readonly Pick<MaterialEntry, "block">[]): number[] {
  const seen = new Set<number>();
  for (const entry of entries) {
    if (Number.isInteger(entry.block) && entry.block >= 0 && entry.block < TOTAL_BASIS_GROUPS) {
      seen.add(entry.block);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** Summary counts of explored vs. open visual patterns across the 16,384-pattern collection. */
export function collectionCoverage(entries: readonly Pick<MaterialEntry, "block">[]): CollectionCoverage {
  const withAutomaton = groupsWithAutomata(entries).length;
  const withoutAutomaton = Math.max(0, TOTAL_BASIS_GROUPS - withAutomaton);
  return {
    total: TOTAL_BASIS_GROUPS,
    withAutomaton,
    withoutAutomaton,
    fraction: withAutomaton / TOTAL_BASIS_GROUPS,
  };
}

/**
 * Draw a pattern uniformly at random (`random` in `[0, 1)`) from those with no published living
 * image yet, excluding `current` so repeated clicks always deal a fresh pattern.
 */
export function randomUnexploredGroup(
  entries: readonly Pick<MaterialEntry, "block">[],
  random: number,
  current: number | null = null,
): number {
  const excluded = new Set(groupsWithAutomata(entries));
  if (current !== null) excluded.add(current);
  const available = TOTAL_BASIS_GROUPS - excluded.size;
  if (available <= 0) return current ?? 0;
  const clamped = Math.min(0.999999999, Math.max(0, random));
  let rank = Math.floor(clamped * available);
  for (let candidate = 0; candidate < TOTAL_BASIS_GROUPS; candidate++) {
    if (excluded.has(candidate)) continue;
    if (rank === 0) return candidate;
    rank--;
  }
  return 0;
}

// --- Scene 3: Recorded Training Runs ---

/** Verified crisp noise training runs from `/story/story.json`, ordered for the Beat 3 story tabs. */
export const TRAIN_STORY_MATERIAL_IDS = [
  "block-4009-figure-pyramid-strongest-seed-0",
  "block-14544-stage-6-noise-strongest-seed-0",
  "block-13345-stage-6-pyramid-strongest-seed-1",
] as const;
export type TrainStoryMaterialId = (typeof TRAIN_STORY_MATERIAL_IDS)[number];

/**
 * Select the curated training story records in display order. Falls back to the first three
 * records when a fixture supplies a reduced story list.
 */
export function selectTrainStories(records: readonly StoryRecord[]): StoryRecord[] {
  const byMaterial = new Map(records.map((record) => [record.material, record]));
  const curated = TRAIN_STORY_MATERIAL_IDS.flatMap((id) => {
    const match = byMaterial.get(id);
    return match ? [match] : [];
  });
  if (curated.length > 0) return curated;
  return records.slice(0, TRAIN_STORY_MATERIAL_IDS.length);
}

/**
 * Find the published gallery entry corresponding to a recorded training run: exact `id` match
 * first, then any entry of the same block so fixture indices still link cleanly.
 */
export function storyEntryForRecord(
  entries: readonly MaterialEntry[],
  record: Pick<StoryRecord, "material" | "block">,
): MaterialEntry | null {
  const exact = entries.find((candidate) => candidate.id === record.material);
  if (exact) return exact;
  return entries.find((candidate) => candidate.block === record.block) ?? null;
}

// --- Scene 4: Standalone Embed ---

/** Verified continuously moving automata offered in the standalone custom-element stage. */
export const KEEP_AUTOMATON_IDS = [
  "2801-plain-all-noise-seed-0",
  "2088-guided-all-noise-seed-0",
  "12956-guided-all-noise-seed-0",
  "block-16250-figure-strongest-mean-seed-0",
] as const;

/**
 * Published entries for the standalone embed stage: the curated list in order when present,
 * falling back to the first available entry in minimal test fixtures.
 */
export function resolveKeepCandidates(entries: readonly MaterialEntry[]): MaterialEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const found = KEEP_AUTOMATON_IDS.flatMap((id) => {
    const match = byId.get(id);
    return match ? [match] : [];
  });
  if (found.length > 0) return found;
  return entries.slice(0, 1);
}
