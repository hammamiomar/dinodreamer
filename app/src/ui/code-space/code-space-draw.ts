// Canvas 2D drawing routines for the 3-D code space (code-space-3d.tsx).
// Draws axes, depth-sorted points, trails, contribution arrows, marks, edge indicators,
// and the corner orientation key using the caller's memoized projector.

import { cssColour } from "../css-colour";
import type { SpaceArrows, SpaceMark, SpaceTrail } from "./code-space-3d";
import {
  ARROW_HEAD_PX,
  arrowNames,
  axisDirections,
  axisLines,
  chainCorners,
  depthOrder,
  edgeArrow,
  placeLabel,
  RING_MARK_PX,
  SELECTED_RING_PX,
  type LabelBox,
  type Orbit,
  type ScreenPoint,
  type Vec3,
  type View,
} from "./projection";

/** The view's colours, read from styles.css CSS custom properties. */
export interface SpaceColours {
  ground: string;
  /** Points and the hover ring: measured codes (--measure). */
  point: string;
  /** The chosen point (--ink). */
  selected: string;
  /** Code axes 1, 2, and 3. */
  axes: readonly [string, string, string];
  /** Arrow labels (--ink-2). */
  label: string;
  /** Origin ring for arrow chains (--ink-3). */
  origin: string;
  /** Monospace font family for arrow labels. */
  font: string;
}

export function readSpaceColours(): SpaceColours {
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

export interface SpaceScene {
  projected: readonly ScreenPoint[];
  marks: readonly SpaceMark[];
  trail: SpaceTrail | undefined;
  arrows: SpaceArrows | undefined;
  pointColour: string;
  /** Selected point's code where it is currently drawn, or null. */
  selection: Vec3 | null;
  /** Screen position of the hovered or stepped ring, or null. */
  ringed: ScreenPoint | null;
  /** Draggable ring: code, snapped point while lifted (or null), and held/hovered state. */
  dragMark: { code: Vec3; colour: string; onPoint: ScreenPoint | null; held: boolean } | null;
  /** Corner orientation key naming the three axes. */
  orientationKey: boolean;
}

/**
 * Draw axes behind, then depth-sorted points, trail, contribution arrows, marks,
 * draggable ring, and selection/hover rings on top.
 */
export function drawSpace(
  context: CanvasRenderingContext2D,
  view: View,
  project: (code: Vec3) => ScreenPoint,
  scene: SpaceScene,
  colours: SpaceColours,
): void {
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

  // Nearer points are drawn more opaque to convey depth.
  context.fillStyle = scene.pointColour;
  for (const index of depthOrder(scene.projected)) {
    const point = scene.projected[index]!;
    const nearness = Math.max(0, Math.min(1, (point.depth / view.fit.radius + 1) / 2));
    context.globalAlpha = 0.3 + 0.6 * nearness;
    context.beginPath();
    context.arc(point.x, point.y, POINT_RADIUS_PX, 0, 2 * Math.PI);
    context.fill();
  }

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

/** Draw a tip-to-tail vector chain from the origin with haloed labels on top. */
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

function drawDragMark(
  context: CanvasRenderingContext2D,
  project: (code: Vec3) => ScreenPoint,
  mark: NonNullable<SpaceScene["dragMark"]>,
  width: number,
  height: number,
) {
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
