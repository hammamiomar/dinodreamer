// Pure view-layout and label helpers for MaterialStage (material-stage.tsx).

/**
 * Desktop zooms use whole CSS pixels per picture pixel. The stage picks the largest zoom
 * that fits its column without changing the simulation grid or backing canvas.
 */
export const ZOOMS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Brush radius bounds and step, in multiples of 4 CSS pixels. */
export const BRUSH = { min: 2, max: 32, start: 12, step: 1 };

/**
 * Largest zoom that fits `room` CSS pixels, at least 1.
 */
export function stageZoom(pictureSide: number, room: number): number {
  const fitting = ZOOMS.filter((zoom) => pictureSide * zoom <= room);
  return fitting.length > 0 ? fitting[fitting.length - 1]! : ZOOMS[0];
}

/** Brush radius after `notches` wheel steps (positive: larger), clamped to BRUSH bounds. */
export function brushAfterWheel(brush: number, notches: number): number {
  return Math.min(BRUSH.max, Math.max(BRUSH.min, brush + notches * BRUSH.step));
}

/**
 * Strip a leading `<block> · ` prefix from a variation title so the block number is not
 * repeated. Calls `fallbackName` when the entry has no explicit title.
 */
export function variationNameFor<T extends { block: number; title: string }>(
  entry: T,
  fallbackName: (entry: T) => string,
): string {
  const prefix = `${entry.block} · `;
  if (entry.title === "") return fallbackName(entry);
  return entry.title.startsWith(prefix) ? entry.title.slice(prefix.length) : entry.title;
}

/** Strip a trailing ISO date suffix from a recipe name (e.g. "figure-seeded-2026-10-23" -> "figure-seeded"). */
export function recipeWord(recipe: string): string {
  return recipe.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}
