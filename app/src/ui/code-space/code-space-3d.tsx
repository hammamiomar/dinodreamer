import { TargetOverlay, type TargetHandles } from "./target-handles";
// A block's code space: every point is one 3-vector code, placed by its three
// values. The view turns in 3-D on a 2-D canvas, without a 3-D library, and it
// behaves as maps on the web do. With a mouse, a drag turns it
// at once; the wheel scrolls the page, and zooms only with Ctrl or ⌘ held (a
// trackpad pinch arrives that way) or once a click has given the view focus; a
// plain wheel over it shows "Use Ctrl + scroll to zoom". With a finger, one finger
// scrolls the page and two fingers turn and pinch it; the first one-finger scroll
// shows "Use two fingers to move the map", once per browser. A click or tap on a
// point chooses it. From the keyboard, the arrow keys step through the points
// (point-steps.ts), Enter chooses one, Shift + an arrow key turns the view, plus
// and minus zoom, 0 resets and Escape lets the view go. Hover shows a point's
// picture. "Reset view" returns to the starting orbit. Geometry lives in
// projection.ts.
//
// The caller owns everything drawn (points, marks, trail, arrows, selection); the
// view owns only its camera and the pointer. It fits the camera to the points (and
// to `fitTo`, codes the caller knows will be marked, and to a chain of arrows) when
// they change, never to the marks themselves, so a moving mark does not move the
// view. A new set of points starts from the starting view; a new fit keeps the
// visitor's turn. A mark outside the view shows as an arrow on the edge, pointing
// toward it. A caller that names a `scene` (the block viewer: a block and a role)
// fits the view once to what it lists and keeps the camera while the selection
// changes: the cloud, the axes and the turn stay, and the selected point's ring and
// dot, its arrows and the stepped ring travel to their new places in 240 ms
// (ui/tween.ts). The pointer is a hand that grabs, and a pointing
// finger over a point a click would choose.
//
// A caller may give one ring the visitor can drag along the points (`dragMark`, the
// request card's requested code; mark-drag.ts). A press on the ring, or a
// finger within 22 px of it, lifts it instead of turning the view or scrolling the
// page; while it moves, it sits on the point nearest the pointer, with that point's
// picture; the release drops it there. From the keyboard, Space moves it to the
// stepped point. The pointer is a move cursor over the ring. A move without a drag
// (Space, the card's "Random token") lets the ring travel to its new place, and the
// new point's picture shows for a moment.
//
// With "reduce motion" set, the same points show on the flat axis-pair view
// (code-plane.tsx), with the same keyboard steps and the same drag.

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { CodePlane } from "./code-plane";
import { ResetMark } from "../reset-mark";
import { useMovingValues, usePrefersReducedMotion } from "../tween";
import { ringIsOn, usePointSteps } from "./point-steps";
import { useMarkDrag } from "./mark-drag";
import { liftedPoint, PointTooltip } from "./point-tooltip";
import {
  ARROW_HEAD_PX,
  arrowNames,
  axisDirections,
  axisLines,
  chainCorners,
  chainOrbit,
  DEFAULT_ORBIT,
  depthOrder,
  edgeArrow,
  fitCodes,
  isClick,
  orbitBy,
  pickPoint,
  placeLabel,
  projector,
  reachesDragMark,
  RING_MARK_PX,
  SELECTED_RING_PX,
  snapPoint,
  zoomBy,
  viewScale,
} from "./projection";
import type { Fit, LabelBox, Orbit, ScreenPoint, Vec3, View } from "./projection";
import { cssColour } from "../css-colour";
import "./code-space.css";
import { canvasPixelRatio, pagePointer } from "../page-scale";

export interface SpacePoint {
  /** Stable identity, e.g. "<image id>:<slot>"; selection uses it. */
  key: string;
  code: Vec3;
  /** "Image 4322020600810201 · patch (14, 13)": tooltip, list entry and accessible name. */
  label: string;
  /** A small picture for the hover tooltip. */
  imageUrl?: string;
}

/** A code drawn over the points, never fitted or picked: a requested code, a measured code, their mean. */
export interface SpaceMark {
  code: Vec3;
  shape: "ring" | "dot" | "cross";
  /** CSS colour. */
  colour: string;
  /** Drawn where the selected point is drawn, so it travels with it to a new selection (the marked token's dot). */
  followsSelection?: boolean;
}

