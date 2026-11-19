import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { isClick, pickPoint, type ScreenPoint, type Vec3 } from "../../ui/code-space/projection";
import { cssColour } from "../../ui/css-colour";
import type { StrengthCuts } from "../../recipe";
import { projectCloud } from "./cloud-geometry";
import {
  DOT_STYLE, drawCloudBackdrop, drawCloudMarks, drawHoverRing, drawOrder, drawPlainDots, drawSelectedDots, plainDotAlpha, plainDotOrder, selectedDotOrder,
  type CloudScene,
} from "./cloud-drawing";
import { createDotLayer, type DotLayer } from "./cloud-dots-webgl";
import {
  cameraView, flattenTo, frameCodes, LOOK_CAMERA, panBy, pinchBy, pressGesture, turnBy, zoomAt,
  type CameraFrame, type LookCamera, type PressGesture, type PrincipalPlane,
} from "./look-camera";
import { LOOK_TEXT } from "./look-text";
import { ResetMark } from "../../ui/reset-mark";
import type { BandIndex } from "./strength-bands";
import { canvasPixelRatio, pagePointer } from "../../ui/page-scale";

/** Turn: a drag turns and a click picks a dot. Lasso: a drag draws. Wand (Advanced): a click grows a region. */
export type LookTool = "turn" | "lasso" | "wand";
type Position = { x: number; y: number };
interface Press {
  id: number;
  start: Position;
  last: Position;
  gesture: PressGesture;
  dragged: boolean;
  path: Position[];
}

/** What the page asks of the view from outside it. */
export interface CloudViewHandle {
  /** Frames a band's dots and scrolls the view into sight. */
  showBand(band: BandIndex): void;
}

const EMPTY = new Set<number>();
const KEY_DRAGS: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
const KEY_TURN_PX = 15;
const KEY_PAN_PX = 40;
const KEY_ZOOM_FACTOR = 1.2;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const LASSO_MIN_STEP_PX = 2;
const POINT_PICTURE_SIZE = 128;
const POINT_PICTURE_GAP = 12;
const NARROW_VIEW_WIDTH_PX = 640;
const MIN_VIEW_HEIGHT_PX = 320;
const MAX_VIEW_HEIGHT_PX = 576;
const MODULE_PX = 64;
const VIEW_ASPECT_RATIO = 0.6;

/** Place the patch picture beside its dot, inside the visible part of the plot. */
export function placeCloudPicture(at: Position, bounds: { left: number; top: number; right: number; bottom: number }): Position & { size: number } {
  const size = Math.min(POINT_PICTURE_SIZE, bounds.right - bounds.left, bounds.bottom - bounds.top);
  const right = at.x + POINT_PICTURE_GAP;
  const above = at.y - POINT_PICTURE_GAP - size;
  const x = right + size <= bounds.right ? right : at.x - POINT_PICTURE_GAP - size;
  const y = above >= bounds.top ? above : at.y + POINT_PICTURE_GAP;
  return {
    x: Math.max(bounds.left, Math.min(x, bounds.right - size)),
    y: Math.max(bounds.top, Math.min(y, bounds.bottom - size)),
    size,
  };
}

/** Snap the plot height to the 64 px module on desktop and stay square on narrow viewports. */
function viewHeight(width: number): number {
  if (width < NARROW_VIEW_WIDTH_PX) return Math.max(MIN_VIEW_HEIGHT_PX, width);
  return Math.min(MAX_VIEW_HEIGHT_PX, Math.max(MIN_VIEW_HEIGHT_PX, Math.round((width * VIEW_ASPECT_RATIO) / MODULE_PX) * MODULE_PX));
}

