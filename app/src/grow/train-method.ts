import {
  FIGURE_METHODS, methodNeedsSet, methodReadsTokens, type FigureLayer, type FigureMethod,
} from "../materials/material-file";

// Train's method: one choice of space and one of comparison (research/given-set, "The four methods").
// The space is the basis group, the 3 numbers it reads from a token, or the token, DINO's 768 numbers
// for a patch. Mean matching asks for the canvas's average; distribution matching asks the canvas's
// patches to be spread like the target set's. Every method but basis-group mean matching compares the
// canvas with a target set (target-set.ts). The engine computes each loss (engine/src/grow/figure.rs).

export type TrainSpace = "basis-group" | "token";
export type TrainComparison = "mean" | "distribution";
export const TRAIN_SPACES: readonly TrainSpace[] = ["basis-group", "token"];
export const TRAIN_COMPARISONS: readonly TrainComparison[] = ["mean", "distribution"];

/** Omar's decision 4 (17 November 2026): Train's default stays basis-group mean matching. */
export const DEFAULT_METHOD: FigureMethod = "basis-group-mean";

export function methodOf(space: TrainSpace, comparison: TrainComparison): FigureMethod {
  return `${space}-${comparison}`;
}

export function spaceOf(method: FigureMethod): TrainSpace {
  return method.startsWith("token-") ? "token" : "basis-group";
}

export function comparisonOf(method: FigureMethod): TrainComparison {
  return method.endsWith("-distribution") ? "distribution" : "mean";
}

/**
 * The layers a token method compares, averaged in its loss. Omar has not decided them; until he does,
 * they are the research's standard runs: token distribution at blocks 3, 6 and 9 (zero-based) and the
 * final layer (sweep T2), token mean at the final layer. A basis-group method reads the final layer's
 * codes and records no layers.
 */
export function methodLayers(method: FigureMethod): FigureLayer[] {
  if (!methodReadsTokens(method)) return [];
  return method === "token-distribution" ? ["block-3", "block-6", "block-9", "final"] : ["final"];
}

/**
 * How a training of this method runs and what it keeps (Omar's decision 3, 17 November 2026).
 * Basis-group mean matching trains up to `runs` seeds: a run whose final rule misses the selection
 * target is followed by the next seed, and the first checkpoint that meets it is kept as it comes.
 * A set method trains one seed to the end and keeps its final rule; the selection is a reading only.
 * A continuation trains one run whatever the method.
 */
export interface KeepRule {
  runs: number;
  /** Keep the first checkpoint that meets the selection target, and offer to stop there. */
  keepsFirstFire: boolean;
  /** Offer the final rule to publish only when it met the selection target. */
  publishesOnlyFired: boolean;
}

export function keepRule(method: FigureMethod, continued: boolean, seeds: number): KeepRule {
  const set = methodNeedsSet(method);
  return { runs: continued || set ? 1 : seeds, keepsFirstFire: !set, publishesOnlyFired: !set };
}

/** The method a /train address asks for (`method`, as "Train a variation" writes it); the default otherwise. */
export function methodFromSearch(search: URLSearchParams): FigureMethod {
  const method = search.get("method");
  return (FIGURE_METHODS as readonly (string | null)[]).includes(method) ? method as FigureMethod : DEFAULT_METHOD;
}