/**
 * A ring the visitor can drag along the points, e.g. the request card's requested code. The view
 * draws it as a ring mark, so it is not in `marks`. While a press holds it, it sits on the point
 * nearest the pointer; the release calls `onDrop` with that point's key (mark-drag.ts).
 */
export interface DragMark {
  code: Vec3;
  /** CSS colour. */
  colour: string;
  onDrop: (key: string) => void;
}

/** A path through codes in order, e.g. the recent means of measured codes; later steps are drawn stronger. */
export interface SpaceTrail {
  codes: readonly Vec3[];
  colour: string;
}

/**
 * A code as vectors drawn tip to tail from the origin, e.g. what each part of the
 * model's last layer added to one token's code. The arrows are --measure, thin, each
 * named at its middle when it is long enough on screen; the lit one is the ink and
 * always named. The view fits the whole chain.
 */
export interface SpaceArrows {
  vectors: readonly Vec3[];
  /** One per vector: "the surrounding area +101 %". */
  labels: readonly string[];
  /** The index of the lit vector, or null. */
  lit: number | null;
}

export interface CodeSpaceProps {
  points: readonly SpacePoint[];
  /** More codes the view must hold, e.g. the codes the caller will mark; not drawn. A new array refits the view, so keep it stable. */
  fitTo?: readonly Vec3[];
  marks?: readonly SpaceMark[];
  trail?: SpaceTrail;
  /** Keep stable while unchanged: a new chain refits the view. */
  arrows?: SpaceArrows;
  /** CSS colour of the points; --measure when absent. */
  pointColour?: string;
  selectedKey?: string | null;
  /** Without it, points cannot be chosen, and the arrow keys turn the view. */
  onSelect?: (key: string) => void;
  /** The ring the visitor can drag onto another point; with it, Space moves the ring to the stepped point. */
  dragMark?: DragMark;
  targetHandles?: TargetHandles;
  /** Largest side in CSS pixels; the view shrinks to fit its container. */
  size?: number;
  /** The small key naming the three axes in the corner; on unless a caller says the axes need no names. */
  orientationKey?: boolean;
  /** What the drawing shows, for assistive technology. */
  label: string;
  /**
   * What the view shows, e.g. "<block>:<role>". While it stays the same, the view fits `fitTo`
   * alone, so the caller lists every code it must hold (the points, the codes it will mark, the
   * corners of every chain it may draw), and the camera keeps its fit and turn while the
   * selection and its arrows change. A new scene starts from the starting view. Without one,
   * new points or a new chain refit the view and start it again.
   */
  scene?: string;
}

/** The view's colours, from the styles.css tokens. */
interface SpaceColours {
  ground: string;
  /** Points and the hover ring: measured codes (--measure). */
  point: string;
  /** The chosen point (--ask). */
  selected: string;
  /** Code values 1, 2 and 3. */
  axes: readonly [string, string, string];
  /** The arrows' names (--ink-2) and the halo around them (--black). */
  label: string;
  /** The origin a chain of arrows starts from (--ink-3). */
  origin: string;
  /** The house typeface, for the arrows' names. */
  font: string;
}

function readSpaceColours(): SpaceColours {
  return {
    ground: cssColour("--black", "#000"),
    point: cssColour("--measure", "#efece8"),
    selected: cssColour("--ink", "#efece8"),
    axes: [cssColour("--axis-1", "#fb7185"), cssColour("--axis-2", "#6ee7b7"), cssColour("--axis-3", "#7dd3fc")],
    label: cssColour("--ink-2", "#9c9994"),
    origin: cssColour("--ink-3", "#5e5b57"),
    font: getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace",
  };
}
const POINT_RADIUS_PX = 2.2;
/** Arrows for marks outside the view sit this far inside its edge. */
const EDGE_INSET_PX = 8;
/** Delay before the hover tooltip opens, so it does not flicker while the pointer crosses the cloud. */
const TOOLTIP_DELAY_MS = 150;
const WHEEL_ZOOM_PER_PX = 0.0015;
const KEY_TURN_PX = 15;
const KEY_ZOOM = 1.2;

export function CodeSpace3D(props: CodeSpaceProps) {
  const reduceMotion = usePrefersReducedMotion();
  const { points, fitTo, scene } = props;
  const chain = props.arrows?.vectors;
  // With a scene, fitTo is the whole fit: a new selection or a new chain moves inside a still view.
  const fitPoints = scene === undefined ? points : null;
  const fitChain = scene === undefined ? chain : undefined;
  const fit = useMemo(
    () => fitCodes([...(fitPoints ?? []).map((point) => point.code), ...(fitTo ?? []), ...(fitChain ? chainCorners(fitChain) : [])]),
    [fitPoints, fitTo, fitChain],
  );
  return <div className="code-space">{reduceMotion ? <CodePlane {...props} fit={fit} /> : <OrbitView {...props} fit={fit} />}</div>;
}

