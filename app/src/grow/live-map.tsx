// The live map of a training run. The basis group's cloud stands in its own three numbers, as on the
// group's page; the run's target is marked on it; and the canvas's 64 patches are points on it, placed
// by each reading (live-map-points.ts). A run is those points moving: under a mean method their mean closes on
// the target, under a distribution method they spread over the set. Every point is a reading. Between
// two readings the points travel for a moment, so the eye can follow which went where; at rest the map
// draws nothing new and costs nothing. Drag to rotate; the arrow keys rotate too.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { SITE_WORDS, fill } from "../app/site-words";
import { bandColours, bandIndex } from "../features/look/strength-bands";
import { LOOK_ORBIT } from "../features/look/look-camera";
import type { StrengthCuts } from "../recipe";
import { orbitBy, projector, type Orbit, type Vec3, type View } from "../ui/code-space/projection";
import { useMediaMatch } from "../ui/media-match";
import { between, cloudPoints, distanceInMedians, mapFit, meanOf, patchPoints, scoredMean, withMean } from "./live-map-points";
import { readPatchIndices, type ReadRegion } from "./selection-cells";
import "./live-map.css";

/** The points take this long to travel from one reading to the next. */
const TRAVEL_MS = 420;
/** An arrow key turns the map as a drag of this many pixels does. */
const KEY_TURN_PX = 24;
/**
 * Sizes in CSS pixels: a cloud row, a patch outside the scored region, a scored patch, a set member (smaller in
 * a set of more than MANY_MEMBERS tokens, such as a default set's 297, so the set does not cover the cloud), the
 * mean's ring, the target.
 */
const SIZE = { row: 1.5, unscored: 2, scored: 3.5, member: 5, manyMember: 3, mean: 7, target: 11 } as const;
const MANY_MEMBERS = 40;
const ARROWS: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const WORDS = SITE_WORDS.grow.map;

export interface LiveMapProps {
  /** The group's sample cloud: rows of three values, with each row's norm for the colour of its level. */
  cloud: { codes: Float32Array; norms: Float32Array; count: number };
  strength: StrengthCuts;
  /** What the run trains toward, as points of the map: one for basis-group mean, the set's patches otherwise. */
  target: readonly Vec3[];
  /** A mean method draws the line from the patches' mean to the target's mean; a distribution method draws the set. */
  comparison: "mean" | "distribution";
  /** True for a token method: the map then says that it shows a part of what is compared. */
  shadow: boolean;
  /** The latest reading's patch codes; null before the first. */
  patchCodes: Float32Array | null;
  region: ReadRegion;
  medianNorm: number;
  /** The map's name for a screen reader. */
  label: string;
}

/** The inks of the page as values a canvas can draw with. */
function inks(element: Element): { ink: string; ink2: string; ink3: string } {
  const style = getComputedStyle(element);
  const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { ink: value("--ink", "#efece8"), ink2: value("--ink-2", "#9c9994"), ink3: value("--ink-3", "#5e5b57") };
}

