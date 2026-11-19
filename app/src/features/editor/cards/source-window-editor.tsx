// Selects which reference patch tokens enter the appearance template; DINO still
// reads the whole view. A drag commits once on release.
//
// The native dialog is nonmodal beside the canvas and modal when its fixed layout
// fills a phone screen. Escape closes only this dialog, then focus returns to its
// opening picture.

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { CELLS, GRID, type Reference } from "../../../recipe";
import { LibraryImage } from "../../../ui/library-image";
import { ResetMark } from "../../../ui/reset-mark";
import { defaultReference } from "../model";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";
import "./cards.css";

const WORDS = CREATE_TEXT.window;

const EDITOR_SIZE = 256;

export function SourceWindowEditor({
  reference,
  src,
  onCommit,
  onRemove,
  onClose,
}: {
  reference: Reference;
  src: string;
  onCommit(source: boolean[]): void;
  /** Removes the picture from the request; the one way a finger removes a card's picture. */
  onRemove(): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The layout decides: a window positioned fixed fills the screen, so it is modal.
    if (getComputedStyle(element).position === "fixed") element.showModal();
    else element.show();
    element.focus();
    return () => {
      if (element.open) element.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Escape") return;
    // Handled here: the page's Escape, which clears the selection, sees defaultPrevented.
    event.preventDefault();
    onClose();
  }

  const [draft, setDraft] = useState<boolean[] | null>(null);
  const activePointer = useRef<number | null>(null);
  /** The value a drag writes: the opposite of the first cell it touched. */
  const [paintValue, setPaintValue] = useState(true);
  const source = draft ?? reference.source;
  const selected = source.filter(Boolean).length;

  function cellOf(event: PointerEvent<HTMLDivElement>): number | undefined {
    const rect = event.currentTarget.getBoundingClientRect();
    const column = Math.floor(((event.clientX - rect.left) / rect.width) * GRID);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * GRID);
    if (row < 0 || row >= GRID || column < 0 || column >= GRID) return undefined;
    return row * GRID + column;
  }

  function write(cells: boolean[], cell: number, value: boolean): boolean[] {
    if (cells[cell] === value) return cells;
    const next = cells.slice();
    next[cell] = value;
    return next;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || activePointer.current !== null) return;
    const cell = cellOf(event);
    if (cell === undefined) return;
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const value = !source[cell];
    setPaintValue(value);
    setDraft(write(source, cell, value));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draft || activePointer.current !== event.pointerId) return;
    const cell = cellOf(event);
    if (cell !== undefined) setDraft(write(draft, cell, paintValue));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    // An empty window is never valid; model.setSourceWindow ignores it.
    if (draft) onCommit(draft);
    setDraft(null);
  }

  return (
    <dialog ref={dialog} className="window-editor" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <header>
        <b id={titleId}>{WORDS.title}</b>
        <span className="muted mono">{fill(WORDS.count, { id: reference.token.imageId, selected, cells: CELLS })}</span>
        <button type="button" className="card-remove" aria-label={WORDS.close} onClick={onClose}>
          ×
        </button>
      </header>
      <div
        className="window-grid"
        role="img"
        aria-label={fill(WORDS.count, { id: reference.token.imageId, selected, cells: CELLS })}
        style={{ width: EDITOR_SIZE, height: EDITOR_SIZE }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <LibraryImage src={src} alt="" draggable={false} />
        <div className="window-cells">
          {source.map((isSelected, cell) => (
            <i key={cell} className={isSelected ? "selected" : undefined} />
          ))}
        </div>
      </div>
      <p className="row-note">{WORDS.note}</p>
      <footer>
        <button type="button" className="chip" onClick={() => onCommit(new Array<boolean>(CELLS).fill(true))}>
          {WORDS.wholeView}
        </button>
        <button type="button" className="chip reset-control" aria-label={WORDS.reset} title={WORDS.reset} onClick={() => onCommit(defaultReference(reference.token).source)}>
          <ResetMark />
        </button>
        <button type="button" className="chip window-remove" onClick={onRemove}>
          {WORDS.remove}
        </button>
      </footer>
    </dialog>
  );
}