/**
 * One mouse or pen press, or one finger: a drag turns the view (a finger's scrolls the page), and a
 * still press is a click. A press that starts on the draggable ring (`lifts`) moves the ring instead.
 */
type Press = { pointerId: number; start: { x: number; y: number }; last: { x: number; y: number }; dragged: boolean; lifts: boolean };
/** Two fingers on the view: their midpoint and spread when the last step was taken. */
type TwoFingers = { middle: { x: number; y: number }; spread: number };
/** The short line the view shows when a gesture would have moved it on a map. */
type MapHint = "wheel" | "touch";

const HINT_MS = 1500;
/** This browser has seen the two-finger hint. */
const TWO_FINGER_HINT_KEY = "dinodreamer.mapTwoFingerHint";

function hintText(hint: MapHint): string {
  if (hint === "touch") return "Use two fingers to move the map";
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? "Use ⌘ + scroll to zoom" : "Use Ctrl + scroll to zoom";
}

function twoFingerHintSeen(): boolean {
  try {
    return localStorage.getItem(TWO_FINGER_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberTwoFingerHint(): void {
  try {
    localStorage.setItem(TWO_FINGER_HINT_KEY, "1");
  } catch {
    // Blocked storage: the hint may show again on the next visit.
  }
}

function OrbitView({
  points,
  marks = [],
  trail,
  arrows,
  pointColour,
  selectedKey = null,
  onSelect,
  dragMark,
  targetHandles,
  size = 320,
  orientationKey = true,
  label,
  scene,
  fit,
}: CodeSpaceProps & { fit: Fit }) {
  // Read once per mount: the tokens do not change while the page is open.
  const colours = useMemo(readSpaceColours, []);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useWidth(frame, size);
  // The starting view: the chain of arrows broadside when there is one, else the three-quarter view.
  const chain = arrows?.vectors;
  const startOrbit = useMemo(() => (chain ? chainOrbit(chain) : DEFAULT_ORBIT), [chain]);
  const [orbit, setOrbit] = useState<Orbit>(startOrbit);
  const [hovered, setHovered] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ index: number; x: number; y: number } | null>(null);
  const press = useRef<Press | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Focused, by a click or the keyboard: the wheel then zooms without a modifier.
  const [focused, setFocused] = useState(false);
  const fingers = useRef<TwoFingers | null>(null);
  // Fingers on the view (pointer events): a tap is one finger that lifts without moving.
  const touches = useRef(0);
  const [hint, setHint] = useState<MapHint | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const steps = usePointSteps(points, onSelect, dragMark?.onDrop);
  const drag = useMarkDrag(points, dragMark, () => {
    if (press.current?.lifts) press.current = null;
  });
  // One finger on the draggable ring: the touch listeners keep the page from scrolling under it.
  const fingerOnMark = useRef(false);

  // Without a scene, new points or a new chain start from the starting view, which faces the chain. With one, a new
  // scene does, and so does the scene's first chain while the visitor has not moved the camera; otherwise the camera
  // stays, and a new selection moves inside a still view.
  const camera = useRef({ scene, faced: chain !== undefined, moved: false });
  useEffect(() => {
    if (scene === undefined) {
      setOrbit(startOrbit);
      return;
    }
    const state = camera.current;
    if (state.scene !== scene) {
      camera.current = { scene, faced: chain !== undefined, moved: false };
      setOrbit(startOrbit);
    } else if (!state.faced && chain !== undefined) {
      state.faced = true;
      if (!state.moved) setOrbit(startOrbit);
    }
  }, [points, startOrbit, scene, chain]);
  // The visitor turns or zooms the view.
  const moveCamera = (move: (current: Orbit) => Orbit) => {
    camera.current.moved = true;
    setOrbit(move);
  };
  useEffect(
    () => () => {
      if (hintTimer.current !== null) clearTimeout(hintTimer.current);
    },
    [],
  );
  useEffect(() => {
    setHovered(null);
    setTooltip(null);
  }, [points, fit]);

  const view: View = useMemo(() => ({ fit, orbit, width, height: width }), [fit, orbit, width]);
  const project = useMemo(() => projector(view), [view]);
  const projected = useMemo(() => points.map((point) => project(point.code)), [points, project]);
  const selected = selectedKey === null ? -1 : points.findIndex((point) => point.key === selectedKey);
  // The selected point, its arrows and the stepped point as drawn: on their way to a new place, in code space, so a
  // turn of the view during a move stays true. A new scene puts them in place at once.
  const movingSelection = useMovingValues(selected >= 0 ? points[selected]!.code : NO_VALUES, { space: scene });
  const movingVectors = useMovingValues(chain ? chain.flat() : NO_VALUES, { space: scene });
  const movingStep = useMovingValues(steps.stepped !== null && points[steps.stepped] ? points[steps.stepped]!.code : NO_VALUES, { space: scene });
  // The draggable ring as drawn: it travels to a new place, but not to the place a drop just put it.
  const markCode = dragMark?.code;
  const movingMark = useMovingValues(markCode ?? NO_VALUES, { space: scene, instant: markCode !== undefined && drag.droppedAt(markCode) });
  const markDrawn = movingMark.length === 3 ? (movingMark as Vec3) : null;
  // Where the ring is, while there are points to drop it on; the touch listeners read it here.
  const markAt = markDrawn && points.length > 0 ? project(markDrawn) : null;
  const markAtRef = useRef(markAt);
  markAtRef.current = markAt;
  const markColour = dragMark?.colour;

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || width === 0) return;
    const ratio = canvasPixelRatio(context.canvas);
    context.canvas.width = Math.round(width * ratio);
    context.canvas.height = Math.round(width * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    // The stepped point is ringed as the hovered one is.
    const ringed = movingStep.length === 3 ? project(movingStep as Vec3) : hovered !== null ? (projected[hovered] ?? null) : null;
    const drawnArrows = arrows && movingVectors.length === arrows.vectors.length * 3 ? { ...arrows, vectors: vectorsOf(movingVectors) } : arrows;
    const selection = movingSelection.length === 3 ? (movingSelection as Vec3) : null;
    const liftedPoint = drag.lifted ? drag.lifted.point : null;
    const onPoint = liftedPoint === null ? null : (projected[liftedPoint] ?? null);
    const drawnMark = markDrawn && markColour ? { code: markDrawn, colour: markColour, onPoint, held: drag.over || onPoint !== null } : null;
    drawSpace(
      context,
      view,
      { projected, marks, trail, arrows: drawnArrows, pointColour: pointColour ?? colours.point, selection, ringed, dragMark: drawnMark, orientationKey },
      colours,
    );
  }, [
    view,
    project,
    projected,
    marks,
    trail,
    arrows,
    pointColour,
    movingSelection,
    movingVectors,
    movingStep,
    hovered,
    markDrawn,
    markColour,
    drag.lifted,
    drag.over,
    orientationKey,
    width,
    colours,
  ]);

  const showHint = (shown: MapHint) => {
    setHint(shown);
    if (hintTimer.current !== null) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  };
  const showHintRef = useRef(showHint);
  showHintRef.current = showHint;

  // A plain wheel scrolls the page and says how to zoom; Ctrl, ⌘ (a trackpad pinch) or a focused view zooms.
  // Two fingers turn and pinch the view; one finger scrolls the page. These listeners are native, so they can
  // stop the page's own scroll and zoom.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || document.activeElement === element) {
        event.preventDefault();
        camera.current.moved = true;
        setOrbit((current) => zoomBy(current, Math.exp(-event.deltaY * WHEEL_ZOOM_PER_PX)));
      } else {
        showHintRef.current("wheel");
      }
    };
    const local = (touch: Touch) => pagePointer(touch, element);
    const twoOf = (list: TouchList): TwoFingers => {
      const a = local(list[0]!);
      const b = local(list[1]!);
      return { middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, spread: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        event.preventDefault();
        fingers.current = twoOf(event.touches);
        fingerOnMark.current = false;
        return;
      }
      // One finger on the draggable ring moves the ring, so the page must not scroll under it.
      const mark = markAtRef.current;
      fingerOnMark.current = mark !== null && reachesDragMark(mark, local(event.touches[0]!), true);
      if (fingerOnMark.current) event.preventDefault();
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        if (event.cancelable) event.preventDefault();
        const now = twoOf(event.touches);
        const before = fingers.current ?? now;
        camera.current.moved = true;
        setOrbit((current) => zoomBy(orbitBy(current, now.middle.x - before.middle.x, now.middle.y - before.middle.y), now.spread / before.spread));
        fingers.current = now;
      } else if (fingerOnMark.current) {
        if (event.cancelable) event.preventDefault();
      } else if (!twoFingerHintSeen()) {
        rememberTwoFingerHint();
        showHintRef.current("touch");
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) fingers.current = null;
      if (event.touches.length === 0) fingerOnMark.current = false;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("touchstart", onTouchStart, { passive: false });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEnd);
    element.addEventListener("touchcancel", onTouchEnd);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const clearTooltipTimer = () => {
    if (tooltipTimer.current !== null) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = null;
  };
  useEffect(() => () => clearTooltipTimer(), []);

  const pointerAt = (event: PointerEvent<HTMLCanvasElement>) => pagePointer(event, event.currentTarget);

  const hover = (at: { x: number; y: number } | null) => {
    const index = at ? pickPoint(projected, at, selected) : null;
    if (index === hovered) return;
    setHovered(index);
    setTooltip(null);
    clearTooltipTimer();
    if (index !== null && at) tooltipTimer.current = setTimeout(() => setTooltip({ index, ...at }), TOOLTIP_DELAY_MS);
  };

  /** Whether a press at `at` lifts the draggable ring. */
  const liftsMark = (at: { x: number; y: number }, finger: boolean) => markAt !== null && reachesDragMark(markAt, at, finger);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const at = pointerAt(event);
    if (event.pointerType === "touch") {
      // A finger is a tap, a scroll or a drag of the ring; two fingers are the touch listeners' (above), and put a lifted ring back.
      touches.current += 1;
      press.current = touches.current === 1 ? { pointerId: event.pointerId, start: at, last: at, dragged: false, lifts: liftsMark(at, true) } : null;
      if (touches.current > 1) drag.clearDrag();
      return;
    }
    // A mouse press does not take focus: a drag must not make the wheel zoom. A click takes it (onPointerUp).
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { pointerId: event.pointerId, start: at, last: at, dragged: false, lifts: liftsMark(at, false) };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const at = pointerAt(event);
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) {
      if (event.pointerType !== "touch") {
        hover(at);
        drag.setOver(liftsMark(at, false));
      }
      return;
    }
    if (!current.dragged && isClick(current.start, at)) return;
    if (!current.dragged) hover(null);
    press.current = { ...current, last: at, dragged: true };
    if (current.lifts) {
      drag.moveTo(snapPoint(projected, at, width, width), event.pointerType === "touch" ? at : null);
      return;
    }
    // A mouse or pen drag turns the view at once; a finger that moves is the page's scroll.
    if (event.pointerType !== "touch") moveCamera((previous) => orbitBy(previous, at.x - current.last.x, at.y - current.last.y));
  };

  const endTouch = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch") touches.current = Math.max(0, touches.current - 1);
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    endTouch(event);
    const current = press.current;
    press.current = null;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.lifts && current.dragged) {
      drag.release();
      return;
    }
    if (current.dragged) return;
    // A click or a tap gives the view focus, and chooses the point under it.
    if (!focused) event.currentTarget.focus({ preventScroll: true });
    const index = pickPoint(projected, pointerAt(event), selected);
    if (index !== null && onSelect) onSelect(points[index]!.key);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    // The arrow keys step through the points (and Enter chooses one); with Shift, or with nothing to choose, they turn the view.
    if (steps.onKey(event)) {
      event.preventDefault();
      return;
    }
    const turns: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_TURN_PX, 0],
      ArrowRight: [KEY_TURN_PX, 0],
      ArrowUp: [0, -KEY_TURN_PX],
      ArrowDown: [0, KEY_TURN_PX],
    };
    const turn = turns[event.key];
    if (turn) moveCamera((current) => orbitBy(current, turn[0], turn[1]));
    else if (event.key === "+" || event.key === "=") moveCamera((current) => zoomBy(current, KEY_ZOOM));
    else if (event.key === "-") moveCamera((current) => zoomBy(current, 1 / KEY_ZOOM));
    else if (event.key === "0") moveCamera(() => startOrbit);
    // Escape lets the view go; prevented, so a panel around it does not close as well.
    else if (event.key === "Escape") event.currentTarget.blur();
    else return;
    event.preventDefault();
  };

  // The picture of the point a lifted ring sits on; else the stepped point's, or the hovered one's, beside it; else, for a
  // moment, the point the ring moved to without a drag.
  const steppedOn = movingStep.length === 3 ? project(movingStep as Vec3) : null;
  const steppedAt = steps.stepped !== null && steppedOn ? { index: steps.stepped, x: steppedOn.x, y: steppedOn.y } : null;
  const tipped = steppedAt ?? tooltip;
  let shown = liftedPoint(drag.lifted, points, projected);
  if (!shown && tipped && points[tipped.index]) shown = { point: points[tipped.index]!, at: tipped, finger: false };
  const movedTo = drag.moved === null ? undefined : points[drag.moved];
  if (!shown && movedTo && projected[drag.moved!]) shown = { point: movedTo, at: projected[drag.moved!]!, finger: false };
  return (
    <div className="code-space-frame" ref={frame} style={{ maxWidth: size }}>
      <canvas
        ref={canvas}
        className="code-space-canvas"
        style={{ width, height: width }}
        tabIndex={0}
        role="img"
        aria-label={orbitLabel(label, onSelect !== undefined, dragMark !== undefined)}
        data-engaged={focused || undefined}
        // Over a point a click would choose, the pointer is a pointing finger; over the draggable ring, or holding it, a move cursor (code-space.css).
        data-pointing={(onSelect !== undefined && hovered !== null) || undefined}
        data-moving-mark={drag.over || drag.lifted !== null || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          press.current = null;
          drag.clearDrag();
          steps.clear();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(event) => {
          endTouch(event);
          press.current = null;
          drag.clearDrag();
        }}
        onPointerLeave={() => {
          if (press.current !== null) return;
          hover(null);
          drag.setOver(false);
        }}
        onKeyDown={onKeyDown}
      />
      {targetHandles && width > 0 && <TargetOverlay handles={targetHandles} points={points} project={project} scale={viewScale(view)} size={width} />}
      <button type="button" className="code-space-reset reset-control" aria-label="Reset view" title="Reset view" onClick={() => moveCamera(() => startOrbit)}>
        <ResetMark />
      </button>
      {shown && width > 0 && <PointTooltip point={shown.point} at={{ x: shown.at.x / width, y: shown.at.y / width }} finger={shown.finger} />}
      {hint && (
        <p className="code-space-hint" aria-hidden="true">
          {hintText(hint)}
        </p>
      )}
      <p className="code-space-announce" aria-live="polite">
        {steps.announcement || (movedTo ? ringIsOn(movedTo) : "")}
      </p>
    </div>
  );
}

