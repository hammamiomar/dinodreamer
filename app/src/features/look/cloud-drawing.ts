import type { StrengthCuts } from "../../recipe";
import { arrowHead, axisDirections, projector, viewScale, type ScreenPoint, type Vec3, type View } from "../../ui/code-space/projection";
import { LOOK_TEXT } from "./look-text";
import { BAND_NAMES, bandColours } from "./strength-bands";

export interface CloudScene {
  positions: readonly ScreenPoint[];
  colours: readonly string[];
  selected: ReadonlySet<number>;
  seeds: readonly number[];
  highlighted: ReadonlySet<number>;
  /** The patch the request asks for. */
  anchor: number | null;
  /** From the person's patch to the patch a lift would ask for. */
  lift: { from: number; to: number } | null;
  strength: StrengthCuts;
  /** The length of the drawn axes, in code units. */
  extent: number;
  flat: boolean;
  lasso: readonly { x: number; y: number }[];
  accent: string;
}

/** Depth bins for the draw order. At zoom 64 one bin is under half a pixel of depth. */
export const DEPTH_BINS = 65536;

/**
 * Indices farthest first, so nearer dots cover farther ones: a counting sort on
 * depth in DEPTH_BINS equal bins. Dots in one bin keep index order. Counting sort
 * keeps the cost linear in the number of loaded dots.
 */
export function drawOrder(points: readonly { depth: number }[]): Uint32Array {
  const count = points.length;
  let low = Infinity;
  let high = -Infinity;
  for (const point of points) {
    low = Math.min(low, point.depth);
    high = Math.max(high, point.depth);
  }
  const perDepth = high > low ? (DEPTH_BINS - 1) / (high - low) : 0;
  const bins = new Uint16Array(count);
  const starts = new Uint32Array(DEPTH_BINS + 1);
  for (let index = 0; index < count; index++) {
    bins[index] = Math.floor((points[index].depth - low) * perDepth);
    starts[bins[index] + 1]++;
  }
  for (let bin = 1; bin <= DEPTH_BINS; bin++) starts[bin] += starts[bin - 1];
  const order = new Uint32Array(count);
  for (let index = 0; index < count; index++) order[starts[bins[index]]++] = index;
  return order;
}

/** How dots look, for Canvas 2D and WebGL alike: plain 3-pixel squares, selected round dots, in CSS pixels. */
export const DOT_STYLE = { plainSide: 3, selectedRadius: 2.7, alpha: 0.82, behindSelection: 0.18 } as const;

/** Plain dots' alpha: faint behind a selection, so the selected dots stand out. */
export function plainDotAlpha(selected: ReadonlySet<number>): number {
  return selected.size > 0 ? DOT_STYLE.behindSelection : DOT_STYLE.alpha;
}

/** The dots drawn as plain squares, in draw order: all but the selected ones and your picture's. */
export function plainDotOrder(order: Uint32Array, selected: ReadonlySet<number>, highlighted: ReadonlySet<number>): Uint32Array {
  if (selected.size === 0 && highlighted.size === 0) return order;
  return order.filter((index) => !selected.has(index) && !highlighted.has(index));
}

/** The selected dots, in draw order, over the plain ones; your picture's selected patches are drawn with the marks. */
export function selectedDotOrder(order: Uint32Array, selected: ReadonlySet<number>, highlighted: ReadonlySet<number>): Uint32Array {
  if (selected.size === 0) return new Uint32Array(0);
  return order.filter((index) => selected.has(index) && !highlighted.has(index));
}

