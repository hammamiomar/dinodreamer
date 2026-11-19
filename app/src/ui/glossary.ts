// Shared labels and formatting for provenance shares shown in editor cards and readouts.

import type { SourcePart } from "../library/provenance";

const NO_BREAK = "\u00a0";

/** Name and tooltip definition for the provenance breakdown bar. */
export const PROVENANCE = {
  name: "made from",
  definition:
    "A token's response vector in this basis group is a sum of vectors. DINOv3's last layer adds what the token carried itself, what it reads from its neighbors, from the surrounding area and from the whole picture, plus constants. The bar shows how far each one reaches along the final response vector. One that points the other way counts as negative.",
} as const;

/** Display labels for the five provenance components. */
export const SOURCE_PART_NAMES: Record<SourcePart, string> = {
  itself: "itself",
  nearby: "its neighbors",
  far: "the surrounding area",
  picture: "the whole picture",
  constants: "constants",
};

/** Format a share as a signed whole percent ("−17 %", "114 %") with a non-breaking space before %. */
export function formatShare(share: number): string {
  const percent = Math.round(share * 100);
  // −0.4 % rounds to −0; display as 0 %.
  return percent < 0 ? `−${-percent}${NO_BREAK}%` : `${percent === 0 ? 0 : percent}${NO_BREAK}%`;
}