/** What the arrow keys do, in the view's accessible name: with points to choose, a ring to move, both or neither. */
const KEYS_LINE = {
  turn: "Arrow keys turn the view",
  choose: "Arrow keys step through the tokens and Enter chooses one; Shift and an arrow key turn the view",
  place: "Arrow keys step through the tokens and Space moves the ring to one; Shift and an arrow key turn the view",
  both: "Arrow keys step through the tokens, Enter chooses one and Space moves the ring to it; Shift and an arrow key turn the view",
} as const;

/** The view's accessible name: what it shows, then what a drag and the keys do. */
export function orbitLabel(label: string, choose: boolean, place: boolean): string {
  const drags = place
    ? "Drag the ring onto another point to move it there, or drag elsewhere to turn the view; Ctrl and the wheel, or a pinch, zoom."
    : "Drag to turn it; Ctrl and the wheel, or a pinch, zoom.";
  let keys: string = KEYS_LINE.turn;
  if (choose && place) keys = KEYS_LINE.both;
  else if (choose) keys = KEYS_LINE.choose;
  else if (place) keys = KEYS_LINE.place;
  return `${label}. ${drags} ${keys}; plus and minus zoom, 0 resets.`;
}


interface Scene {
  projected: readonly ScreenPoint[];
  marks: readonly SpaceMark[];
  trail: SpaceTrail | undefined;
  arrows: SpaceArrows | undefined;
  pointColour: string;
  /** The selected point's code where it is drawn now, or null. */
  selection: Vec3 | null;
  /** Where the hovered or the stepped point's ring is drawn, or null. */
  ringed: ScreenPoint | null;
  /** The draggable ring: its code, the point a press has lifted it onto (or null), and whether the pointer holds it or is over it. */
  dragMark: { code: Vec3; colour: string; onPoint: ScreenPoint | null; held: boolean } | null;
  /** The small key in the corner that names the three axes. */
  orientationKey: boolean;
}

