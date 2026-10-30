// The one line under a term row when the term cannot run as written. Nothing is
// shown otherwise.

import type { Recipe } from "../../../recipe";
import { areaSize, getTerm, hasPaintedRespondArea, isTermActive, type TermId } from "../model";

/** The same rules as recipe.ts validateRecipe, for one term, in the row's words. */
export function termProblem(recipe: Recipe, termId: TermId): string | null {
  const term = getTerm(recipe, termId);
  if (!term || !isTermActive(term)) return null;
  const match = /^request:(\d+):(respond|look)$/.exec(termId);
  if (!match) return null;
  const request = recipe.requests.find((candidate) => candidate.id === Number(match[1]));
  if (!request) return null;
  if (match[2] === "respond") {
    if (!hasPaintedRespondArea(request.respondLike.source)) return null;
    return areaSize(request.respondLike.where) === 0 ? "no area painted" : null;
  }
  if (request.lookLike.references.length === 0) return "no reference picture";
  return areaSize(request.lookLike.where) === 0 ? "no area painted" : null;
}
