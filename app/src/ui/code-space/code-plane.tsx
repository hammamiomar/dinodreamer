import { FIT_MARGIN } from "./projection";
import { TargetOverlay } from "./target-handles";
// The flat view of a code space: the points on one pair of code values, both
// axes at one scale, so the picture is a true projection of the codes. It is
// the code space for people who ask for reduced motion; it does not turn. With
// focus, the arrow keys step through its points and Enter chooses one, as on the
// turning view (point-steps.ts), and the stepped point shows its picture. A chain
// of arrows is drawn as the turning view draws it, with the same rule for which
// arrows carry a name (projection.ts). A draggable ring moves as it does on the
// turning view (mark-drag.ts): a press on it, or a finger within 22 px of it, lifts
// it, and it moves from point to point; the page does not scroll under that finger.
// After a move without a drag (Space, Random token), the new point's picture shows
// for a moment; the ring does not travel here.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useMarkDrag } from "./mark-drag";
import { ringIsOn, usePointSteps } from "./point-steps";
import { liftedPoint, PointTooltip } from "./point-tooltip";
import type { CodeSpaceProps, SpaceArrows, SpacePoint } from "./code-space-3d";
import { arrowHead, arrowNames, AXIS_PAIRS, chainCorners, isClick, placeLabel, planar, reachesDragMark, RING_MARK_PX, snapPoint } from "./projection";
import type { AxisPair, Fit, LabelBox } from "./projection";
import { Select } from "../select";

const SIZE = 320;
/** The names' size in the drawing's units, and Paper Mono's advance (0.6 em): an SVG name has no width before it is drawn, so its width is its length in characters. */
const NAME_FONT = 10;
const NAME_ADVANCE = 0.6 * NAME_FONT;

/** A press that started on the draggable ring, at `start` CSS pixels from the plane's corner. */
type RingPress = { pointerId: number; start: { x: number; y: number }; dragged: boolean };

