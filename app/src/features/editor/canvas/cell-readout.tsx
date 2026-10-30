// The armed brush palette shows the hovered cell, or the last cell touched by a
// finger. A request shows both fields in their inks plus any measured Response error;
// Protect shows whether the cell is protected. The empty slot keeps its height.

import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import { GRID, type Recipe } from "../../../recipe";
import { formatShare } from "../../../ui/glossary";
import { termInk, type InkTable } from "../inks";
import { hasPaintedRespondArea, termArea, type AreaTerm, type Cell } from "../model";
import { formatNumber, TERM_TEXT } from "../presentation";
import type { Selection } from "../state";

export interface CellReadout {
  /** The cell's column and row, counted from 1 at the top left. */
  column: number;
  row: number;
  /** The request's fields at this cell, in card order, with their stored percentages and inks. */
  fields: { name: string; percentage: number; ink: string }[];
  /** Whether the cell is protected, when the brush paints Protect; null otherwise. */
  protect: boolean | null;
  /** The selected constraint's measured Response error at this cell, if any. */
  codeError: number | null;
}

/**
 * The readout for one cell, or null without a cell or a selection the brush paints. A request
 * shows both of its fields whichever one the brush paints, so the stroke's field is read beside
 * the other; a CLS or storage request has an Appearance field only.
 */
export function cellReadout(
  recipe: Recipe,
  selection: Selection | null,
  inks: InkTable,
  cell: Cell | undefined,
  codeError: number | null | undefined,
): CellReadout | null {
  if (!selection || !cell) return null;
  const index = cell.row * GRID + cell.column;
  const at = { column: cell.column + 1, row: cell.row + 1 };
  if (selection.kind === "protect") return { ...at, fields: [], protect: recipe.protect[index]!, codeError: null };
  if (selection.kind !== "term") return { ...at, fields: [], protect: null, codeError: null };
  const request = recipe.requests.find((candidate) => candidate.id === selection.requestId);
  if (!request) return null;
  const terms: AreaTerm[] = hasPaintedRespondArea(request.respondLike.source) ? ["respond", "look"] : ["look"];
  return {
    ...at,
    fields: terms.map((term) => ({
      name: TERM_TEXT[term].name,
      percentage: termArea(request, term)[index]!,
      ink: termInk(inks, request.id, term),
    })),
    protect: null,
    codeError: codeError ?? null,
  };
}

export function CellReadoutLine({ readout }: { readout: CellReadout | null }) {
  if (!readout) return null;
  // Each part stays whole; the line breaks only at the separators between parts.
  const parts: ReactNode[] = [
    <span key="cell">
      cell <b>({readout.column}, {readout.row})</b>
    </span>,
    ...readout.fields.map(({ name, percentage, ink }) => (
      <span key={name}>
        {name}{" "}
        <b className="cell-field-value" style={{ "--paint": ink } as CSSProperties}>
          {formatShare(percentage / 100)}
        </b>
      </span>
    )),
  ];
  if (readout.protect !== null) parts.push(<b key="protect">{readout.protect ? "protected" : "free"}</b>);
  if (readout.codeError !== null) {
    parts.push(
      <span key="error">
        Response error <b>{formatNumber(readout.codeError)}</b>
      </span>,
    );
  }
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && " · "}
          {part}
        </Fragment>
      ))}
    </>
  );
}
