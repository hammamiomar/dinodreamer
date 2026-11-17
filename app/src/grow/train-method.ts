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
 * How deep a token method compares DINO's tokens (Omar, 17 November 2026, evening, on meme's advice from
 * the research): four layers, the patch tokens after zero-based blocks 3, 6 and 9 and the final layer,
 * averaged in the loss (sweep T2), the default for both token methods; or the final layer alone, the
 * tokens the basis groups read. A basis-group method reads the final layer's codes and has no depth.
 */
export type TokenDepth = "four-layers" | "final-layer";
export const TOKEN_DEPTHS: readonly TokenDepth[] = ["four-layers", "final-layer"];
export const DEFAULT_DEPTH: TokenDepth = "four-layers";
const DEPTH_LAYERS: Record<TokenDepth, FigureLayer[]> = {
  "four-layers": ["block-3", "block-6", "block-9", "final"],
  "final-layer": ["final"],
};

/** The layers a method compares at a depth: a token method's depth, none for a basis-group method. */
export function methodLayers(method: FigureMethod, depth: TokenDepth = DEFAULT_DEPTH): FigureLayer[] {
  return methodReadsTokens(method) ? [...DEPTH_LAYERS[depth]] : [];
}

/** The depth of recorded layers (a continued file's), or null for layers Train does not offer. */
export function depthOfLayers(layers: readonly FigureLayer[]): TokenDepth | null {
  const found = TOKEN_DEPTHS.find((depth) => DEPTH_LAYERS[depth].length === layers.length
    && DEPTH_LAYERS[depth].every((layer, index) => layers[index] === layer));
  return found ?? null;
}

/** The depth a /train address asks for (`depth`: "final-layer"), the default otherwise. */
export function depthFromSearch(search: URLSearchParams): TokenDepth {
  const depth = search.get("depth");
  return (TOKEN_DEPTHS as readonly (string | null)[]).includes(depth) ? depth as TokenDepth : DEFAULT_DEPTH;
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
