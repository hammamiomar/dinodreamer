// Dragging a ring along a code space's points: the request card lets the
// visitor move its requested code onto another recorded token. A press that starts on
// the ring lifts it; each view decides that in its own coordinates (projection.ts,
// reachesDragMark). While the press moves, the ring sits on the point nearest the
// pointer (snapPoint) and the view shows that point's picture. The release drops the
// ring there and gives the caller that point's key. A release outside the view,
// Escape, a second finger, a cancelled pointer or a new set of points puts the ring
// back: the editor has no undo, so every drag needs a way out. Both views of the map,
// the turning one and the flat one for reduced motion, use this.
//
// The ring can also move without a drag: the card's "Random token", or Space on a
// stepped point. Then the turning view lets it travel to its new place (ui/tween.ts),
// and the new point's picture shows beside it for a moment, so the visitor sees which
// token it is. After a drop the ring is already in its place, and its picture showed
// during the drag.

import { useEffect, useRef, useState } from "react";
import type { DragMark, SpacePoint } from "./code-space-3d";
import { sameValues } from "../tween";

/** How long the new point's picture shows after the ring moves without a drag. */
export const MOVED_PICTURE_MS = 2500;

/** A lifted ring: the point it sits on (null while the pointer is outside the view), and where the finger is that holds it (null for a mouse or a pen), in the view's coordinates. */
export interface Lift {
  point: number | null;
  finger: { x: number; y: number } | null;
}

export interface MarkDrag {
  /** The lifted ring, or null while no press holds it. */
  lifted: Lift | null;
  /** A mouse or a pen is over the ring, so the cursor says it moves. */
  over: boolean;
  setOver: (over: boolean) => void;
  /** The press that holds the ring moved: the ring now sits on `point`, or on none outside the view; `finger` is where a finger is. */
  moveTo: (point: number | null, finger: { x: number; y: number } | null) => void;
  /** The press let go: the ring drops on its point, or goes back from outside the view. */
  release: () => void;
  /** A second finger, a cancelled pointer or a lost focus: the ring goes back. */
  clearDrag: () => void;
  /** Whether `code` is where the last drop put the ring: the view draws the ring there at once, without travel. */
  droppedAt: (code: readonly number[]) => boolean;
  /** For a moment after the ring moves without a drag, the point it moved to, or null: its picture shows. */
  moved: number | null;
}

/**
 * `endPress` forgets the view's press that holds the ring, when Escape or new points put it
 * back while the press lasts, so its release does nothing.
 */
export function useMarkDrag(points: readonly SpacePoint[], dragMark: DragMark | undefined, endPress: () => void): MarkDrag {
  const [lifted, setLifted] = useState<Lift | null>(null);
  const [over, setOver] = useState(false);
  // The point the ring sits on, for the release, which can come before the next render.
  const snapped = useRef<number | null>(null);
  // The code of the point the last drop chose.
  const dropped = useRef<readonly number[] | null>(null);
  const endPressRef = useRef(endPress);
  endPressRef.current = endPress;

  const moveTo = (point: number | null, finger: { x: number; y: number } | null) => {
    snapped.current = point;
    setLifted((current) => (current && current.point === point && sameFinger(current.finger, finger) ? current : { point, finger }));
  };
  // The pointer is somewhere else when a drag ends; its next move says whether it is over the ring.
  const clearDrag = () => {
    snapped.current = null;
    setLifted(null);
    setOver(false);
  };
  const clearDragRef = useRef(clearDrag);
  clearDragRef.current = clearDrag;
  const release = () => {
    const point = snapped.current === null ? undefined : points[snapped.current];
    clearDrag();
    if (!point || !dragMark) return;
    dropped.current = point.code;
    dragMark.onDrop(point.key);
  };
  const droppedAt = (code: readonly number[]) => dropped.current !== null && sameValues(dropped.current, code);

  // The ring moved without a drag (Random token, Space): the point it moved to, by its code, for a moment.
  const [moved, setMoved] = useState<number | null>(null);
  const code = dragMark?.code;
  const codeText = code ? code.join(" ") : "";
  const codeRef = useRef(code);
  codeRef.current = code;
  const lastCode = useRef(codeText);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  useEffect(() => {
    if (lastCode.current === codeText) return;
    lastCode.current = codeText;
    setMoved(null);
    const currentCode = codeRef.current;
    if (!currentCode || (dropped.current !== null && sameValues(dropped.current, currentCode))) return;
    const index = pointsRef.current.findIndex((point) => sameValues(point.code, currentCode));
    if (index < 0) return;
    setMoved(index);
    const timer = setTimeout(() => setMoved(null), MOVED_PICTURE_MS);
    return () => clearTimeout(timer);
  }, [codeText]);

  // Escape puts a lifted ring back, before anything around the view sees the key (a panel would close).
  const lifting = lifted !== null;
  useEffect(() => {
    if (!lifting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      endPressRef.current();
      clearDragRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [lifting]);

  // A point's index means nothing in a new set of points.
  useEffect(() => {
    endPressRef.current();
    clearDragRef.current();
    setMoved(null);
  }, [points]);

  return { lifted, over, setOver, moveTo, release, clearDrag, droppedAt, moved };
}

function sameFinger(a: { x: number; y: number } | null, b: { x: number; y: number } | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}
