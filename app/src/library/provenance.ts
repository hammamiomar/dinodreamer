// A block's provenance as views show it: what writes its code. The record
// (records.ts, Provenance) has nine signed parts, which sum to 1. A reader sees
// them in five groups that still sum to 1: the token itself (carried from the
// earlier layers, its attention to itself and the MLP: the table's local share,
// so the largest of the first four parts names the block's family), the patches
// near it, the patches far from it, the whole picture (CLS and storage), and the
// constants (the attention's bias and the readout's constant). Explore, the block
// panel and Create read these functions; their words are in ui/glossary.ts.

import type { BlockProvenance, Provenance } from "./records";
import type { LibraryRole } from "./roles";

export const SOURCE_PARTS = ["itself", "nearby", "far", "picture", "constants"] as const;
export type SourcePart = (typeof SOURCE_PARTS)[number];

export interface SourceShare {
  part: SourcePart;
  /** Signed, unclamped: −0.17 and 1.14 are measured values. */
  share: number;
}

/**
 * The five parts in display order, each with its share; they sum to 1. Itself is
 * the table's local share (carried + self + MLP), the term the family rule uses.
 */
export function sourceParts(provenance: Provenance): SourceShare[] {
  return [
    { part: "itself", share: provenance.local },
    { part: "nearby", share: provenance.near },
    { part: "far", share: provenance.far },
    { part: "picture", share: provenance.cls + provenance.storage },
    { part: "constants", share: provenance.attentionBias + provenance.constant },
  ];
}

/**
 * One token's five shares (a contributions entry, in the table's part order, which
 * is the bar's) as the bar's parts, so the bar can show that token instead of the
 * block's average.
 */
export function tokenParts(shares: readonly number[]): SourceShare[] {
  return SOURCE_PARTS.map((part, index) => ({ part, share: shares[index] ?? 0 }));
}

/**
 * The range in which the parts read as shares of one code. A CLS or storage
 * token's code is small against the constants, so its parts can reach −450 % or
 * +470 % (block 10586 in S2); outside this range a view shows its numbers without
 * bars. In the 8,192-picture table five prefix records lie outside it, and one
 * patch record (block 434, itself −54 %): a patch's code is not small, so its
 * bars stay, clipped at 0.
 */
const STABLE_SHARES = { lowest: -0.5, highest: 1.5 } as const;

/** Whether a CLS or storage token's parts are too unstable to draw as bars: any of them outside −50 % to +150 %. */
export function unstableParts(parts: readonly SourceShare[], role: LibraryRole): boolean {
  if (role === "patch") return false;
  return parts.some(({ share }) => share < STABLE_SHARES.lowest || share > STABLE_SHARES.highest);
}

/** The block's record in one role, or null when the table has none there. */
export function provenanceOf(file: BlockProvenance, role: LibraryRole): Provenance | null {
  return file.roles[role] ?? null;
}

/** The terms a block's family is chosen by: the largest of the four names the family. */
export type FamilyTerm = "local" | "near" | "far" | "global";
