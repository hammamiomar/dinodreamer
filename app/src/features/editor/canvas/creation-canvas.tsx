// The shared Create and dock canvas draws the image and selected fields. Pointer
// gestures preview a draft stroke, then report it as one edit. Left paints, right
// erases and the wheel changes brush size; the dock requires a held button for wheel
// resizing so the surrounding page can scroll.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent } from "react";
import { GRID, type Area, type Recipe } from "../../../recipe";
import type { Cell, Stroke } from "../model";
import { palette } from "../presentation";
import { defaultPair, termInk, type InkTable } from "../inks";
import { selectionErases } from "../noise";
import { applyScopedStroke, paintableSelection, type Selection, type StrokeScope, type StrokeTarget } from "../state";
import { useCoarsePointer } from "../coarse-pointer";
import {
  brushSizeAfterWheel,
  cellAt,
  dabFootprint,
  paintSegment,
  startStroke,
  quantizeDeposit,
  footprintDeposit,
  strokeModeOfButton,
  type Brush,
  type GridPoint,
} from "./brush";
import { CELL_SIZE, DISPLAY_SIZE, drawCanvas, pixelsToCanvas } from "./draw";
import { CellReadoutLine, cellReadout } from "./cell-readout";
import { canvasOverlay, type AreaFill } from "./overlay";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";
import "./canvas.css";

const WORDS = CREATE_TEXT.canvas;

export interface CreationCanvasProps {
  pixels?: Uint8ClampedArray;
  recipe: Recipe;
  /** Every request's tones (inks.ts). */
  inks: InkTable;
  opened: number;
  selection: Selection | null;
  /** An area to show instead of the selection, while an Objective row is pointed at. */
  highlight?: Selection | null;
  /** The movement map's lightness per cell, laid over the image while the map is pointed at. */
  movement?: Float32Array;
  brush: Brush;
  /** The touch Erase toggle: the primary button erases. */
  primaryErases: boolean;
  /** What a stroke reaches: the selected term alone, or both areas of a linked request (state.ts, the lock rule). */
  strokeScope?: StrokeScope;
  /** The selected request's per-cell code error from the latest measurement, if any. */
  match?: (number | null)[];
  /** The scroll wheel resizes the brush only while a button is held (the dock, which floats over a scrolling page). */
  wheelNeedsButton?: boolean;
  /** Show how to add the first request when the canvas is empty (Create only). */
  emptyHint?: boolean;
  /** Why the last request was refused (EditorState.refusal). */
  refusal: string | null;
  /** Where the cell readout line goes: the line over the canvas on Create. The dock has none. */
  readoutTarget?: HTMLElement | null;
  anchorPick?: { requestId: number; endpoint: 0 | 1 } | null;
  onAnchorCell?(cell: number): void;
  onCancelAnchor?(): void;
  onStroke(stroke: Stroke, target: StrokeTarget): void;
  onBrushSize(size: number): void;
}

interface Draft {
  mode: Stroke["mode"];
  cells: number[];
  last: GridPoint;
  target: StrokeTarget;
  pointerId: number;
}