export function CodePlane({ points, marks = [], arrows, pointColour, selectedKey = null, onSelect, dragMark, targetHandles, label, fit }: CodeSpaceProps & { fit: Fit }) {
  const [pairIndex, setPairIndex] = useState(0);
  const steps = usePointSteps(points, onSelect, dragMark?.onDrop);
  const press = useRef<RingPress | null>(null);
  const drag = useMarkDrag(points, dragMark, () => {
    press.current = null;
  });
  const svg = useRef<SVGSVGElement>(null);
  const stepped = steps.stepped === null ? undefined : points[steps.stepped];
  const axes = AXIS_PAIRS[pairIndex]!;
  const selected = points.find((point) => point.key === selectedKey);
  const at = (code: SpacePoint["code"]) => planar(code, axes, fit, SIZE);
  // The points where the plane draws them, in its units: the places the ring can move to.
  const placed = useMemo(() => points.map((point) => planar(point.code, axes, fit, SIZE)), [points, axes, fit]);
  const markHome = dragMark ? at(dragMark.code) : null;
  const markOnPoint = drag.lifted && drag.lifted.point !== null ? (placed[drag.lifted.point] ?? null) : null;

  /** A pointer's place on the plane, in CSS pixels from its corner and in the drawing's units. */
  const pointerOn = (pointer: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    const perPx = SIZE / rect.width;
    const px = { x: pointer.clientX - rect.left, y: pointer.clientY - rect.top };
    return { px, units: { x: px.x * perPx, y: px.y * perPx }, perPx };
  };
  /** Whether a press there lifts the draggable ring: its reach is in CSS pixels, whatever the plane's size. */
  const liftsMark = (pointer: { clientX: number; clientY: number }, finger: boolean) => {
    if (!markHome || points.length === 0) return false;
    const { px, perPx } = pointerOn(pointer);
    return reachesDragMark({ x: markHome.x / perPx, y: markHome.y / perPx }, px, finger);
  };
  const liftsMarkRef = useRef(liftsMark);
  liftsMarkRef.current = liftsMark;

  // One finger on the draggable ring moves the ring, so the page must not scroll under it. Native, to stop the scroll.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 1 && liftsMarkRef.current(event.touches[0]!, true)) event.preventDefault();
    };
    element.addEventListener("touchstart", onTouchStart, { passive: false });
    return () => element.removeEventListener("touchstart", onTouchStart);
  }, []);

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    // A second finger puts a lifted ring back.
    if (press.current) {
      press.current = null;
      drag.clearDrag();
      return;
    }
    const finger = event.pointerType === "touch";
    if (event.button !== 0 || !liftsMark(event, finger)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { pointerId: event.pointerId, start: pointerOn(event).px, dragged: false };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) {
      if (event.pointerType !== "touch") drag.setOver(liftsMark(event, false));
      return;
    }
    const { px, units } = pointerOn(event);
    if (!current.dragged && isClick(current.start, px)) return;
    press.current = { ...current, dragged: true };
    drag.moveTo(snapPoint(placed, units, SIZE, SIZE), event.pointerType === "touch" ? units : null);
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    press.current = null;
    if (current.dragged) drag.release();
  };

  // The picture of the point a lifted ring sits on; else of the stepped point; else, for a moment, of the point the ring moved to without a drag.
  let shown = liftedPoint(drag.lifted, points, placed);
  if (!shown && stepped) shown = { point: stepped, at: at(stepped.code), finger: false };
  const movedTo = drag.moved === null ? undefined : points[drag.moved];
  if (!shown && movedTo) shown = { point: movedTo, at: at(movedTo.code), finger: false };

  return (
    <div className="code-space-frame">
      <div className="code-plane-square">
        <svg
          ref={svg}
          className="code-plane"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={planeLabel(label, axes, onSelect !== undefined, dragMark !== undefined)}
          tabIndex={onSelect || dragMark ? 0 : undefined}
          data-moving-mark={drag.over || drag.lifted !== null || undefined}
          onKeyDown={(event) => {
            if (steps.onKey(event)) event.preventDefault();
          }}
          onBlur={() => {
            steps.clear();
            press.current = null;
            drag.clearDrag();
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            press.current = null;
            drag.clearDrag();
          }}
          onPointerLeave={() => press.current === null && drag.setOver(false)}
        >
          <line className="code-plane-axis" x1={0} y1={SIZE / 2} x2={SIZE} y2={SIZE / 2} />
          <line className="code-plane-axis" x1={SIZE / 2} y1={0} x2={SIZE / 2} y2={SIZE} />
          <PlaneDots points={points} axes={axes} fit={fit} colour={pointColour} />
          {arrows && <PlaneArrows arrows={arrows} axes={axes} fit={fit} />}
          {marks.map((mark, index) => {
            const { x, y } = at(mark.code);
            return mark.shape === "dot" ? (
              <circle key={index} cx={x} cy={y} r={3} fill={mark.colour} />
            ) : (
              <circle key={index} cx={x} cy={y} r={RING_MARK_PX} fill="none" stroke={mark.colour} strokeWidth={2} />
            );
          })}
          {dragMark && markHome && (
            <g className="code-plane-drag-mark" fill="none" stroke={dragMark.colour}>
              {/* Lifted onto a point: drawn there, and faint at the place it left. */}
              {markOnPoint && <circle cx={markHome.x} cy={markHome.y} r={RING_MARK_PX} strokeWidth={2} opacity={0.4} />}
              {markOnPoint && <circle cx={markOnPoint.x} cy={markOnPoint.y} r={RING_MARK_PX} strokeWidth={3} />}
              {!markOnPoint && <circle cx={markHome.x} cy={markHome.y} r={RING_MARK_PX} strokeWidth={drag.over ? 3 : 2} />}
            </g>
          )}
          {selected && <circle className="code-plane-selected" cx={at(selected.code).x} cy={at(selected.code).y} r={6} />}
          {stepped && <circle cx={at(stepped.code).x} cy={at(stepped.code).y} r={5} fill="none" stroke="var(--measure)" strokeWidth={1.5} />}
        </svg>
        {targetHandles && <TargetOverlay handles={targetHandles} points={points} project={at} scale={SIZE / (2 * fit.radius * FIT_MARGIN)} size={SIZE} />}
        {shown && <PointTooltip point={shown.point} at={{ x: shown.at.x / SIZE, y: shown.at.y / SIZE }} finger={shown.finger} />}
      </div>
      <p className="code-space-announce" aria-live="polite">
        {steps.announcement || (movedTo ? ringIsOn(movedTo) : "")}
      </p>
      <label className="code-space-axes muted">
        Response vector components{" "}
        <Select value={pairIndex} onChange={(event) => setPairIndex(Number(event.target.value))}>
          {AXIS_PAIRS.map(([horizontal, vertical], index) => (
            <option key={index} value={index}>
              {horizontal + 1} and {vertical + 1}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

/** The plane's accessible name: what it shows, then what pointer movement and the keys do. */
export function planeLabel(label: string, axes: AxisPair, choose: boolean, place: boolean): string {
  const parts = [`${label}, response vector components ${axes[0] + 1} and ${axes[1] + 1}`];
  if (place) parts.push("Press and move the ring onto another point to move it there");
  if (choose && place) parts.push("Arrow keys step through the tokens, Enter chooses one and Space moves the ring to it");
  else if (choose) parts.push("Arrow keys step through the tokens and Enter chooses one");
  else if (place) parts.push("Arrow keys step through the tokens and Space moves the ring to one");
  return parts.join(". ");
}

/** Redrawn only when the points, axes or fit change, not when a mark moves. */
const PlaneDots = memo(function PlaneDots({ points, axes, fit, colour }: { points: readonly SpacePoint[]; axes: AxisPair; fit: Fit; colour?: string }) {
  return (
    <g className="code-plane-dots" style={colour ? { fill: colour } : undefined}>
      {points.map((point) => {
        const { x, y } = planar(point.code, axes, fit, SIZE);
        return <circle key={point.key} cx={x} cy={y} r={2} />;
      })}
    </g>
  );
});

/**
 * A chain of arrows tip to tail from the origin on the axis pair, each with its head, then the
 * names on top with a halo: the lit arrow in the accent, the others faint while one is lit.
 */
function PlaneArrows({ arrows, axes, fit }: { arrows: SpaceArrows; axes: AxisPair; fit: Fit }) {
  const corners = chainCorners(arrows.vectors).map((corner) => planar(corner, axes, fit, SIZE));
  const placed: LabelBox[] = [];
  const names = arrowNames(corners, arrows.labels, arrows.lit).flatMap((name) => {
    const box = placeLabel(name, name.text.length * NAME_ADVANCE, placed, SIZE);
    if (!box) return [];
    placed.push(box);
    return [{ name, box }];
  });
  const textAnchor = { left: "start", right: "end", center: "middle" } as const;
  return (
    <g className="code-plane-arrows">
      <circle className="code-plane-origin" cx={corners[0]!.x} cy={corners[0]!.y} r={3} />
      {arrows.vectors.map((_, index) => {
        const from = corners[index]!;
        const to = corners[index + 1]!;
        const head = arrowHead(from, to);
        const lit = arrows.lit === index;
        return (
          <g key={index} data-lit={lit || undefined} data-faint={(arrows.lit !== null && !lit) || undefined}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            {head && <polygon points={head.map((point) => `${point.x},${point.y}`).join(" ")} />}
          </g>
        );
      })}
      {names.map(({ name, box }) => (
        <text key={name.index} x={box.anchor.x} y={box.anchor.y} textAnchor={textAnchor[box.align]} data-lit={name.lit || undefined}>
          {name.text}
        </text>
      ))}
    </g>
  );
}
