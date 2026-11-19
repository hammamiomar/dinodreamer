// Formatting helpers for an automaton entry's rule layout, pixel scale, and start mode.

import { SITE_WORDS } from "../../app/site-words";
import type { MaterialKind } from "../../grow/material-kind";
import { FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import type { MaterialEntry } from "../gallery/material-index";

const WORDS = SITE_WORDS.playground;

/** Rule layout and start mode that produced a material entry. */
export function entryKind(entry: MaterialEntry): MaterialKind {
  return { rule: entry.layout === FIGURE_PYRAMID_LAYOUT ? "pyramid" : "cell", start: entry.start };
}

function kindParts(entry: MaterialEntry): { rule: string; start: string; twoPixels: boolean } {
  const kind = entryKind(entry);
  return {
    rule: kind.rule === "pyramid" ? WORDS.ruleCoarseFine : WORDS.ruleFine,
    start: kind.start === "noise" ? WORDS.startNoise : kind.start === "centre-disc" ? WORDS.startSeeded : WORDS.startSeededField,
    twoPixels: entry.pixelsPerCell === 2,
  };
}

/** Two-line tile labels for rule layout and start mode. */
export function tileName(entry: MaterialEntry): { rule: string; start: string } {
  const { rule, start, twoPixels } = kindParts(entry);
  return { rule: twoPixels ? `${rule} · ${WORDS.twoPixelsShort}` : rule, start };
}

/** Single-line description of rule layout, optional pixel scale, and start mode. */
export function kindLine(entry: MaterialEntry): string {
  const { rule, start, twoPixels } = kindParts(entry);
  return [rule, ...(twoPixels ? [WORDS.twoPixels] : []), start].join(" · ");
}
