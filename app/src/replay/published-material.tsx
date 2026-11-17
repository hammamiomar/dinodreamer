import { placeOf, type MaterialEntry } from "../features/gallery/material-index";
import { FIGURE_METHODS, FIGURE_PYRAMID_LAYOUT } from "../materials/material-file";
import { DEFAULT_METHOD } from "../grow/train-method";

/** Train's page continuing this definition from its own rule (Train resume, case 2): a saved file's id or a published entry's. */
export function continueTrainingPath(entry: MaterialEntry): string {
  return `/train?continue=${encodeURIComponent(entry.id)}`;
}

/**
 * Grow's page for another variation of the same kind: the rule layout, the start and, when Train
 * trains it and it is not the default, the method of the automaton's place (Grow reads all three). A
 * place Train does not train, such as the guided mean, leaves Train's default method.
 */
export function growVariationPath(entry: MaterialEntry): string {
  const rule = entry.layout === FIGURE_PYRAMID_LAYOUT ? "pyramid" : "cell";
  const method = placeOf(entry).method;
  const named = method !== DEFAULT_METHOD && (FIGURE_METHODS as readonly string[]).includes(method);
  const trained = named ? `&method=${method}` : "";
  return `/train?block=${entry.block}&rule=${rule}&start=${entry.start}${trained}`;
}