export const CloudView = forwardRef<CloudViewHandle, {
  codes: readonly Vec3[];
  /** The band of each code: the legend frames a band's dots. */
  bands: readonly BandIndex[];
  /** The camera's radius in code units. */
  extent: number;
  strength: StrengthCuts;
  colours: readonly string[];
  selected?: ReadonlySet<number>;
  seeds?: readonly number[];
  highlighted?: ReadonlySet<number>;
  hovered: number | null;
  anchor?: number | null;
  lift?: CloudScene["lift"];
  onHover: (index: number | null) => void;
  tool?: LookTool;
  /** A click on a dot with Turn or Lasso: the page shows its picture. */
  onPick?: (index: number) => void;
  /** The patch picture shown beside a tapped dot. The page owns its image source. */
  pointPicture?: (index: number) => ReactNode;
  onSeed?: (index: number, additive: boolean) => void;
  onLasso?: (points: readonly ScreenPoint[], polygon: readonly Position[]) => void;
  /** The page's tools, in a separate row above the plot. */
  tools?: ReactNode;
  /** Advanced shows the three flat views at the view's edges. */
  advanced?: boolean;
}>(function CloudView({ codes, bands, extent, strength, colours, selected = EMPTY, seeds = [], highlighted = EMPTY, hovered, anchor = null, lift = null,
  onHover, tool = "turn", onPick, pointPicture, onSeed, onLasso, tools, advanced = false,
}, ref) {
  const frameElement = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const backdrop = useRef<HTMLCanvasElement>(null);
  const dotCanvas = useRef<HTMLCanvasElement>(null);
  // The frame's width, measured before the first draw (null until then), so 65,536 points are
  // projected and drawn once at the view's size, not first at a guess and again when it is known.
  const [measured, setMeasured] = useState<number | null>(null);
  const width = measured ?? 0;
  const height = viewHeight(width);
  const [camera, setCamera] = useState<LookCamera>(LOOK_CAMERA);
  const [plane, setPlane] = useState<PrincipalPlane | null>(null);
  const [lasso, setLasso] = useState<Position[]>([]);
  const press = useRef<Press | null>(null);
  // Every pointer held on the canvas; two of them pinch.
  const held = useRef(new Map<number, Position>());
  const accent = useMemo(() => cssColour("--ink", "#efece8"), []);
  const frame: CameraFrame = useMemo(() => ({ extent, width, height }), [extent, width, height]);
  const view = useMemo(() => cameraView(camera, frame), [camera, frame]);
  const positions = useMemo(() => (measured === null ? [] : projectCloud(codes, view)), [codes, view, measured]);
  const [picture, setPicture] = useState<{ index: number; at: ReturnType<typeof placeCloudPicture>; view: typeof view } | null>(null);
  // A camera change or resize invalidates the placement made at the tap.
  const shownPicture = picture?.view === view ? picture : null;

  useLayoutEffect(() => {
    const element = frameElement.current;
    if (!element) return;
    if (element.clientWidth > 0) setMeasured(Math.floor(element.clientWidth));
    // A hidden or departing view reports width 0; it keeps its last width, so the layer never has zero size.
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      if (next > 0) setMeasured(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // With WebGL2, three stacked canvases, none copied into another: the shells and axes; the
  // plain and selected dots as WebGL points; on top, your picture's dots, the lift, the anchor
  // and the hover. (Copying a WebGL canvas into a Canvas 2D layer reads its pixels back, which
  // costs more than it saves without a GPU.) Without WebGL2, everything goes into one
  // offscreen layer, which avoids drawing on the stacked canvases.
  // The top layer is drawn once per change; a hover copies it and adds one ring.
  const layer = useMemo(() => document.createElement("canvas"), []);
  // Undefined until the dot canvas is mounted; null where there is no WebGL2. A lost or
  // restored WebGL context counts a change, and the count redraws the layers.
  const [dots, setDots] = useState<DotLayer | null | undefined>(undefined);
  const [contextChanges, setContextChanges] = useState(0);
  useLayoutEffect(() => {
    const created = createDotLayer(dotCanvas.current!, () => setContextChanges((count) => count + 1));
    setDots(created);
    return () => created?.dispose();
  }, []);
  useEffect(() => dots?.setDots(codes, colours), [dots, codes, colours]);
  const [layerVersion, setLayerVersion] = useState(0);
  useEffect(() => {
    const under = backdrop.current?.getContext("2d");
    const marks = layer.getContext("2d");
    if (!under || !marks || dots === undefined || measured === null) return;
    const ratio = canvasPixelRatio(under.canvas);
    for (const target of [under.canvas, layer]) {
      target.width = Math.round(width * ratio);
      target.height = Math.round(height * ratio);
    }
    under.setTransform(ratio, 0, 0, ratio, 0, 0);
    marks.setTransform(ratio, 0, 0, ratio, 0, 0);
    const scene: CloudScene = { positions, colours, selected, seeds, highlighted, anchor, lift, strength, extent, flat: plane !== null, lasso, accent };
    const order = drawOrder(positions);
    const plain = plainDotOrder(order, selected, highlighted);
    const chosen = selectedDotOrder(order, selected, highlighted);
    const alpha = plainDotAlpha(selected);
    const drawnByWebGL = dots?.draw(view, ratio, [
      { order: plain, alpha, round: false, size: DOT_STYLE.plainSide, colour: null },
      { order: chosen, alpha: DOT_STYLE.alpha, round: true, size: 2 * DOT_STYLE.selectedRadius, colour: accent },
    ]) ?? false;
    dotCanvas.current!.style.visibility = drawnByWebGL ? "visible" : "hidden";
    drawCloudBackdrop(drawnByWebGL ? under : marks, view, scene);
    if (!drawnByWebGL) {
      drawPlainDots(marks, view, scene, plain, alpha);
      drawSelectedDots(marks, scene, chosen);
    }
    drawCloudMarks(marks, view, scene, order);
    setLayerVersion((version) => version + 1);
  }, [layer, dots, contextChanges, view, positions, colours, selected, seeds, highlighted, anchor, lift, strength, extent, plane, lasso, width, height, accent, measured]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || layerVersion === 0) return;
    const ratio = canvasPixelRatio(context.canvas);
    if (context.canvas.width !== layer.width || context.canvas.height !== layer.height) {
      context.canvas.width = layer.width;
      context.canvas.height = layer.height;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, layer.width, layer.height);
    context.drawImage(layer, 0, 0);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (shownPicture && positions[shownPicture.index]) drawHoverRing(context, positions[shownPicture.index]);
    if (hovered !== null && hovered !== shownPicture?.index && positions[hovered]) drawHoverRing(context, positions[hovered]);
  }, [layer, layerVersion, hovered, positions, shownPicture]);

  function zoomToward(at: Position, factor: number) {
    setCamera((current) => zoomAt(current, frame, at, factor));
  }
  const middle = { x: width / 2, y: height / 2 };
  // The wheel listener is not passive, so it can keep the page from scrolling; it reads the latest frame.
  const zoomRef = useRef(zoomToward);
  zoomRef.current = zoomToward;
  useEffect(() => {
    const element = canvas.current!;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || document.activeElement === element) {
        event.preventDefault();
        zoomRef.current(pagePointer(event, element), Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY));
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  useImperativeHandle(ref, () => ({
    showBand(band) {
      const members = codes.filter((_, index) => bands[index] === band);
      setCamera((current) => frameCodes(current, frame, members));
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      frameElement.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "instant" : "smooth" });
    },
  }), [codes, bands, frame]);

  function flatten(value: PrincipalPlane) {
    setPlane(value);
    setCamera((current) => flattenTo(current, value));
    setLasso([]);
  }
  function turn(dx: number, dy: number) {
    setPlane(null);
    setCamera((current) => turnBy(current, dx, dy));
  }
  function pan(dx: number, dy: number) {
    setCamera((current) => panBy(current, frame, dx, dy));
  }
  function reset() {
    setPicture(null);
    setPlane(null);
    setCamera(LOOK_CAMERA);
  }
  function pointer(event: PointerEvent<HTMLCanvasElement>): Position {
    return pagePointer(event, event.currentTarget);
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button > 2) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = pointer(event);
    setPicture(null);
    held.current.set(event.pointerId, at);
    onHover(null);
    // A second finger ends the first one's turn or lasso; the two now pinch.
    if (held.current.size > 1) {
      press.current = null;
      setLasso([]);
      return;
    }
    press.current = { id: event.pointerId, start: at, last: at, gesture: pressGesture(tool === "lasso" ? "lasso" : "wand", event), dragged: false, path: [at] };
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const at = pointer(event);
    if (!held.current.has(event.pointerId)) {
      onHover(pickPoint(positions, at, -1));
      return;
    }
    if (held.current.size > 1) {
      const fingers = [...held.current.keys()].slice(0, 2);
      if (!fingers.includes(event.pointerId)) return;
      const before = [held.current.get(fingers[0])!, held.current.get(fingers[1])!] as const;
      held.current.set(event.pointerId, at);
      const after = [held.current.get(fingers[0])!, held.current.get(fingers[1])!] as const;
      setCamera((current) => pinchBy(current, frame, before, after));
      return;
    }
    held.current.set(event.pointerId, at);
    const current = press.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.dragged && isClick(current.start, at)) return;
    current.dragged = true;
    if (current.gesture === "turn") turn(at.x - current.last.x, at.y - current.last.y);
    else if (current.gesture === "pan") pan(at.x - current.last.x, at.y - current.last.y);
    else if (Math.hypot(at.x - current.last.x, at.y - current.last.y) >= LASSO_MIN_STEP_PX) {
      current.path.push(at);
      setLasso([...current.path]);
    }
    current.last = at;
  }
  function showPointPicture(index: number, element: HTMLCanvasElement) {
    if (!pointPicture) return;
    const box = element.getBoundingClientRect();
    const scale = box.width / width;
    const headerHeight = parseFloat(getComputedStyle(element).getPropertyValue("--top")) || 0;
    const visible = {
      left: 0,
      right: width,
      top: Math.max(0, headerHeight - box.top) / scale,
      bottom: Math.min(height, (window.innerHeight - box.top) / scale),
    };
    setPicture({ index, at: placeCloudPicture(positions[index], visible), view });
  }
  function up(event: PointerEvent<HTMLCanvasElement>) {
    held.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const current = press.current;
    if (!current || current.id !== event.pointerId) return;
    press.current = null;
    const at = pointer(event);
    if (current.gesture === "lasso" && current.path.length >= 3) onLasso?.(positions, current.path);
    else if (!current.dragged) {
      const index = pickPoint(positions, at, -1);
      if (index !== null) {
        showPointPicture(index, event.currentTarget);
        if (tool === "wand") onSeed?.(index, event.shiftKey);
        else onPick?.(index);
      }
    }
    setLasso([]);
  }
  function cancel(event: PointerEvent<HTMLCanvasElement>) {
    held.current.delete(event.pointerId);
    press.current = null;
    setLasso([]);
  }

  return (
    <div className="look-view" ref={frameElement}>
      <div className="look-view-toolbar">
        <div className="look-view-tools">{tools}</div>
        <button type="button" className="link-control look-view-reset reset-control" aria-label={LOOK_TEXT.resetView} title={LOOK_TEXT.resetView} onClick={reset}><ResetMark /></button>
      </div>
      <div className="look-view-stage">
        <canvas ref={backdrop} className="look-cloud-under" style={{ height }} aria-hidden="true" />
        <canvas ref={dotCanvas} className="look-cloud-under" style={{ height }} aria-hidden="true" />
        <canvas
          ref={canvas}
          className="look-cloud-canvas"
          aria-label={LOOK_TEXT.canvasLabel}
          tabIndex={0}
          style={{ width: "100%", height }}
          data-tool={tool}
          data-plane={plane ?? "3d"}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
          onPointerLeave={() => { if (held.current.size === 0) onHover(null); }}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            const drag = KEY_DRAGS[event.key];
            if (drag && event.shiftKey) pan(drag.x * KEY_PAN_PX, drag.y * KEY_PAN_PX);
            else if (drag) turn(drag.x * KEY_TURN_PX, drag.y * KEY_TURN_PX);
            else if (event.key === "+" || event.key === "=") zoomToward(middle, KEY_ZOOM_FACTOR);
            else if (event.key === "-") zoomToward(middle, 1 / KEY_ZOOM_FACTOR);
            else if (event.key === "Escape" && (press.current !== null || lasso.length > 0 || shownPicture !== null)) {
              press.current = null;
              held.current.clear();
              setLasso([]);
              setPicture(null);
            }
            else return;
            event.preventDefault();
          }}
        />
        {shownPicture && (
          <div className="look-point-picture" style={{ left: shownPicture.at.x, top: shownPicture.at.y, width: shownPicture.at.size }} aria-hidden="true">
            {pointPicture?.(shownPicture.index)}
          </div>
        )}
        <p className="look-view-hint" aria-hidden="true">{LOOK_TEXT.cloud.hints[tool]}</p>
        {advanced && (
          <>
            {plane && <span className="look-view-label">{LOOK_TEXT.planes[plane]}</span>}
            <div className="look-view-planes">
              {(["12", "13", "23"] as const).map((value, index) => (
                <button key={value} className={`look-plane look-plane-${index}`} data-plane={value}
                  aria-pressed={plane === value} onClick={() => flatten(value)}>{LOOK_TEXT.planes[value]}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