/** Clears the layer and draws what lies behind the dots: the shells at the band cuts and the axes. */
export function drawCloudBackdrop(context: CanvasRenderingContext2D, view: View, scene: CloudScene): void {
  const { width, height } = view;
  context.clearRect(0, 0, width, height);
  const project = projector(view);
  const origin = project([0, 0, 0]);
  const scale = viewScale(view);
  context.font = "11px 'Paper Mono', monospace";
  context.textBaseline = "middle";

  // Labels sit at the upper left of each shell, where the main lobe rarely is;
  // on a diagonal, neighbouring shells' labels do not overlap.
  const { cuts, maximum } = scene.strength;
  const gate = scene.strength.ring;
  const label = (radius: number, text: string, colour: string) => {
    context.fillStyle = colour;
    context.fillText(text, origin.x - radius * scale * Math.SQRT1_2 - 4, origin.y - radius * scale * Math.SQRT1_2 - 4);
  };
  context.textAlign = "right";
  if (maximum > gate) {
    for (let band = 3; band >= 1; band--) {
      drawShell(cuts[band - 1], bandColours()[band], false);
      label(cuts[band - 1], BAND_NAMES[band], bandColours()[band]);
    }
  }
  drawShell(gate, "#a4a9b8", true);
  label(gate, LOOK_TEXT.ring, "#c0c4cf");
  context.textAlign = "left";

  context.lineWidth = 1;
  context.strokeStyle = "#343741";
  context.setLineDash([3, 5]);
  for (let axis = 0; axis < 3; axis++) {
    const end = (sign: number): Vec3 => [0, 1, 2].map((a) => a === axis ? sign * scene.extent : 0) as [number, number, number];
    const from = project(end(-1));
    const to = project(end(1));
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  context.setLineDash([]);

  function drawShell(radius: number, colour: string, gate: boolean) {
    context.globalAlpha = 1;
    if (gate) {
      context.fillStyle = "rgba(170, 175, 196, 0.055)";
      context.beginPath();
      context.arc(origin.x, origin.y, radius * scale, 0, 2 * Math.PI);
      context.fill();
    }
    context.globalAlpha = gate ? 1 : 0.55;
    strokeRing(context, origin, radius * scale, colour, gate ? 1.1 : 0.7);
    if (scene.flat) {
      context.globalAlpha = 1;
      return;
    }
    // Three great circles make a sphere legible without opaque geometry.
    context.globalAlpha = gate ? 0.5 : 0.16;
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      context.beginPath();
      for (let step = 0; step <= 96; step++) {
        const theta = step / 96 * 2 * Math.PI;
        const code: [number, number, number] = [0, 0, 0];
        code[a] = radius * Math.cos(theta);
        code[b] = radius * Math.sin(theta);
        const at = project(code);
        if (step === 0) context.moveTo(at.x, at.y);
        else context.lineTo(at.x, at.y);
      }
      context.strokeStyle = colour;
      context.stroke();
    }
    context.globalAlpha = 1;
  }
}

/**
 * The plain dots with Canvas 2D: 3-pixel squares, which read as round and draw quickly.
 * The fallback where WebGL2 is missing (cloud-dots-webgl.ts draws the same squares).
 */
export function drawPlainDots(context: CanvasRenderingContext2D, view: View, scene: Pick<CloudScene, "positions" | "colours">, order: Uint32Array, alpha: number): void {
  const { width, height } = view;
  const side = DOT_STYLE.plainSide;
  context.globalAlpha = alpha;
  // Setting a fill style parses its colour, so it is set only when it changes.
  let fill = "";
  for (const index of order) {
    const at = scene.positions[index];
    // Zoomed in, most dots lie outside the view; they are not drawn.
    if (at.x < -4 || at.x > width + 4 || at.y < -4 || at.y > height + 4) continue;
    if (scene.colours[index] !== fill) context.fillStyle = fill = scene.colours[index];
    context.fillRect(at.x - side / 2, at.y - side / 2, side, side);
  }
  context.globalAlpha = 1;
}

/** The selected dots with Canvas 2D: the fallback for the WebGL pass. */
export function drawSelectedDots(context: CanvasRenderingContext2D, scene: Pick<CloudScene, "positions" | "accent">, order: Uint32Array): void {
  const radius = DOT_STYLE.selectedRadius;
  context.globalAlpha = DOT_STYLE.alpha;
  context.fillStyle = scene.accent;
  for (const index of order) {
    const at = scene.positions[index];
    context.beginPath();
    context.arc(at.x, at.y, radius, 0, 2 * Math.PI);
    context.fill();
  }
  context.globalAlpha = 1;
}

