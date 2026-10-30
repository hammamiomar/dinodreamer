import type { MaterialEntry } from "../features/gallery/material-index";
import { FIGURE_PYRAMID_LAYOUT } from "../materials/material-file";

/** Train's page continuing this definition from its own rule (Train resume, case 2): a saved file's id or a published entry's. */
export function continueTrainingPath(entry: MaterialEntry): string {
  return `/train?continue=${encodeURIComponent(entry.id)}`;
}

/** Grow's page for another variation of the same kind: the rule layout and the start (Grow reads both). */
export function growVariationPath(entry: MaterialEntry): string {
  const rule = entry.layout === FIGURE_PYRAMID_LAYOUT ? "pyramid" : "cell";
  return `/train?block=${entry.block}&rule=${rule}&start=${entry.start}`;
}