/** Axes behind, then points far to near, the trail, the arrows, the marks, the draggable ring, and the selection and hover rings on top. */
function drawSpace(context: CanvasRenderingContext2D, view: View, scene: Scene, colours: SpaceColours) {
  const { width, height } = view;
  context.fillStyle = colours.ground;
  context.fillRect(0, 0, width, height);

  context.lineWidth = 1;
  context.globalAlpha = 0.4;
  for (const line of axisLines(view)) {
    context.strokeStyle = colours.axes[line.axis]!;
    context.beginPath();
    context.moveTo(line.from.x, line.from.y);
    context.lineTo(line.to.x, line.to.y);
    context.stroke();
  }

  // Nearer points are drawn more opaque, which reads as depth.
  context.fillStyle = scene.pointColour;
  for (const index of depthOrder(scene.projected)) {
    const point = scene.projected[index]!;
    const nearness = Math.max(0, Math.min(1, (point.depth / view.fit.radius + 1) / 2));
    context.globalAlpha = 0.3 + 0.6 * nearness;
    context.beginPath();
    context.arc(point.x, point.y, POINT_RADIUS_PX, 0, 2 * Math.PI);
    context.fill();
  }

  const project = projector(view);
  if (scene.trail && scene.trail.codes.length > 1) {
    const steps = scene.trail.codes.map(project);
    context.strokeStyle = scene.trail.colour;
    context.lineWidth = 1.5;
    for (let step = 1; step < steps.length; step += 1) {
      context.globalAlpha = 0.15 + 0.75 * (step / (steps.length - 1));
      context.beginPath();
      context.moveTo(steps[step - 1]!.x, steps[step - 1]!.y);
      context.lineTo(steps[step]!.x, steps[step]!.y);
      context.stroke();
    }
  }

  if (scene.arrows) drawArrows(context, project, scene.arrows, colours);

  context.globalAlpha = 1;
  for (const mark of scene.marks) {
    const at = project(mark.followsSelection && scene.selection ? scene.selection : mark.code);
    const arrow = edgeArrow(at, width, height, EDGE_INSET_PX);
    if (arrow) drawEdgeArrow(context, arrow, mark.colour);
    else drawMark(context, at, mark.shape, mark.colour);
  }
  if (scene.dragMark) drawDragMark(context, project, scene.dragMark, width, height);
  if (scene.selection) drawRing(context, project(scene.selection), SELECTED_RING_PX, colours.selected, 2);
  if (scene.ringed) drawRing(context, scene.ringed, 5, colours.point, 1.5);

  if (scene.orientationKey) drawOrientationKey(context, view.orbit, { x: 22, y: height - 22 }, colours.axes);
}

