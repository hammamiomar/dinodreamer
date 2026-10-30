// Names and one-line definitions of the release statistics that views show, so
// each statistic has one name wherever it appears.

import { sourceParts } from "../library/provenance";
import type { FamilyTerm, SourcePart } from "../library/provenance";
import type { Provenance } from "../library/records";

/**
 * The release's `dimension` statistic: the participation ratio (Σλ)² / Σλ² of the
 * eigenvalues λ of the 3 × 3 covariance of the block's recorded codes in one role.
 * It lies between 1 and 3, or is 0 when the codes do not vary at all. Shown as
 * "directions used · 2.4 of 3": a property of the rank-3 block, not of the world.
 */
export const DIRECTIONS_USED = {
  name: "directions used",
  /** The largest value: a block's codes have three directions. */
  of: 3,
} as const;

/** "directions used · 2.4 of 3" */
export function directionsUsed(dimension: number): string {
  return `${DIRECTIONS_USED.name} · ${dimension.toFixed(1)} of ${DIRECTIONS_USED.of}`;
}

/** A picture's strongest-blocks list orders blocks by this, so one ubiquitous block does not fill every list. */
export const RELATIVE_RESPONSE = {
  name: "relative response",
  definition: "the basis group's strongest response in this picture ÷ its typical strong response (the 95th percentile of its recorded response magnitudes)",
} as const;

/** Joins words that a line must not break apart. */
export const NO_BREAK = "\u00a0";

/**
 * A block's provenance line: "made from · itself 25 % · its neighbours 21 % · farther away 40 % · the whole picture 2 % ·
 * constants 12 %". The block panel and Create print the same words (library/provenance.ts has the five parts). The
 * bar's "?" says what it shows; where the numbers come from is on the How
 * page, once.
 */
export const PROVENANCE = {
  name: "made from",
  definition:
    "A token's response vector in this basis group is a sum of vectors. DINOv3's last layer adds what the token carried itself, what it reads from its neighbors, from the surrounding area and from the whole picture, plus constants. The bar shows how far each one reaches along the final response vector. One that points the other way counts as negative.",
} as const;

/** The five parts' names, as the bar and the line print them; each is one word to change. */
export const SOURCE_PART_NAMES: Record<SourcePart, string> = {
  itself: "itself",
  nearby: "its neighbors",
  far: "the surrounding area",
  picture: "the whole picture",
  constants: "constants",
};

/** The one line the bar keeps under its rows: a record measured on too few tokens to have a response category. */
export const FEW_TOKENS = "Too few tokens measured to name a response category.";

/**
 * What a token's response reads as on the inspector's line: the block
 * responds where it is among the token's 32 strongest; a smaller response is weak, never
 * "does not respond", which is only for a response of zero.
 */
export function responseReading(norm: number, gated: boolean): string {
  if (norm === 0) return "does not respond here";
  return gated ? `responds here, ${norm.toFixed(2)}` : `responds weakly here, ${norm.toFixed(2)}`;
}

/** Under the code space, when the marked token has no entry in the contributions table. */
export const NO_ARROWS = "No arrows for this token: only the basis group's stored examples (the strong, moderate and by-direction pictures, at their listed token) have them.";

/** Why the bar cannot show a marked token's own parts: only listed examples were measured one by one. */
export const NO_TOKEN_PARTS = "Only the basis group's stored examples (the strong, moderate and by-direction pictures, at their listed token) have their own parts measured.";

/** What the bar shows: the marked token's own parts, or the block's average over its winning tokens. */
export const BAR_VIEWS = { token: "this token", average: "basis group average" } as const;
export type BarView = keyof typeof BAR_VIEWS;

/** Why a view shows the numbers without bars (library/provenance.ts, unstableParts). */
export const UNSTABLE_PARTS = "The response vector of this token kind is small against the constants, so the parts are unstable.";

/** A share as a whole percent, signed and unclamped: "−17 %", "114 %"; the number never breaks from its %. */
export function formatShare(share: number): string {
  const percent = Math.round(share * 100);
  // −0.4 % rounds to −0: it shows as 0 %.
  return percent < 0 ? `−${-percent}${NO_BREAK}%` : `${percent === 0 ? 0 : percent}${NO_BREAK}%`;
}

/**
 * "made from · itself −52 % · its neighbors 30 % · farther away 114 % · the whole picture −6 % · constants 14 %".
 * A narrow line breaks only at a " · ": each name stays with its value.
 */
export function sourceLine(provenance: Provenance): string {
  const parts = sourceParts(provenance).map(({ part, share }) => `${SOURCE_PART_NAMES[part].replaceAll(" ", NO_BREAK)}${NO_BREAK}${formatShare(share)}`);
  return [PROVENANCE.name.replaceAll(" ", NO_BREAK), ...parts].join(" · ");
}

/** The basis group viewer's response category line: "made mostly from near patches". */
const FAMILY_LINES: Readonly<Record<string, string>> = {
  local: "made mostly from the token itself",
  neighbourhood: "made mostly from its neighbors",
  surround: "made mostly from the surrounding area",
  global: "made mostly from the whole picture",
  position: "responds at a fixed place",
};

export function familyLine(family: string): string {
  return Object.hasOwn(FAMILY_LINES, family) ? FAMILY_LINES[family]! : `${familyName(family)} category`;
}

/** The name of the share an Index card shows: the other-token contribution in the order of all measured basis groups, a part of the bar in a response category. */
export const CONTEXT_SHARE_NAME = "other-token contribution";

/** The part of the bar each family ranks by (library/provenance.ts, FamilyTerm): itself is the table's local share. */
export const FAMILY_TERM_NAMES: Record<FamilyTerm, string> = {
  local: SOURCE_PART_NAMES.itself,
  near: SOURCE_PART_NAMES.nearby,
  far: SOURCE_PART_NAMES.far,
  global: SOURCE_PART_NAMES.picture,
};

/** "87 % on the border": where a Position block responds, as the fraction of its winning tokens on the grid's outer ring. */
export function borderShare(fraction: number): string {
  return `${formatShare(fraction)} on the border`;
}

/** The panel's line for a block with a split partner (research README §7.5). */
export function splitPartnerText(block: number): string {
  return `shares most of its tokens with basis group${NO_BREAK}${block}`;
}

/** The response families; a family a later table adds shows its own word. */
const FAMILY_NAMES: Readonly<Record<string, string>> = {
  local: "Own-token",
  neighbourhood: "Near-patch",
  surround: "Distant-patch",
  global: "Prefix-token",
  position: "Position-concentrated",
};

export function familyName(family: string): string {
  return Object.hasOwn(FAMILY_NAMES, family) ? FAMILY_NAMES[family]! : family;
}

/** Qualitative descriptions of each response category's strongest examples, not measurements. */
const ORDER_DESCRIPTIONS: Readonly<Record<string, string>> = {
  // Not "what the token itself shows": the local share does not predict how much a block keeps from its own cell (measured correlation ρ = 0.01).
  local: "Made mostly from the token itself: skin, for example.",
  neighbourhood: "Made mostly from the patches next to the token: the ground at a person's feet.",
  surround: "Made mostly from the surrounding area: the water around a fish.",
  global: "Made mostly from the whole picture: a scene or a style.",
  position: "Responds at a fixed place in the picture: corners and borders.",
};

export function orderDescription(order: string): string | null {
  return Object.hasOwn(ORDER_DESCRIPTIONS, order) ? ORDER_DESCRIPTIONS[order]! : null;
}
