// The Objective column shows movement, contributing terms and their total. Each
// term carries its weight, measured value and history; Response terms also show a
// code minimap. Hovering a row or the movement map previews its overlay on the canvas.

import type { InkTable } from "../inks";
import { useMemo } from "react";
import { TOTAL_SERIES, type RunState } from "../run/session";
import type { Recipe } from "../../../recipe";
import type { TermId } from "../model";
import { formatNumber, palette } from "../presentation";
import type { Selection } from "../state";
import { useBlockCloud } from "../detail/block-cloud";
import { minimapLegend } from "./legend";
import { Minimap } from "./minimap";
import { minimapFrame } from "./minimap-frame";
import { MovementMap } from "./movement-map";
import { MOVEMENT_SERIES } from "../run/movement";
import { objectiveRows, objectiveTotal, type ObjectiveRow } from "./rows";
import { Sparkline } from "./sparkline";
import { CREATE_TEXT } from "../create-text";

const WORDS = CREATE_TEXT.objective;

const MINIMAP_SIZE = 64;

export function ObjectiveColumn({
  recipe,
  inks,
  session,
  selection,
  openTerm,
  onHighlight,
  onHoverMovement,
  onSelectRow,
}: {
  recipe: Recipe;
  /** Every request's tones (inks.ts). */
  inks: InkTable;
  session: RunState;
  selection: Selection | null;
  /** The term without an area whose row is open in the Requests column, if any. */
  openTerm: TermId | null;
  /** The area to show on the canvas while a row is pointed at; null when none. */
  onHighlight(area: Selection | null): void;
  /** The movement map is pointed at: the canvas lays it over the image. */
  onHoverMovement(hovering: boolean): void;
  /** Clicking a row selects its term, or opens its row when the term has no area. */
  onSelectRow(row: ObjectiveRow): void;
}) {
  const rows = objectiveRows(recipe, session, inks);
  const total = objectiveTotal(rows);
  const hasMinimap = rows.some((row) => row.minimap);

  return (
    <section className="objective" aria-label={WORDS.name} onPointerLeave={() => onHighlight(null)}>
      <header className="objective-head">
        <div className="objective-movement" onPointerEnter={() => onHoverMovement(true)} onPointerLeave={() => onHoverMovement(false)}>
          <span className="label">{WORDS.movement}</span>
          <MovementMap cells={session.movement?.cells} />
          <span className="movement-figure">
            <span className="mono">{session.movement ? formatNumber(session.movement.mean) : "—"}</span>
            <span className="label">{WORDS.perUpdate}</span>
          </span>
          <Sparkline series={session.history[MOVEMENT_SERIES]} colour={palette().text} width={240} height={20} />
        </div>
      </header>
      {hasMinimap && <p className="label objective-legend">{minimapLegend(rows)}</p>}
      {rows.length === 0 && <p className="label">{WORDS.noTerm}</p>}
      <ul className="objective-rows">
        {rows.map((row) => (
          <ObjectiveRowView
            key={row.termId}
            row={row}
            series={session.history[row.termId]}
            selected={row.select ? sameSelection(selection, row.select) : openTerm === row.termId}
            onHighlight={onHighlight}
            onSelectRow={onSelectRow}
          />
        ))}
      </ul>
      {rows.length > 0 && (
        <div className="objective-total">
          <span className="label">{WORDS.total}</span>
          <span className="display mono">{total === undefined ? "—" : formatNumber(total)}</span>
          <Sparkline series={session.history[TOTAL_SERIES]} colour={palette().text} width={240} height={28} />
        </div>
      )}
    </section>
  );
}

function ObjectiveRowView({
  row,
  series,
  selected,
  onHighlight,
  onSelectRow,
}: {
  row: ObjectiveRow;
  series?: RunState["history"][string];
  selected: boolean;
  onHighlight(area: Selection | null): void;
  onSelectRow(row: ObjectiveRow): void;
}) {
  const classes = ["objective-row", row.pending ? "pending" : "", selected ? "selected" : "", row.area ? "has-area" : ""];
  // The whole row is the click target; the button inside carries it for the keyboard (its click bubbles here).
  return (
    <li
      className={classes.filter(Boolean).join(" ")}
      style={{ "--paint": row.ink } as React.CSSProperties}
      onPointerEnter={() => onHighlight(row.area)}
      onClick={() => onSelectRow(row)}
    >
      <button
        type="button"
        className="row-main"
        aria-pressed={selected}
        onFocus={() => onHighlight(row.area)}
        onBlur={() => onHighlight(null)}
      >
        <span className="row-name">
          {row.name}
          {row.scope && <span className="label"> · {row.scope}</span>}
        </span>
        <span className="row-weight label mono">× {formatNumber(row.weight)}</span>
        <span className="row-value mono">{row.weighted === undefined ? "—" : formatNumber(row.weighted)}</span>
      </button>
      <Sparkline series={series} colour={row.ink} width={200} height={20} />
      {row.minimap && <CodeMinimap minimap={row.minimap} ink={row.ink} />}
    </li>
  );
}

/**
 * Fits the frame to the recorded cloud and requested code, independently of measurements.
 */
function CodeMinimap({ minimap, ink }: { minimap: NonNullable<ObjectiveRow["minimap"]>; ink: string }) {
  const cloud = useBlockCloud(minimap.block, minimap.source);
  const { requested } = minimap;
  const frame = useMemo(
    () => minimapFrame([...cloud.map((point) => [point.code[0], point.code[1]] as const), [requested[0], requested[1]]]),
    [cloud, requested],
  );
  return <Minimap requested={requested} measured={minimap.measured} ink={ink} size={MINIMAP_SIZE} frame={frame} />;
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a?.kind !== "term" || b?.kind !== "term") return false;
  return a.requestId === b.requestId && a.term === b.term;
}