/** The chain from the origin, each arrow with its head, then the names on top, each with a halo so it reads over the points. */
function drawArrows(context: CanvasRenderingContext2D, project: (code: Vec3) => ScreenPoint, arrows: SpaceArrows, colours: SpaceColours) {
  const corners = chainCorners(arrows.vectors).map(project);
  const origin = corners[0]!;
  drawRing(context, origin, 3, colours.origin, 1);
  for (let index = 0; index < arrows.vectors.length; index += 1) {
    const from = corners[index]!;
    const to = corners[index + 1]!;
    const lit = arrows.lit === index;
    const colour = lit ? colours.selected : colours.point;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    context.globalAlpha = lit || arrows.lit === null ? 0.95 : 0.45;
    context.strokeStyle = colour;
    context.fillStyle = colour;
    context.lineWidth = lit ? 2.5 : 1.5;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    if (length > ARROW_HEAD_PX * 1.5) {
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      context.save();
      context.translate(to.x, to.y);
      context.rotate(angle);
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(-ARROW_HEAD_PX, -ARROW_HEAD_PX / 2);
      context.lineTo(-ARROW_HEAD_PX, ARROW_HEAD_PX / 2);
      context.closePath();
      context.fill();
      context.restore();
    }
  }
  context.globalAlpha = 1;
  context.font = `10px ${colours.font}`;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  const placed: LabelBox[] = [];
  for (const name of arrowNames(corners, arrows.labels, arrows.lit)) {
    const box = placeLabel(name, context.measureText(name.text).width, placed, context.canvas.clientWidth || context.canvas.width);
    if (!box) continue;
    placed.push(box);
    context.textAlign = box.align;
    context.lineWidth = 3;
    context.strokeStyle = colours.ground;
    context.strokeText(name.text, box.anchor.x, box.anchor.y);
    context.fillStyle = name.lit ? colours.selected : colours.label;
    context.fillText(name.text, box.anchor.x, box.anchor.y);
  }
}

