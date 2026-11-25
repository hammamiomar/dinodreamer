// Domain selections and matrix builders for the four home stages (`features/home/*-stage.tsx`).
// Pure functions with no browser or React dependencies, tested directly in `home-specimens.test.ts`.

import { trainPathOfPlace } from "../automata/gallery";
import type { GalleryMethod, GalleryStart } from "../gallery/gallery-place";
import { featuredInBlock, placeOf, type MaterialEntry } from "../gallery/material-index";

/** Total basis groups in the released DINOv3 block-sparse featurizer. */
export const TOTAL_BASIS_GROUPS = 16384;

// --- Scene 1: Photographs vs. Grown Automata ---

export const PROPERTY_GROUPS = [6638, 13345, 729, 2632] as const;
export type PropertyGroup = (typeof PROPERTY_GROUPS)[number];
export type PropertyTarget = "group" | "token";

/**
 * Verified published automata pairing a 3-number basis-group target against a 768-number token target
 * on the same group's patches.
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
    group: "block-2632-stage-6-pyramid-seeded-strongest-seed-0",
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

// --- Scene 2: The 16,384 Basis Groups ---

export interface CollectionCoverage {
  total: number;
  withAutomaton: number;
  withoutAutomaton: number;
  /** Fraction in [0, 1] of groups that have at least one published automaton. */
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

/** Summary counts of explored vs. open basis groups across the 16,384-group collection. */
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
 * Draw a basis group uniformly at random (`random` in `[0, 1)`) from those with no published
 * automaton yet, excluding `current` so repeated clicks always deal a fresh group. No group is
 * preferred for how well it trains.
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

// --- Scene 3: Starts × Methods Training Matrix ---

export const TRAIN_STAGE_GROUP = 6638;
export const TRAIN_STAGE_STARTS = ["noise", "circle"] as const satisfies readonly GalleryStart[];
export type TrainStageStart = (typeof TRAIN_STAGE_STARTS)[number];

export const TRAIN_STAGE_METHODS = [
  "basis-group-mean",
  "basis-group-distribution",
  "token-mean",
  "token-distribution",
] as const satisfies readonly GalleryMethod[];
export type TrainStageMethod = (typeof TRAIN_STAGE_METHODS)[number];

export interface TrainMatrixCell {
  start: TrainStageStart;
  method: TrainStageMethod;
  /** First published automaton occupying this cell, or null when open. */
  entry: MaterialEntry | null;
  /** Direct `/train?block=...&start=...&method=...` link for open cells. */
  trainPath: string;
}

export interface TrainStageMatrix {
  group: number;
  cells: TrainMatrixCell[];
  filledCount: number;
}

/**
 * Choose the group whose Starts × Methods matrix is shown in Scene 3: `TRAIN_STAGE_GROUP` when
 * present in `entries`, else the first group in `entries`, else `TRAIN_STAGE_GROUP` (all open).
 */
export function chooseTrainMatrixGroup(entries: readonly Pick<MaterialEntry, "block">[]): number {
  if (entries.some((entry) => entry.block === TRAIN_STAGE_GROUP)) return TRAIN_STAGE_GROUP;
  return entries[0]?.block ?? TRAIN_STAGE_GROUP;
}

function compareCellCandidates(a: MaterialEntry, b: MaterialEntry): number {
  return Number(Boolean(b.cellPicture)) - Number(Boolean(a.cellPicture))
    || Number(featuredInBlock(b)) - Number(featuredInBlock(a))
    || Number(b.fired) - Number(a.fired)
    || (b.strength ?? -Infinity) - (a.strength ?? -Infinity)
    || b.publishedAt.localeCompare(a.publishedAt)
    || a.id.localeCompare(b.id);
}

/**
 * Build the `2 × 4` trainable Starts × Methods grid for `group`. Within each cell, featured and
 * target-meeting entries rank ahead of unfired runs, matching the gallery's own cell picture rule.
 */
export function buildTrainMatrix(entries: readonly MaterialEntry[], group: number): TrainStageMatrix {
  const groupEntries = entries.filter((entry) => entry.block === group).sort(compareCellCandidates);
  const cells: TrainMatrixCell[] = [];
  let filledCount = 0;
  for (const start of TRAIN_STAGE_STARTS) {
    for (const method of TRAIN_STAGE_METHODS) {
      const entry = groupEntries.find((candidate) => {
        const place = placeOf(candidate);
        if (place.start !== start) return false;
        if (place.method === method) return true;
        return method === "basis-group-mean" && place.method === "basis-group-mean-guided";
      }) ?? null;
      if (entry !== null) filledCount++;
      const trainPath = trainPathOfPlace(group, { start, method }) ?? `/train?block=${group}`;
      cells.push({ start, method, entry, trainPath });
    }
  }
  return { group, cells, filledCount };
}

// --- Scene 4: Standalone Embed & Rule Size ---

/** Featured automata offered in the standalone custom-element stage: two single-grid (7,776) and one two-grid (17,088). */
export const KEEP_AUTOMATON_IDS = [
  "block-12002-figure-strongest-mean-seed-0",
  "block-16250-figure-strongest-mean-seed-0",
  "2801-plain-all-noise-seed-0",
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
