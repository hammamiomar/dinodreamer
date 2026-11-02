// The Playground (playground-page.tsx): every published material one click from playing
// large. The rules: which materials the choices keep, what the head and a tile say, and which
// material plays first. The owner's view (features/owner/) plays the same index on the same
// stage, with Hide, Show and Purge.

import { fill, SITE_WORDS } from "../../app/site-words";
import type { MaterialKind } from "../../grow/material-kind";
import { FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import { ATLAS_TEXT } from "../atlas/atlas-text";
import type { MaterialEntry, MaterialStartKind } from "../gallery/material-index";

const WORDS = SITE_WORDS.playground;

export interface PlaygroundChoices {
  rule: MaterialKind["rule"] | "all";
  start: MaterialStartKind | "all";
  /** A family name from the release's provenance table, "unknown" for a block without one, or "all". */
  family: string;
}
export const EVERY_MATERIAL: PlaygroundChoices = { rule: "all", start: "all", family: "all" };

/** The two choices that trained the material, as Grow names them. */
export function entryKind(entry: MaterialEntry): MaterialKind {
  return { rule: entry.layout === FIGURE_PYRAMID_LAYOUT ? "pyramid" : "cell", start: entry.start };
}

/** The rule's word, the start's word, and whether the material was grown at 2 px per cell. */
function kindParts(entry: MaterialEntry): { rule: string; start: string; twoPixels: boolean } {
  const kind = entryKind(entry);
  return {
    rule: kind.rule === "pyramid" ? WORDS.ruleCoarseFine : WORDS.ruleFine,
    start: kind.start === "noise" ? WORDS.startNoise : kind.start === "centre-disc" ? WORDS.startSeeded : WORDS.startSeededField,
    twoPixels: entry.pixelsPerCell === 2,
  };
}

/** A tile's two lines, which fit its 128 px: "coarse + fine" over "seeded", "fine · 2 px" over "noise". */
export function tileName(entry: MaterialEntry): { rule: string; start: string } {
  const { rule, start, twoPixels } = kindParts(entry);
  return { rule: twoPixels ? `${rule} · ${WORDS.twoPixelsShort}` : rule, start };
}

/** The kind beside the block number: "coarse + fine · noise", "fine · 2 px per cell · seeded". */
export function kindLine(entry: MaterialEntry): string {
  const { rule, start, twoPixels } = kindParts(entry);
  return [rule, ...(twoPixels ? [WORDS.twoPixels] : []), start].join(" · ");
}

/** A tile's mean strength in m. Dimming indicates a missed target; response bands describe individual patches. */
export function tileReading(entry: MaterialEntry): string {
  return entry.strength === null ? "" : fill(WORDS.strengthInM, { strength: entry.strength.toFixed(2) });
}

/** Whether the choices keep this material; `family` is its block's, or undefined while unread. */
export function keptByChoices(entry: MaterialEntry, choices: PlaygroundChoices, family: string | undefined): boolean {
  const kind = entryKind(entry);
  return (choices.rule === "all" || kind.rule === choices.rule)
    && (choices.start === "all" || kind.start === choices.start)
    && (choices.family === "all" || (family ?? "unknown") === choices.family);
}

/**
 * The material on the stage: the one the address names (?material=, a kept one or a published
 * one), else the first kept one when the address asks for Yours (?group=yours), else the first
 * published one that fired.
 */
export function materialToPlay(
  asked: { id: string | null; yoursFirst: boolean },
  kept: readonly MaterialEntry[],
  published: readonly MaterialEntry[],
): MaterialEntry | null {
  const named = [...kept, ...published].find((entry) => entry.id === asked.id);
  if (named) return named;
  if (asked.yoursFirst && kept.length > 0) return kept[0]!;
  return firstToPlay(published);
}

/**
 * The Featured group, first on the shelf: the materials with the owner's mark (MaterialEntry.featured),
 * in the index's order. The owner mode lists hidden materials too and names them in `hiddenIds`; a
 * hidden one never appears. Empty when none is featured, and then the shelf shows no group. A
 * featured material also keeps its tile in its block's group.
 */
export function featuredMaterials(entries: readonly MaterialEntry[], hiddenIds: ReadonlySet<string> = new Set()): MaterialEntry[] {
  return entries.filter((entry) => entry.featured === true && !hiddenIds.has(entry.id));
}

/** The material that plays before the visitor picks one: the first that fired, in the index's order. */
export function firstToPlay(entries: readonly MaterialEntry[]): MaterialEntry | null {
  return entries.find((entry) => entry.fired) ?? entries[0] ?? null;
}

/** The Playground with this material playing, the link the home and a tile share. */
export function playgroundPath(entry: MaterialEntry): string {
  return `/automata?material=${encodeURIComponent(entry.id)}`;
}

/** One row of the choices: its word on the line, and its options, "Any" first. */
export interface ChoiceRow<K extends keyof PlaygroundChoices = keyof PlaygroundChoices> {
  key: K;
  label: string;
  options: readonly { value: PlaygroundChoices[K]; label: string }[];
}

/** The three rows: the rule and the start in the tiles' words, then the families present. */
export function choiceRows(families: readonly string[]): [ChoiceRow<"rule">, ChoiceRow<"start">, ChoiceRow<"family">] {
  return [
    { key: "rule", label: WORDS.rule, options: [{ value: "all", label: WORDS.anyOption }, { value: "cell", label: WORDS.ruleFine }, { value: "pyramid", label: WORDS.ruleCoarseFine }] },
    { key: "start", label: WORDS.start, options: [{ value: "all", label: WORDS.anyOption }, { value: "noise", label: WORDS.startNoise }, { value: "centre-disc", label: WORDS.startSeeded }] },
    { key: "family", label: WORDS.family, options: [{ value: "all", label: WORDS.anyOption }, ...families.map((family) => ({ value: family, label: familyName(family) }))] },
  ];
}

/** A row's word on the line: "any" when nothing is chosen, else the chosen option's word. */
export function chosenWord(row: ChoiceRow, value: string): string {
  if (value === "all") return WORDS.any;
  return row.options.find((option) => option.value === value)?.label ?? value;
}

/** Explore's name for a family (atlas-text.ts); a family the app does not know keeps its own name. */
export function familyName(family: string): string {
  return Object.hasOwn(ATLAS_TEXT.families, family) ? ATLAS_TEXT.families[family as keyof typeof ATLAS_TEXT.families] : family;
}

/** The families of the entries' blocks, each once, in Explore's order; a family Explore does not list comes last. */
export function familiesPresent(entries: readonly MaterialEntry[], families: ReadonlyMap<number, string>): string[] {
  const known = Object.keys(ATLAS_TEXT.families);
  const order = (family: string) => {
    const index = known.indexOf(family);
    return index < 0 ? known.length : index;
  };
  const present = new Set(entries.map((entry) => families.get(entry.block) ?? "unknown"));
  return [...present].sort((a, b) => order(a) - order(b));
}
