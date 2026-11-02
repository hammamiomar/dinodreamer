import {
  FIGURE_LAYOUT, FIGURE_PYRAMID_LAYOUT, FIGURE_PYRAMID_RULE_VALUES, FIGURE_RULE_VALUES, type FigureLayout, type FigureStart,
} from "../materials/material-file";

// Rule and start are independent choices. The pyramid steps its 64-cell coarse grid before the
// 128-cell fine grid, whose cells read the coarse state. A central start uses noise inside a disc
// and zero elsewhere; a seeded field keeps the disc on noise at a quarter of its range. Both score
// only the central 4 × 4 patches. Saved files record the rule layout, start and reading region.

export type GrowRule = "cell" | "pyramid";
export type GrowStart = "noise" | "centre-disc" | "seeded-field";
export interface MaterialKind {
  rule: GrowRule;
  start: GrowStart;
}

/** The cell rule from noise, at pool 64. */
export const DEFAULT_KIND: MaterialKind = { rule: "cell", start: "noise" };
/** The seeded start's noise disc in fine cells: 812 cells of 128, rows and columns 48-79. The coarse disc is half. */
export const START_RADIUS = 16;
/** The seeded field's noise outside the disc, as a share of the start's range: the research recipe's quarter. */
export const SEEDED_FIELD_AMPLITUDE = 0.25;
/** Each start's word on the page, by kind; START_CHOICES offers the kinds Train trains today. */
export const START_WORDS: Record<GrowStart, string> = { noise: "Noise", "centre-disc": "Central noise", "seeded-field": "Seeded field" };

/** Rule choices and hints; the relative cost comes from a paired measurement of the two kinds. */
export const RULE_CHOICES: readonly { value: GrowRule; label: string; hint: string }[] = [
  { value: "cell", label: "Fine", hint: "one grid of 128 × 128 cells; fastest" },
  { value: "pyramid", label: "Coarse + fine", hint: "a coarse grid under the fine one: larger structure, about half again the time per update" },
];
export const START_CHOICES: readonly { value: GrowStart; label: string; hint: string }[] = [
  { value: "noise", label: "Noise", hint: "the automaton as a texture" },
  { value: "centre-disc", label: "Central noise", hint: "a localized figure in its surroundings; it may dissolve later" },
];

/** Stored recipe names, one per kind: figure, figure-seeded, figure-pyramid, figure-pyramid-seeded, and the seeded field's own. */
export function recipeName(kind: MaterialKind): string {
  const rule = kind.rule === "pyramid" ? "-pyramid" : "";
  if (kind.start === "seeded-field") return `figure${rule}-seeded-field-2026-11-02`;
  return `figure${rule}${kind.start === "centre-disc" ? "-seeded" : ""}-2026-10-23`;
}

export function ruleLayout(kind: MaterialKind): { layout: FigureLayout; values: number } {
  return kind.rule === "pyramid"
    ? { layout: FIGURE_PYRAMID_LAYOUT, values: FIGURE_PYRAMID_RULE_VALUES }
    : { layout: FIGURE_LAYOUT, values: FIGURE_RULE_VALUES };
}

/** The file's `start`: absent for noise; the disc, on faint noise for the seeded field. */
export function startField(kind: MaterialKind): FigureStart | undefined {
  if (kind.start === "noise") return undefined;
  const disc: FigureStart = { kind: "centre-disc", radius: START_RADIUS };
  return kind.start === "seeded-field" ? { ...disc, backgroundAmplitude: SEEDED_FIELD_AMPLITUDE } : disc;
}

/**
 * Noise starts must still fire at tick 2,000. Central starts need only fire at tick 600: their
 * localized figures can dissolve later, so the hold condition would reject valid seeded runs.
 */
export function firstFireHolds(kind: MaterialKind): boolean {
  return kind.start === "noise";
}

/** The reading's `region`: absent when it counts all 64 patches; the central 4 × 4 for both starts from a disc. */
export function readingRegion(kind: MaterialKind): "centre-4x4" | undefined {
  return kind.start === "noise" ? undefined : "centre-4x4";
}

/** "Coarse + fine · central noise", for the page. */
export function kindLabel(kind: MaterialKind): string {
  const rule = RULE_CHOICES.find((choice) => choice.value === kind.rule)!.label;
  return `${rule} · ${START_WORDS[kind.start].toLowerCase()}`;
}

/**
 * "Coarse + fine · seed at the center", for a saved automaton's name. A saved name is stored data,
 * so new names keep the words the earlier ones were saved with;
 * the page says the kind with kindLabel.
 */
export function savedNameKind(kind: MaterialKind): string {
  const rule = kind.rule === "pyramid" ? "Coarse + fine" : "Fine";
  const start = kind.start === "noise" ? "noise" : kind.start === "centre-disc" ? "seed at the center" : "seed on a faint field";
  return `${rule} · ${start}`;
}

/** The kind a /train address asks for (`rule`, `start`, as "Grow another variation" writes them); the default otherwise. */
export function kindFromSearch(search: URLSearchParams): MaterialKind {
  const rule = search.get("rule");
  const start = search.get("start");
  return {
    rule: rule === "cell" || rule === "pyramid" ? rule : DEFAULT_KIND.rule,
    start: start === "noise" || start === "centre-disc" ? start : DEFAULT_KIND.start,
  };
}