export function CreationCanvas(props: CreationCanvasProps) {
  const {
    pixels,
    recipe,
    inks,
    opened,
    selection,
    highlight,
    movement,
    brush,
    primaryErases,
    strokeScope = "term",
    match,
    wheelNeedsButton = false,
    emptyHint = false,
    refusal,
    readoutTarget = null,
    anchorPick,
    onAnchorCell,
    onCancelAnchor,
    onStroke,
    onBrushSize,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [hover, setHover] = useState<GridPoint | null>(null);
  /**
   * The cell the readout slot shows: the cell under a mouse or a pen, gone when
   * it leaves the canvas; the last cell a finger touched, kept after the finger lifts until another
   * cell is touched. Either way only for the selection it was read with.
   */
  const [readCell, setReadCell] = useState<{ cell: Cell; selection: Selection | null } | null>(null);
  const coarse = useCoarsePointer();

  const brushTarget = paintableSelection(recipe, selection);
  const brushColour = brushInk(inks, recipe, brushTarget);
  const shownSelection = highlight ?? selection;
  // A measured error belongs to the selected request and is separate from paint strength.
  const showsSelectedCode = selection?.kind === "term" && selection.term === "respond" && sameTerm(shownSelection, selection);
  const codeMatch = showsSelectedCode ? match : undefined;

  // The area follows the pointer at once: the draft stroke is shown applied to the
  // selected area before it is committed as one numerical edit. A stroke of Noise or of
  // the held token is shown on its own, since it edits no area while it is drawn.
  const completed = draft ? completedStroke(draft) : undefined;
  const shownRecipe = draft && completed && draft.target.opened === opened
    ? applyScopedStroke(recipe, draft.target.selection, completed, draft.target.scope)
    : recipe;
  const loneStroke = draft && completed && !selectionTakesArea(draft.target.selection)
    ? loneStrokeFill(draft.target.selection, completed.cells, brushColour)
    : undefined;
  const overlay = canvasOverlay(shownRecipe, shownSelection, inks, { movement, stroke: loneStroke });
  const image = useMemo(() => {
    if (!pixels) return undefined;
    imageCanvasRef.current ??= document.createElement("canvas");
    return pixelsToCanvas(pixels, imageCanvasRef.current);
  }, [pixels]);

  // The brush shows the cells one dab would touch, each at what it would receive.
  const brushFootprint = hover && brushTarget ? footprintAt(hover, brushForSelection(brush, brushTarget), selectsFootprint(brushTarget)) : undefined;
  // The readout follows the draft stroke too, so it gives the number while the brush paints.
  const readoutCell = readCell && sameTerm(readCell.selection, selection) ? readCell.cell : undefined;
  const readoutError = readoutCell ? codeMatch?.[readoutCell.row * GRID + readoutCell.column] : undefined;
  const readout = cellReadout(shownRecipe, shownSelection, inks, readoutCell, readoutError);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const scale = window.devicePixelRatio || 1;
    if (canvas.width !== DISPLAY_SIZE * scale) {
      canvas.width = DISPLAY_SIZE * scale;
      canvas.height = DISPLAY_SIZE * scale;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    drawCanvas(context, {
      image,
      overlay,
      brushFootprint,
      brushColour,
      // Cell lines only while a stroke is shown, or before the first image.
      showGrid: !image || draft !== null || !!anchorPick,
    });
    const selectedRequest = selection?.kind === "term" ? recipe.requests.find((request) => request.id === selection.requestId) : undefined;
    const target = selectedRequest?.respondLike.target;
    if (target?.kind === "path") {
      context.font = "bold 14px sans-serif";
      context.textAlign = "center";
      target.anchors.forEach((cell, endpoint) => {
        const x = (cell % GRID + 0.5) * CELL_SIZE;
        const y = (Math.floor(cell / GRID) + 0.5) * CELL_SIZE;
        context.fillStyle = "white";
        context.strokeStyle = "black";
        context.lineWidth = 3;
        context.strokeText(endpoint === 0 ? "A" : "B", x, y + 5);
        context.fillText(endpoint === 0 ? "A" : "B", x, y + 5);
      });
    }
  });

  function gridPoint(event: { clientX: number; clientY: number }): GridPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * GRID,
      y: ((event.clientY - rect.top) / rect.height) * GRID,
    };
  }

  function updateDraft(next: Draft | null) {
    draftRef.current = next;
    setDraft(next);
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (anchorPick && event.button === 0) {
      const cell = cellAt(gridPoint(event));
      if (cell) onAnchorCell?.(cell.row * GRID + cell.column);
      event.preventDefault();
      return;
    }
    const mode = strokeModeOfButton(event.button, primaryErases);
    if (!brushTarget || !mode || draftRef.current) return;
    // Erasing has no meaning for Noise, which only re-seeds, or for the held token, which has no area yet.
    if (!selectionErases(brushTarget) && mode !== "paint") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = gridPoint(event);
    // A finger has no hover: the footprint shows from the touch, not from its first move.
    setHover(cellAt(point) ? point : null);
    readAt(point);
    const target = { selection: brushTarget, scope: strokeScope, opened };
    updateDraft({ mode, cells: startStroke(point, brushForSelection(brush, brushTarget)), last: point, target, pointerId: event.pointerId });
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const point = gridPoint(event);
    setHover(cellAt(point) ? point : null);
    readAt(point);
    const current = draftRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const settings = brushForSelection(brush, current.target.selection);
    updateDraft({ ...current, cells: paintSegment(current.cells, current.last, point, settings), last: point });
  }

  /** Keeps the cell under the pointer for the readout slot, when it is another cell or another selection. */
  function readAt(point: GridPoint) {
    const cell = cellAt(point);
    if (!cell) return;
    const same = readCell && readCell.cell.row === cell.row && readCell.cell.column === cell.column && sameTerm(readCell.selection, selection);
    if (!same) setReadCell({ cell, selection });
  }

  /** A mouse or a pen leaving the canvas empties the slot; a finger's last cell stays. */
  function onPointerLeave(event: PointerEvent<HTMLCanvasElement>) {
    setHover(null);
    if (event.pointerType !== "touch") setReadCell(null);
  }

  function onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const current = draftRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.target.opened === opened) onStroke(completedStroke(current), current.target);
    updateDraft(null);
  }

  // The scroll wheel resizes the brush instead of scrolling the page. React registers wheel
  // listeners as passive, so preventDefault needs a listener of our own.
  const onWheel = useRef<(event: WheelEvent) => void>(() => {});
  onWheel.current = (event) => {
    if (!brushTarget) return;
    if (wheelNeedsButton && !draft) return;
    event.preventDefault();
    const size = brushSizeAfterWheel(brush.size, event.deltaY);
    if (size !== brush.size) onBrushSize(size);
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const listener = (event: WheelEvent) => onWheel.current(event);
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, []);

  return (
    <div className="creation-canvas">
      {anchorPick && <div className="anchor-pick-hint">{fill(WORDS.anchorHint, { endpoint: anchorPick.endpoint === 0 ? "A" : "B" })} <button type="button" onClick={onCancelAnchor}>{WORDS.cancel}</button></div>}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={WORDS.name}
        // While a brush can paint, a finger on the canvas paints instead of scrolling the page.
        style={{ cursor: brushTarget ? "none" : "default", touchAction: brushTarget ? "none" : "auto" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(event) => event.preventDefault()}
      />
      {refusal && (
        <span className="canvas-label refusal" role="status">
          {refusal}
        </span>
      )}
      {readoutTarget && createPortal(<CellReadoutLine readout={readout} />, readoutTarget)}
      {/* The held token waits for its first stroke (state.ts, the held rule). */}
      {selection?.kind === "held" && !draft && (
        <span className="canvas-label held" style={{ "--paint": brushColour } as CSSProperties}>
          {WORDS.held}
        </span>
      )}
      {emptyHint && !pixels && recipe.requests.length === 0 && selection?.kind !== "held" && (
        <div className="canvas-empty">
          <p className="canvas-empty-title">{coarse ? WORDS.emptyCoarse : WORDS.emptyFine}</p>
        </div>
      )}
    </div>
  );
}

