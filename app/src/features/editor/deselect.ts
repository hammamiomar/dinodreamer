// A tap outside controls, dialogs, the selected card and its paintable canvas clears
// the selection. Deselecting disarms the brush but keeps the held token.
//
// Drags never deselect, even if they return to their starting point. A tap must stay
// within TAP_TOLERANCE_PX and end on the element that received the press; this avoids
// selecting content that scrolls under a finger. Capture runs before a control selects
// something else. Touch scrolling cancels the pointer and produces no click.

import { useEffect, useRef } from "react";
import type { Selection } from "./state";

/** Where a tap landed, as far as the rule needs to know (read from the page by `tapTarget`). */
export interface TapTarget {
  /** Inside an interactive control (CONTROLS) or editable text. */
  control: boolean;
  /** Inside an open dialog or popover; a modal dialog's backdrop is the dialog element itself. */
  dialog: boolean;
  /** The card it is inside, named by the selection that card holds; null outside every card. */
  card: Card | null;
  /** On a canvas: the stage's or the dock's. */
  canvas: boolean;
}

/**
 * A card, by the selection it holds: a request's card (its terms), the image group (Protect
 * and Noise), the held token's card, or the dock's brush strip, which shows whatever is selected.
 */
export type Card =
  | { kind: "request"; requestId: number }
  | { kind: "image" }
  | { kind: "held" }
  | { kind: "brush" };

/**
 * The rule: whether a tap on `target` keeps `selection`. `paints` says whether the selection
 * paints on the canvas (paintableSelection): the Code term of a token without a painted area does not.
 */
export function tapKeepsSelection(target: TapTarget, selection: Selection, paints: boolean): boolean {
  if (target.control || target.dialog) return true;
  if (target.card !== null && cardHolds(target.card, selection)) return true;
  return target.canvas && paints;
}

/** Whether a card holds the selection: a term of its request, Protect or Noise, the held token; the brush strip holds any. */
export function cardHolds(card: Card, selection: Selection): boolean {
  switch (card.kind) {
    case "request":
      return selection.kind === "term" && selection.requestId === card.requestId;
    case "image":
      return selection.kind === "protect" || selection.kind === "noise";
    case "held":
      return selection.kind === "held";
    case "brush":
      return true;
  }
}

/** A pointer that went further than this from its press made a drag, so its click is not a tap. In CSS pixels. */
export const TAP_TOLERANCE_PX = 6;

export interface Point {
  x: number;
  y: number;
}

function withinTapTolerance(press: Point, point: Point): boolean {
  return Math.hypot(point.x - press.x, point.y - press.y) <= TAP_TOLERANCE_PX;
}

/** A press, or a click: where it is, and the element it is on. */
export interface Touch extends Point {
  target: unknown;
}

/** The press after the pointer moves to `point`: none once the pointer leaves the tolerance, even if it comes back. */
export function pressAfterMove(press: Touch | null, point: Point): Touch | null {
  return press !== null && withinTapTolerance(press, point) ? press : null;
}

/**
 * Whether a click is a tap: its press is still held (a keyboard's or a script's click has
 * none), it is within the tolerance, and it is on the element that was pressed. On another one, the
 * page moved under the finger: a card scrolled into view, say, and the click went to whatever
 * came under it.
 */
export function isTap(press: Touch | null, click: Touch): boolean {
  return press !== null && press.target === click.target && withinTapTolerance(press, click);
}

/** Widget roles whose taps operate the widget rather than deselecting the canvas. */
const WIDGET_ROLES = [
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "textbox",
  "searchbox",
  "combobox",
];

/** Interactive controls: the elements that a tap operates, and the widget roles. */
const CONTROLS = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  ...WIDGET_ROLES.map((role) => `[role="${role}"]`),
].join(", ");

const DIALOGS = 'dialog[open], [role="dialog"], [role="alertdialog"], [popover]';

/**
 * Reads where a tap landed: the target's nearest control, dialog, card and canvas. A card
 * names the selection it holds in `data-card` ("request" with `data-request`, "image",
 * "held" or "brush"); the canvas is CreationCanvas's `.creation-canvas`.
 */
export function tapTarget(element: Element): TapTarget {
  const card = element.closest("[data-card]");
  return {
    control: element.closest(CONTROLS) !== null || (element instanceof HTMLElement && element.isContentEditable),
    dialog: element.closest(DIALOGS) !== null,
    card: card === null ? null : cardOf(card),
    canvas: element.closest(".creation-canvas") !== null,
  };
}

function cardOf(element: Element): Card | null {
  const kind = element.getAttribute("data-card");
  if (kind === "request") return { kind, requestId: Number(element.getAttribute("data-request")) };
  if (kind === "image" || kind === "held" || kind === "brush") return { kind };
  return null;
}

/**
 * The rule's one listener, on the whole document, for as long as the editor session lives.
 * It reads the selection and `paints` from the latest render, and calls `onDeselect` after a
 * tap that the rule does not keep.
 */
export function useTapDeselect(selection: Selection | null, paints: boolean, onDeselect: () => void): void {
  const latest = useRef({ selection, paints, onDeselect });
  latest.current = { selection, paints, onDeselect };
  useEffect(() => {
    let press: Touch | null = null;
    const onPress = (event: PointerEvent) => {
      // A second finger starts a pinch, not a tap.
      press = event.isPrimary ? { x: event.clientX, y: event.clientY, target: event.target } : null;
    };
    const onMove = (event: PointerEvent) => {
      if (event.isPrimary) press = pressAfterMove(press, { x: event.clientX, y: event.clientY });
    };
    const onCancel = () => {
      press = null;
    };
    const onClick = (event: MouseEvent) => {
      // A keyboard's or a script's click has detail 0 and no press of its own.
      const start = event.detail > 0 ? press : null;
      press = null;
      const { selection, paints, onDeselect } = latest.current;
      if (selection === null || !(event.target instanceof Element)) return;
      if (!isTap(start, { x: event.clientX, y: event.clientY, target: event.target })) return;
      if (!tapKeepsSelection(tapTarget(event.target), selection, paints)) onDeselect();
    };
    const capture = { capture: true };
    document.addEventListener("pointerdown", onPress, capture);
    document.addEventListener("pointermove", onMove, capture);
    document.addEventListener("pointercancel", onCancel, capture);
    document.addEventListener("click", onClick, capture);
    return () => {
      document.removeEventListener("pointerdown", onPress, capture);
      document.removeEventListener("pointermove", onMove, capture);
      document.removeEventListener("pointercancel", onCancel, capture);
      document.removeEventListener("click", onClick, capture);
    };
  }, []);
}
