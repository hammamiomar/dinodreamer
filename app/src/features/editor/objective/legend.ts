// The minimap legend of the Objective column. A patch constraint's dots are its painted
// cells' response vectors; a CLS or storage constraint has no cells, its one dot is the image's
// own token of that kind, so the legend names that token when such a constraint is present.

import { tokenLabel } from "../presentation";
import type { ObjectiveRow } from "./rows";

export const RING_LEGEND = "◯ the token's response vector";

/** "● one cell's response vector · ◯ the token's response vector", with each prefix token present named. */
export function minimapLegend(rows: ObjectiveRow[]): string {
  const parts: string[] = [];
  const codeRows = rows.filter((row) => row.minimap);
  if (codeRows.some((row) => row.minimap?.kind === "cells")) parts.push("● one cell's response vector");
  const prefixLabels = new Set(codeRows.flatMap((row) => (row.minimap?.kind === "prefix" ? [row.minimap.tokenLabel] : [])));
  for (const label of prefixLabels) parts.push(`● the ${label}'s response vector`);
  parts.push(RING_LEGEND);
  return parts.join(" · ");
}

/** The caption of a constraint's detail: what its dots are, in its basis group. */
export function detailCaption(request: { block: number; respondLike: { source: Parameters<typeof tokenLabel>[0] } }, painted: boolean): string {
  const dots = painted
    ? `each dot is one painted cell's response vector in basis group ${request.block}`
    : `the dot is the image's ${tokenLabel(request.respondLike.source)}'s response vector in basis group ${request.block}`;
  return `${dots}; the ring is the token's response vector; the distance is the root mean square of the dots' distances to it`;
}