/** The brush's colour: the tone of the term or the ink of the held token it paints; the measure colour for Protect and Noise. */
function brushInk(inks: InkTable, recipe: Recipe, target: Selection | null): string {
  if (target?.kind === "term") return termInk(inks, target.requestId, target.term);
  // The held token takes the ink its request will get.
  if (target?.kind === "held") return defaultPair(inks, recipe.requests.length).code;
  return palette().measure;
}

/** A term or Protect: the draft stroke edits an area of the recipe while it is drawn. */
function selectionTakesArea(selection: Selection): boolean {
  return selection.kind === "term" || selection.kind === "protect";
}

/** The stroke of Noise (in the accent) or of the held token (in its ink), drawn on its own. */
function loneStrokeFill(selection: Selection, cells: Area, ink: string): AreaFill {
  return { area: cells, ink: selection.kind === "noise" ? palette().ask : ink };
}

/** The display size of one cell, for callers that place things by cell. */
export { CELL_SIZE };

function sameTerm(a: Selection | null, b: Selection | null): boolean {
  if (a?.kind !== "term" || b?.kind !== "term") return a?.kind === b?.kind;
  return a.requestId === b.requestId && a.term === b.term;
}

/** Protect and Noise select the whole footprint of a dab, whatever the brush's opacity. */
function selectsFootprint(selection: Selection): boolean {
  return selection.kind === "protect" || selection.kind === "noise";
}

function brushForSelection(brush: Brush, selection: Selection): Brush {
  return selectsFootprint(selection) ? { ...brush, opacity: 100 } : brush;
}

/** The footprint the canvas outlines under the pointer: the dab's cells with what each would receive, centred on the pointer's cell. */
function footprintAt(point: GridPoint, brush: Brush, selects: boolean): { cells: { cell: number; deposit: number }[]; centre: number } | undefined {
  const cell = cellAt(point);
  if (!cell) return undefined;
  return { cells: dabFootprint(point, brush, selects), centre: cell.row * GRID + cell.column };
}

function completedStroke(draft: Draft): Stroke {
  const cells = selectsFootprint(draft.target.selection) ? footprintDeposit(draft.cells) : quantizeDeposit(draft.cells);
  return { mode: draft.mode, cells };
}