/**
 * What lies over the dots: your picture's dots with white rings in draw order, the
 * wand's starts, the lift, the anchor, the orientation key and the lasso being drawn.
 */
export function drawCloudMarks(context: CanvasRenderingContext2D, view: View, scene: CloudScene, order: Uint32Array): void {
  const { height } = view;
  if (scene.highlighted.size > 0) {
    for (const index of order) {
      if (!scene.highlighted.has(index)) continue;
      const at = scene.positions[index];
      context.globalAlpha = DOT_STYLE.alpha;
      context.fillStyle = scene.selected.has(index) ? scene.accent : scene.colours[index];
      context.beginPath();
      context.arc(at.x, at.y, DOT_STYLE.selectedRadius, 0, 2 * Math.PI);
      context.fill();
      strokeRing(context, at, 4, "#fff", 1);
    }
  }
  context.globalAlpha = 1;
  for (const index of scene.seeds) strokeRing(context, scene.positions[index], 7, scene.accent, 2);
  if (scene.lift) drawLift(scene.positions[scene.lift.from], scene.positions[scene.lift.to]);
  if (scene.anchor !== null) {
    const at = scene.positions[scene.anchor];
    strokeRing(context, at, 9, scene.colours[scene.anchor], 2);
    strokeRing(context, at, 12, scene.colours[scene.anchor], 1);
  }

  // The small orientation key remains readable when the cloud is edge-on.
  context.font = "11px 'Paper Mono', monospace";
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.lineWidth = 1;
  for (const direction of axisDirections(view.orbit)) {
    const start = { x: 44, y: height - 44 };
    const end = { x: start.x + direction.dx * 25, y: start.y + direction.dy * 25 };
    context.strokeStyle = ["#d398aa", "#c3bd8b", "#91b9d1"][direction.axis];
    context.fillStyle = context.strokeStyle;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.fillText(LOOK_TEXT.axes[direction.axis], start.x + direction.dx * 39 - 8, start.y + direction.dy * 39);
  }

  if (scene.lasso.length > 1) {
    context.beginPath();
    scene.lasso.forEach((at, index) => index === 0 ? context.moveTo(at.x, at.y) : context.lineTo(at.x, at.y));
    context.closePath();
    context.fillStyle = scene.accent;
    context.globalAlpha = 0.1;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = scene.accent;
    context.lineWidth = 1.5;
    context.stroke();
  }

  function drawLift(from: ScreenPoint, to: ScreenPoint) {
    context.strokeStyle = "#fff";
    context.fillStyle = "#fff";
    context.lineWidth = 1.5;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.setLineDash([]);
    const head = arrowHead(from, to, 8);
    if (!head) return;
    context.beginPath();
    head.forEach((at, index) => index === 0 ? context.moveTo(at.x, at.y) : context.lineTo(at.x, at.y));
    context.closePath();
    context.fill();
  }
}

function strokeRing(context: CanvasRenderingContext2D, at: { x: number; y: number }, radius: number, colour: string, lineWidth: number) {
  context.beginPath();
  context.strokeStyle = colour;
  context.lineWidth = lineWidth;
  context.arc(at.x, at.y, radius, 0, 2 * Math.PI);
  context.stroke();
}

/** The hovered dot's ring, drawn over a copy of the cloud layer so a hover never redraws every dot. */
export function drawHoverRing(context: CanvasRenderingContext2D, at: { x: number; y: number }): void {
  context.beginPath();
  context.strokeStyle = "#fff";
  context.lineWidth = 1.5;
  context.arc(at.x, at.y, 6, 0, 2 * Math.PI);
  context.stroke();
}