/**
 * The draggable ring, as a ring mark: thicker while the pointer is over it or holds it. Lifted onto
 * a point, it is drawn there, and faint at the place it left; outside the view, at its place.
 */
function drawDragMark(context: CanvasRenderingContext2D, project: (code: Vec3) => ScreenPoint, mark: NonNullable<Scene["dragMark"]>, width: number, height: number) {
  const home = project(mark.code);
  if (mark.onPoint) {
    drawRing(context, home, RING_MARK_PX, mark.colour, 2, 0.4);
    drawRingMark(context, mark.onPoint, mark.colour, 3);
    return;
  }
  const arrow = edgeArrow(home, width, height, EDGE_INSET_PX);
  if (arrow) drawEdgeArrow(context, arrow, mark.colour);
  else drawRingMark(context, home, mark.colour, mark.held ? 3 : 2);
}

/** A ring with a dot at its centre: the requested code. */
function drawRingMark(context: CanvasRenderingContext2D, at: ScreenPoint, colour: string, lineWidth: number) {
  drawRing(context, at, RING_MARK_PX, colour, lineWidth);
  context.fillStyle = colour;
  context.beginPath();
  context.arc(at.x, at.y, 1.5, 0, 2 * Math.PI);
  context.fill();
}

function drawMark(context: CanvasRenderingContext2D, at: ScreenPoint, shape: SpaceMark["shape"], colour: string) {
  context.strokeStyle = colour;
  context.fillStyle = colour;
  if (shape === "ring") {
    drawRingMark(context, at, colour, 2);
  } else if (shape === "dot") {
    context.beginPath();
    context.arc(at.x, at.y, 3, 0, 2 * Math.PI);
    context.fill();
  } else {
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(at.x - 6, at.y);
    context.lineTo(at.x + 6, at.y);
    context.moveTo(at.x, at.y - 6);
    context.lineTo(at.x, at.y + 6);
    context.stroke();
  }
}