export function LiveMap({ cloud, strength, target, comparison, shadow, patchCodes, region, medianNorm, label }: LiveMapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const orbit = useRef<Orbit>(LOOK_ORBIT);
  /** The patches as they are drawn now, and the travel to the newest reading while it lasts. */
  const shown = useRef<Vec3[]>([]);
  const travel = useRef<{ from: Vec3[]; to: Vec3[]; started: number; frame: number } | null>(null);
  const path = useRef<Vec3[]>([]);
  const still = useMediaMatch("(prefers-reduced-motion: reduce)");
  const [distance, setDistance] = useState<number | null>(null);

  const rows = useMemo(() => cloudPoints(cloud.codes, cloud.count), [cloud]);
  /** The rows of each level, so a level is drawn in one colour without sorting 4,096 rows. */
  const levels = useMemo(() => {
    const members: number[][] = [[], [], [], []];
    for (let row = 0; row < cloud.count; row++) members[bandIndex(cloud.norms[row]!, strength)]!.push(row);
    return members;
  }, [cloud, strength]);
  const fit = useMemo(() => mapFit(rows, target), [rows, target]);
  const targetMean = useMemo(() => meanOf(target), [target]);
  const scored = useMemo(() => new Set(readPatchIndices(region)), [region]);

  const draw = useCallback(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const box = element.getBoundingClientRect();
    if (box.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const [width, height] = [Math.round(box.width * ratio), Math.round(box.height * ratio)];
    if (element.width !== width || element.height !== height) { element.width = width; element.height = height; }
    const view: View = { fit, orbit: orbit.current, width: box.width, height: box.height };
    const place = projector(view);
    const { ink, ink2, ink3 } = inks(element);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, box.width, box.height);

    // The group's cloud, each level in its colour.
    const colours = bandColours();
    context.globalAlpha = 0.5;
    levels.forEach((members, level) => {
      context.fillStyle = colours[level]!;
      for (const row of members) {
        const at = place(rows[row]!);
        context.fillRect(at.x - SIZE.row / 2, at.y - SIZE.row / 2, SIZE.row, SIZE.row);
      }
    });
    context.globalAlpha = 1;

    // The target: the set's patches as squares, and for a mean method one larger square at their mean.
    context.strokeStyle = ink2;
    context.lineWidth = 1;
    if (target.length > 1) {
      const size = target.length > MANY_MEMBERS ? SIZE.manyMember : SIZE.member;
      for (const member of target) {
        const at = place(member);
        context.strokeRect(Math.round(at.x - size / 2) + 0.5, Math.round(at.y - size / 2) + 0.5, size, size);
      }
    }
    const goal = place(targetMean);
    if (comparison === "mean") {
      context.strokeStyle = ink;
      context.strokeRect(Math.round(goal.x - SIZE.target / 2) + 0.5, Math.round(goal.y - SIZE.target / 2) + 0.5, SIZE.target, SIZE.target);
    }

    const patches = shown.current;
    if (patches.length === 0) return;

    // The mean's path over the last readings, then the line a mean method closes.
    if (path.current.length > 1) {
      context.strokeStyle = ink3;
      context.beginPath();
      path.current.forEach((mean, index) => {
        const at = place(mean);
        if (index === 0) context.moveTo(at.x, at.y); else context.lineTo(at.x, at.y);
      });
      context.stroke();
    }
    const mean = place(meanOf(patches.filter((_, patch) => scored.has(patch))));
    if (comparison === "mean") {
      context.strokeStyle = ink2;
      context.beginPath();
      context.moveTo(mean.x, mean.y);
      context.lineTo(goal.x, goal.y);
      context.stroke();
    }

    // The canvas's patches: the ones the run scores in ink, the others dim.
    context.fillStyle = ink3;
    patches.forEach((patch, index) => {
      if (scored.has(index)) return;
      const at = place(patch);
      context.fillRect(at.x - SIZE.unscored / 2, at.y - SIZE.unscored / 2, SIZE.unscored, SIZE.unscored);
    });
    context.fillStyle = ink;
    patches.forEach((patch, index) => {
      if (!scored.has(index)) return;
      const at = place(patch);
      context.beginPath();
      context.arc(at.x, at.y, SIZE.scored / 2, 0, 2 * Math.PI);
      context.fill();
    });
    context.strokeStyle = ink;
    context.beginPath();
    context.arc(mean.x, mean.y, SIZE.mean / 2, 0, 2 * Math.PI);
    context.stroke();
  }, [fit, levels, rows, target, targetMean, comparison, scored]);

  // A new reading: the points travel from where they are drawn to their new places, then rest.
  useEffect(() => {
    if (patchCodes === null) {
      shown.current = [];
      path.current = [];
      setDistance(null);
      draw();
      return;
    }
    const to = patchPoints(patchCodes);
    const mean = scoredMean(to, region);
    path.current = withMean(path.current, mean);
    setDistance(distanceInMedians(mean, targetMean, medianNorm));
    if (travel.current) cancelAnimationFrame(travel.current.frame);
    if (still || shown.current.length === 0) {
      travel.current = null;
      shown.current = to;
      draw();
      return;
    }
    const from = shown.current;
    const step = (now: number) => {
      const moving = travel.current;
      if (!moving) return;
      const share = Math.min(1, (now - moving.started) / TRAVEL_MS);
      // Ease out: fast away from the old reading, slow into the new one.
      shown.current = between(moving.from, moving.to, 1 - (1 - share) ** 3);
      draw();
      if (share < 1) moving.frame = requestAnimationFrame(step);
      else travel.current = null;
    };
    travel.current = { from, to, started: performance.now(), frame: requestAnimationFrame(step) };
    return () => { if (travel.current) cancelAnimationFrame(travel.current.frame); };
  }, [patchCodes, region, targetMean, medianNorm, still, draw]);

  // Its box changed, or what it draws on did: draw again.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [draw]);

  const last = useRef<{ x: number; y: number } | null>(null);
  const turn = (dx: number, dy: number) => { orbit.current = orbitBy(orbit.current, dx, dy); draw(); };
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    last.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    turn(event.clientX - last.current.x, event.clientY - last.current.y);
    last.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerEnd = () => { last.current = null; };
  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const direction = ARROWS[event.key];
    if (!direction) return;
    event.preventDefault();
    turn(direction[0] * KEY_TURN_PX, direction[1] * KEY_TURN_PX);
  };

  let line: string = WORDS.waiting;
  if (distance !== null) line = comparison === "mean" ? fill(WORDS.meanLine, { distance: distance.toFixed(2) }) : WORDS.spreadLine;
  return (
    <figure className="live-map">
      <canvas ref={canvas} className="live-map-canvas" role="img" aria-label={label} tabIndex={0}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
        onDoubleClick={() => { orbit.current = LOOK_ORBIT; draw(); }} onKeyDown={onKeyDown} />
      <figcaption className="live-map-line">
        <span role="status">{line}</span>
        {shadow && distance !== null && <span className="live-map-shadow">{WORDS.shadow}</span>}
      </figcaption>
    </figure>
  );
}
