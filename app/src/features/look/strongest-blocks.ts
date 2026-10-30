import { CELLS } from "../../recipe";
import type { TokenResponses } from "../../library/records";

/**
 * The firing cells as patch responses for the overlay. The file has no per-cell
 * strengths, so every firing cell draws at the picture's strongest tint.
 */
export function firingCells(cells: readonly number[]): TokenResponses {
  const fires = new Set(cells);
  const gated = Array.from({ length: CELLS }, (_, cell) => fires.has(cell));
  return { norm: gated.map((cell) => (cell ? 1 : 0)), gated };
}
