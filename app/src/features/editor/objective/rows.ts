// The Objective column's rows: one per term that contributes to the loss, in recipe
// order. The rows are the formula: the loss is the sum of the weighted rows.
//
// Each row carries the visitor's weight and, for a term the worker has applied as
// written, the value measured on the shown image. A term that differs from the
// applied recipe is pending: its weight is the visitor's, its value is not measured.
// model.ts keeps an unchanged term as the same object, so a term is applied exactly
// when the applied recipe holds that object. A Code row also carries the measured
// codes of its cells for the minimap, when the applied request asks for the same thing.

import { scaleCode } from "../../../code-target";
import type { Recipe, Request, Token } from "../../../recipe";
import type { CodeMeasurement } from "../../../synthesis/protocol";
import { getTerm, hasPaintedRespondArea, isTermActive, lookTermId, respondTermId, sameTarget, type TermId } from "../model";
import { TERM_TEXT, palette, tokenLabel } from "../presentation";
import { termInk, type InkTable } from "../inks";
import { latestShown, type RunState } from "../run/session";
import type { Selection } from "../state";
import type { Code } from "../readout/readout";

export type TermKind = "respond" | "look" | "tv" | "l2";

export interface ObjectiveRow {
  termId: TermId;
  kind: TermKind;
  name: string;
  /** What the term applies to, beside the name: "block 7125". */
  scope?: string;
  requestId?: number;
  ink: string;
  weight: number;
  /** weight × value on the shown image; undefined while pending or before a measurement. */
  weighted?: number;
  /** The term as written is not the applied one: changed, or never applied. */
  pending: boolean;
  /** The area shown on the canvas while the row is pointed at; null for terms of the whole image. */
  area: Selection | null;
  /**
   * What clicking the row selects: a request's term (its card row lights, the canvas
   * paints it if it has an area); null for the image rules, which open their row instead.
   */
  select: Selection | null;
  /**
   * A Code row's minimap: the token's code and the measured codes, [P, 3]: the painted
   * cells' codes, or for a CLS or storage request the one code of the canvas's own token.
   * `block` and `source` name the recorded codes the minimap's frame is fitted to.
   */
  minimap?: {
    requested: Code;
    measured?: Float32Array;
    kind: "cells" | "prefix";
    tokenLabel: string;
    block: number;
    source: Token;
  };
}

export function objectiveRows(recipe: Recipe, session: RunState, inks: InkTable): ObjectiveRow[] {
  const applied = session.applied?.recipe;
  const isPending = (termId: TermId) => !applied || getTerm(applied, termId) !== getTerm(recipe, termId);
  const measured = measuredValues(session);
  const rows: ObjectiveRow[] = [];

  function push(row: Omit<ObjectiveRow, "pending" | "weighted">) {
    const pending = isPending(row.termId);
    rows.push({ ...row, pending, weighted: pending ? undefined : measured.get(row.termId) });
  }

  for (const request of recipe.requests) {
    const ink = termInk(inks, request.id, "respond");
    if (isTermActive(request.respondLike)) {
      const painted = hasPaintedRespondArea(request.respondLike.source);
      const respond: Selection = { kind: "term", requestId: request.id, term: "respond" };
      push({
        termId: respondTermId(request.id),
        kind: "respond",
        name: TERM_TEXT.respond.name,
        scope: `basis group ${request.block}`,
        requestId: request.id,
        ink,
        weight: request.respondLike.weight,
        area: painted ? respond : null,
        select: respond,
        minimap: {
          requested: scaleCode(request.respondLike.code, request.respondLike.radius),
          measured: measuredCodes(session, request)?.codes,
          kind: painted ? "cells" : "prefix",
          tokenLabel: tokenLabel(request.respondLike.source),
          block: request.block,
          source: request.respondLike.source,
        },
      });
    }
    if (isTermActive(request.lookLike)) {
      const look: Selection = { kind: "term", requestId: request.id, term: "look" };
      push({
        termId: lookTermId(request.id),
        kind: "look",
        name: TERM_TEXT.look.name,
        requestId: request.id,
        ink: termInk(inks, request.id, "look"),
        weight: request.lookLike.weight,
        area: look,
        select: look,
      });
    }
  }
  const accent = palette().ask;
  if (isTermActive(recipe.rules.tv)) {
    push({ termId: "rules:tv", kind: "tv", name: TERM_TEXT.tv.name, ink: accent, weight: recipe.rules.tv.weight, area: null, select: null });
  }
  if (isTermActive(recipe.rules.l2)) {
    push({ termId: "rules:l2", kind: "l2", name: TERM_TEXT.l2.name, ink: accent, weight: recipe.rules.l2.weight, area: null, select: null });
  }
  return rows;
}

/** The loss as the sum of the rows' measured values, or undefined until every row has one. */
export function objectiveTotal(rows: ObjectiveRow[]): number | undefined {
  if (rows.length === 0 || rows.some((row) => row.weighted === undefined)) return undefined;
  return rows.reduce((sum, row) => sum + (row.weighted ?? 0), 0);
}

/**
 * Weighted term values from the shown image, when the app still holds the recipe
 * that produced it; an older image belongs to another objective and shows nothing.
 */
function measuredValues(session: RunState): Map<string, number> {
  const shown = latestShown(session);
  const producing = shown !== undefined && session.applied?.revision === shown.revision;
  return new Map(producing ? shown.terms.map((term) => [term.id, term.weighted]) : []);
}

/**
 * The measured codes of one request's cells from the latest measurement of the applied
 * revision, when the applied request with this id asks for the same thing (ids can
 * return after a removal).
 */
export function measuredCodes(session: RunState, request: Request): (CodeMeasurement & { appliedField: Request["respondLike"]["where"] }) | undefined {
  const { measurement, applied } = session;
  if (!measurement || !applied || measurement.revision !== applied.revision) return undefined;
  const appliedRequest = applied.recipe.requests.find((candidate) => candidate.id === request.id);
  if (!appliedRequest || !sameTarget(appliedRequest, request)) return undefined;
  const codes = measurement.codes.find((codes) => codes.requestId === request.id);
  return codes ? { ...codes, appliedField: appliedRequest.respondLike.where } : undefined;
}