/** A small triangle on the edge, pointing toward a mark outside the view. */
function drawEdgeArrow(context: CanvasRenderingContext2D, arrow: { x: number; y: number; angle: number }, colour: string) {
  context.save();
  context.translate(arrow.x, arrow.y);
  context.rotate(arrow.angle);
  context.fillStyle = colour;
  context.beginPath();
  context.moveTo(6, 0);
  context.lineTo(-5, -5);
  context.lineTo(-5, 5);
  context.closePath();
  context.fill();
  context.restore();
}

function drawRing(context: CanvasRenderingContext2D, at: { x: number; y: number }, radius: number, colour: string, lineWidth: number, alpha = 1) {
  context.globalAlpha = alpha;
  context.strokeStyle = colour;
  context.lineWidth = lineWidth;
  context.beginPath();
  context.arc(at.x, at.y, radius, 0, 2 * Math.PI);
  context.stroke();
}

/** Three short arrows from one corner show which way code values 1, 2 and 3 point. */
function drawOrientationKey(context: CanvasRenderingContext2D, orbit: Orbit, origin: { x: number; y: number }, axisColours: SpaceColours["axes"]) {
  const length = 15;
  context.font = "10px ui-monospace, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 1.5;
  for (const direction of [...axisDirections(orbit)].sort((a, b) => a.depth - b.depth)) {
    const colour = axisColours[direction.axis]!;
    context.globalAlpha = direction.depth < 0 ? 0.55 : 1;
    context.strokeStyle = colour;
    context.fillStyle = colour;
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(origin.x + direction.dx * length, origin.y + direction.dy * length);
    context.stroke();
    context.fillText(String(direction.axis + 1), origin.x + direction.dx * (length + 7), origin.y + direction.dy * (length + 7));
  }
  context.globalAlpha = 1;
}

/** The frame's width, at most `limit`; 0 until measured. */
function useWidth(frame: RefObject<HTMLDivElement | null>, limit: number): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.min(limit, Math.floor(entry!.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame, limit]);
  return width;
}

/** No values: nothing selected, no arrows, no stepped point. */
const NO_VALUES: readonly number[] = [];

/** Flat values back to 3-vectors: x, y, z of the first, then of the second, and so on. */
function vectorsOf(values: readonly number[]): Vec3[] {
  const vectors: Vec3[] = [];
  for (let index = 0; index + 2 < values.length; index += 3) vectors.push([values[index]!, values[index + 1]!, values[index + 2]!]);
  return vectors;
}
