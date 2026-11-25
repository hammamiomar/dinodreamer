import { placeOf, type MaterialEntry } from "../features/gallery/material-index";
import { FIGURE_METHODS, FIGURE_PYRAMID_LAYOUT, methodReadsTokens, type FigureLayer, type FigureMethod } from "../materials/material-file";
import { DEFAULT_DEPTH, DEFAULT_METHOD, depthOfLayers } from "../grow/train-method";

/**
 * Grow's page for another variation of the same kind: the rule layout, the start and, when Train
 * trains it and it is not the default, the method of the automaton's place (Grow reads all three). A
 * place Train does not train, such as the guided mean, leaves Train's default method. A token method
 * takes its depth from the file the stage has loaded (`layers`, its settings.layers), the default
 * without it: the index does not record layers.
 */
export function growVariationPath(entry: MaterialEntry, layers?: readonly FigureLayer[]): string {
  const rule = entry.layout === FIGURE_PYRAMID_LAYOUT ? "pyramid" : "cell";
  const method = placeOf(entry).method;
  const named = method !== DEFAULT_METHOD && (FIGURE_METHODS as readonly string[]).includes(method);
  const trained = named ? `&method=${method}` : "";
  const depth = named && methodReadsTokens(method as FigureMethod) && layers ? depthOfLayers(layers) ?? DEFAULT_DEPTH : DEFAULT_DEPTH;
  const deep = depth === DEFAULT_DEPTH ? "" : `&depth=${depth}`;
  return `/train?block=${entry.block}&rule=${rule}&start=${entry.start}${trained}${deep}`;
}
