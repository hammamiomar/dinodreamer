// Per-cell error for the selected request's readout, from the latest measurement of
// the applied revision.

import { hasPaintedRespondArea } from "../model";
import { matchMap } from "../readout/readout";
import type { RunState } from "../run/session";
import type { Selection } from "../state";

export function selectedMatch(selection: Selection | null, session: RunState): (number | null)[] | undefined {
  const { measurement, applied } = session;
  if (selection?.kind !== "term" || !measurement || !applied || measurement.revision !== applied.revision) return undefined;
  const codes = measurement.codes.find((candidate) => candidate.requestId === selection.requestId);
  const request = applied.recipe.requests.find((candidate) => candidate.id === selection.requestId);
  if (!codes || !request || !hasPaintedRespondArea(request.respondLike.source)) return undefined;
  return matchMap(codes, request.respondLike.code);
}
