// Pure geometry of a block's code space: where a 3-vector code appears on a 2-D
// view, and which point lies under the pointer. No DOM or React, so it runs in
// the node tests.
//
// World coordinates are the recorded codes themselves (code values 1, 2, 3 on
// x, y, z); nothing is fitted, whitened or embedded, so every axis keeps the same
// scale. The view is an orthographic camera that orbits the cloud's centre:
// `yaw` turns about the vertical axis, then `pitch` tilts toward the viewer.
// With yaw = pitch = 0, code value 1 points right, 2 points up and 3 toward the
// viewer, which is the axis pair (1, 2) of the flat view.

export type Vec3 = readonly [number, number, number];

export interface Fit {
  center: Vec3;
  /** Radius of the sphere around `center` that encloses every fitted code; never 0. */
  radius: number;
}

/** Room left around the enclosing sphere, as a factor of its radius. */
export const FIT_MARGIN = 1.15;
/** A point is under the pointer within this many CSS pixels. */
export const PICK_RADIUS_PX = 8;
/** A press that moves less than this is a click; more is an orbit drag. */
export const CLICK_TOLERANCE_PX = 4;
/** Orbit turn per CSS pixel of drag. */
export const ORBIT_RADIANS_PER_PX = 0.01;
/** Pitch stops short of straight up or down, where yaw would lose its meaning. */
const MAX_PITCH = Math.PI / 2 - 0.01;
export const ZOOM_LIMITS = { min: 0.5, max: 8 } as const;

/** Box centre and enclosing radius of the codes; a unit sphere at 0 for none. */
export function fitCodes(codes: readonly Vec3[]): Fit {
  if (codes.length === 0) return { center: [0, 0, 0], radius: 1 };
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const code of codes) {
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis]!, code[axis]!);
      high[axis] = Math.max(high[axis]!, code[axis]!);
    }
  }
  const center: Vec3 = [(low[0]! + high[0]!) / 2, (low[1]! + high[1]!) / 2, (low[2]! + high[2]!) / 2];
  let radius = 0;
  for (const code of codes) radius = Math.max(radius, Math.hypot(code[0] - center[0], code[1] - center[1], code[2] - center[2]));
  return { center, radius: Math.max(radius, 1e-6) };
}

export interface Orbit {
  /** Turn about the vertical axis, radians. */
  yaw: number;
  /** Tilt toward the viewer, radians, within ±(π/2 − 0.01). */
  pitch: number;
  /** 1 fits the enclosing sphere in the view. */
  zoom: number;
}

/**
 * The corners of a chain of vectors drawn tip to tail from the origin: the origin, then
 * each partial sum, so the last corner is their sum. The view fits all of them, so no
 * arrow of the chain leaves the frame.
 */
export function chainCorners(vectors: readonly Vec3[]): Vec3[] {
  const corners: Vec3[] = [[0, 0, 0]];
  for (const vector of vectors) {
    const last = corners[corners.length - 1]!;
    corners.push([last[0] + vector[0], last[1] + vector[1], last[2] + vector[2]]);
  }
  return corners;
}

/**
 * Face a chain broadside, along the normal through the origin, its end and the corner furthest
 * from their line. This reduces overlap for nearly planar chains. Collinear chains keep the
 * starting three-quarter view.
 */
export function chainOrbit(vectors: readonly Vec3[]): Orbit {
  const corners = chainCorners(vectors);
  const end = corners[corners.length - 1]!;
  const endLength = Math.hypot(...end);
  if (endLength === 0) return DEFAULT_ORBIT;
  const along: Vec3 = [end[0] / endLength, end[1] / endLength, end[2] / endLength];
  // The corner furthest from the line through the origin and the end, as its offset from that line.
  let offset: Vec3 = [0, 0, 0];
  for (const corner of corners) {
    const projection = corner[0] * along[0] + corner[1] * along[1] + corner[2] * along[2];
    const off: Vec3 = [corner[0] - projection * along[0], corner[1] - projection * along[1], corner[2] - projection * along[2]];
    if (Math.hypot(...off) > Math.hypot(...offset)) offset = off;
  }
  const normal: Vec3 = [
    along[1] * offset[2] - along[2] * offset[1],
    along[2] * offset[0] - along[0] * offset[2],
    along[0] * offset[1] - along[1] * offset[0],
  ];
  const normalLength = Math.hypot(...normal);
  if (normalLength < 1e-9 * endLength) return DEFAULT_ORBIT;
  // Seen from above the plane rather than below it, as the starting view is.
  const sign = normal[1] < 0 ? -1 : 1;
  const [x, y, z] = normal.map((value) => (sign * value) / normalLength) as [number, number, number];
  // rotate() brings this direction onto the camera's z axis: yaw zeroes its x, then pitch zeroes its y.
  const yaw = Math.atan2(-x, z);
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(y, Math.hypot(x, z))));
  return { yaw, pitch, zoom: 1 };
}

/** An arrow at least this long on screen carries its label; a shorter one only while it is lit. */
export const ARROW_LABEL_MIN_PX = 28;

/** Whether an arrow `length` px long on screen shows its label. */
export function arrowLabelled(length: number, lit: boolean): boolean {
  return lit || length >= ARROW_LABEL_MIN_PX;
}

/** An arrow's head: this long, half as wide. */
export const ARROW_HEAD_PX = 6;
/** How far a name sits from its arrow's middle, the height of its line, and how far it keeps inside the view's sides. */
export const ARROW_LABEL_OFFSET_PX = 8;
export const ARROW_LABEL_HEIGHT_PX = 12;
export const LABEL_EDGE_PX = 4;

/** An arrow's head as three points, the tip first; null for an arrow too short on screen to carry one. */
export function arrowHead(from: { x: number; y: number }, to: { x: number; y: number }, size = ARROW_HEAD_PX): { x: number; y: number }[] | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length <= size * 1.5) return null;
  const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const back = { x: to.x - along.x * size, y: to.y - along.y * size };
  const half = size / 2;
  return [
    { x: to.x, y: to.y },
    { x: back.x + along.y * half, y: back.y - along.x * half },
    { x: back.x - along.y * half, y: back.y + along.x * half },
  ];
}

/** One arrow's name, to place beside the middle of its arrow, on the side its normal points to first. */
export interface ArrowName {
  index: number;
  text: string;
  lit: boolean;
  /** The arrow's length on screen. */
  length: number;
  middle: { x: number; y: number };
  normal: { x: number; y: number };
}

/**
 * The names a chain of arrows shows, from its corners on screen (the origin first): an arrow
 * long enough on screen names itself, and the lit one always does; while one arrow is lit,
 * only its name shows. The longest come first, so a short arrow's name gives way.
 */
export function arrowNames(corners: readonly { x: number; y: number }[], labels: readonly string[], lit: number | null): ArrowName[] {
  const names: ArrowName[] = [];
  for (let index = 0; index + 1 < corners.length; index += 1) {
    const from = corners[index]!;
    const to = corners[index + 1]!;
    const isLit = lit === index;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!arrowLabelled(length, isLit) || (lit !== null && !isLit) || !labels[index]) continue;
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const normal = length > 0 ? { x: -(to.y - from.y) / length, y: (to.x - from.x) / length } : { x: 0, y: -1 };
    names.push({ index, text: labels[index]!, lit: isLit, length, middle, normal });
  }
  return names.sort((a, b) => b.length - a.length);
}

/** A placed name: its box on screen, and where and how its text is anchored inside it. */
export interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  anchor: { x: number; y: number };
  align: "left" | "right" | "center";
}

/**
 * A name `width` px wide beside its arrow's middle, on the side the arrow's normal points to,
 * or on the other side when that one overlaps a name already placed; null when both overlap.
 * A name that would cross the view's left or right edge slides back inside it.
 */
export function placeLabel(name: Pick<ArrowName, "middle" | "normal">, width: number, placed: readonly LabelBox[], viewWidth: number): LabelBox | null {
  const height = ARROW_LABEL_HEIGHT_PX;
  for (const side of [1, -1]) {
    const normal = { x: name.normal.x * side, y: name.normal.y * side };
    const anchor = { x: name.middle.x + normal.x * ARROW_LABEL_OFFSET_PX, y: name.middle.y + normal.y * ARROW_LABEL_OFFSET_PX };
    // The text grows away from the line: left-aligned when the normal points right, right-aligned when it points left.
    const align = Math.abs(normal.x) < 0.3 ? "center" : normal.x > 0 ? "left" : "right";
    const naturalLeft = align === "left" ? anchor.x : align === "right" ? anchor.x - width : anchor.x - width / 2;
    const left = Math.max(LABEL_EDGE_PX, Math.min(viewWidth - LABEL_EDGE_PX - width, naturalLeft));
    const top = anchor.y - height / 2 + (align === "center" ? normal.y * (height / 2) : 0);
    // The anchor moves with the box, so the text keeps its alignment inside the slid box.
    const anchorX = align === "left" ? left : align === "right" ? left + width : left + width / 2;
    const box: LabelBox = { left, top, right: left + width, bottom: top + height, anchor: { x: anchorX, y: top + height / 2 }, align };
    if (!placed.some((other) => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom)) return box;
  }
  return null;
}

/** A three-quarter view, so all three code directions show from the start. */
export const DEFAULT_ORBIT: Orbit = { yaw: -0.6, pitch: 0.35, zoom: 1 };

/** The orbit after a drag of (dx, dy) CSS pixels. */
export function orbitBy(orbit: Orbit, dx: number, dy: number): Orbit {
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, orbit.pitch + dy * ORBIT_RADIANS_PER_PX));
  return { ...orbit, yaw: orbit.yaw + dx * ORBIT_RADIANS_PER_PX, pitch };
}

export function zoomBy(orbit: Orbit, factor: number): Orbit {
  return { ...orbit, zoom: Math.max(ZOOM_LIMITS.min, Math.min(ZOOM_LIMITS.max, orbit.zoom * factor)) };
}

export interface ScreenPoint {
  /** CSS pixels from the view's top-left corner. */
  x: number;
  y: number;
  /** Code units toward the viewer from the fit centre; larger is nearer. */
  depth: number;
}

export interface View {
  fit: Fit;
  orbit: Orbit;
  /** CSS pixels. */
  width: number;
  height: number;
}

/** CSS pixels per code unit: zoom 1 fits the enclosing sphere, with its margin, in the shorter side. */
export function viewScale(view: View): number {
  return (Math.min(view.width, view.height) / (2 * view.fit.radius * FIT_MARGIN)) * view.orbit.zoom;
}

/** Rotates a code offset from the fit centre into camera axes: x right, y up, z toward the viewer. */
function rotate(orbit: Orbit, x: number, y: number, z: number): Vec3 {
  const cosYaw = Math.cos(orbit.yaw);
  const sinYaw = Math.sin(orbit.yaw);
  const cosPitch = Math.cos(orbit.pitch);
  const sinPitch = Math.sin(orbit.pitch);
  const turnedX = x * cosYaw + z * sinYaw;
  const turnedZ = -x * sinYaw + z * cosYaw;
  return [turnedX, y * cosPitch - turnedZ * sinPitch, y * sinPitch + turnedZ * cosPitch];
}

/** Returns the screen position of a code under this view. */
export function projector(view: View): (code: Vec3) => ScreenPoint {
  const scale = viewScale(view);
  const [cx, cy, cz] = view.fit.center;
  return (code) => {
    const [x, y, z] = rotate(view.orbit, code[0] - cx, code[1] - cy, code[2] - cz);
    return { x: view.width / 2 + x * scale, y: view.height / 2 - y * scale, depth: z };
  };
}

/** Indices in draw order: farthest first, so nearer points cover farther ones. Ties keep input order. */
export function depthOrder(points: readonly { depth: number }[]): number[] {
  return points.map((_, index) => index).sort((a, b) => points[a]!.depth - points[b]!.depth || a - b);
}

/**
 * The point nearest the pointer within `radius` CSS pixels, or null. Of points at
 * the same distance, the nearest to the viewer (largest depth) wins, because it is
 * drawn on top (depthOrder); then the lower index.
 */
export function pickNearest(
  points: readonly { x: number; y: number; depth?: number }[],
  pointer: { x: number; y: number },
  radius = PICK_RADIUS_PX,
  /** Only the points this accepts take part. */
  candidate: (point: { x: number; y: number }) => boolean = () => true,
): number | null {
  // Squared distances order the points as distances do, without a square root per point:
  // the Look cloud picks among up to 136,192 points on every pointer move.
  const reach = radius * radius;
  let best: number | null = null;
  let bestSquared = Infinity;
  let bestDepth = -Infinity;
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const dx = point.x - pointer.x;
    const dy = point.y - pointer.y;
    const squared = dx * dx + dy * dy;
    if (squared > reach || !candidate(point)) continue;
    const depth = point.depth ?? 0;
    if (squared < bestSquared || (squared === bestSquared && depth > bestDepth)) {
      best = index;
      bestSquared = squared;
      bestDepth = depth;
    }
  }
  return best;
}

/** The selected point's ring: its radius in CSS pixels; its 2 px stroke reaches 1 px past it. */
export const SELECTED_RING_PX = 6;

/**
 * The point under the pointer. The selected point's ring is drawn over every other
 * point, so anywhere inside the ring picks the selected point, even where another
 * point's centre is nearer; elsewhere the nearest point wins (pickNearest).
 */
export function pickPoint(
  points: readonly { x: number; y: number; depth?: number }[],
  pointer: { x: number; y: number },
  selected: number,
): number | null {
  const marked = points[selected];
  if (marked && Math.hypot(marked.x - pointer.x, marked.y - pointer.y) <= SELECTED_RING_PX + 1) return selected;
  return pickNearest(points, pointer);
}

export function isClick(down: { x: number; y: number }, up: { x: number; y: number }, tolerance = CLICK_TOLERANCE_PX): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) < tolerance;
}

/** A ring mark's radius in CSS pixels: the requested code's ring, and the ring a caller lets the visitor drag. */
export const RING_MARK_PX = 7;
/**
 * How near the draggable ring a press must start to lift it: the ring and its stroke with a
 * little room for a mouse or a pen; for a finger, a 44 px target.
 */
export const DRAG_MARK_REACH_PX = { fine: RING_MARK_PX + 3, finger: 22 } as const;

/** Whether a press at `pointer` starts on the draggable ring drawn at `mark`. */
export function reachesDragMark(mark: { x: number; y: number }, pointer: { x: number; y: number }, finger: boolean): boolean {
  const reach = finger ? DRAG_MARK_REACH_PX.finger : DRAG_MARK_REACH_PX.fine;
  return Math.hypot(pointer.x - mark.x, pointer.y - mark.y) <= reach;
}

/**
 * The point a dragged ring snaps to: of the points inside the view, the one nearest the pointer
 * at any distance (ties as pickNearest breaks them). Null while the pointer is outside the view,
 * where a release puts the ring back, or when no point is inside it.
 */
export function snapPoint(
  points: readonly { x: number; y: number; depth?: number }[],
  pointer: { x: number; y: number },
  width: number,
  height: number,
): number | null {
  const inside = (at: { x: number; y: number }) => at.x >= 0 && at.x <= width && at.y >= 0 && at.y <= height;
  if (!inside(pointer)) return null;
  return pickNearest(points, pointer, Infinity, inside);
}

/**
 * Where to show a mark that lies outside the view: the point on the view's edge,
 * `inset` pixels in, on the line from the view centre toward the mark, and the
 * direction toward it in radians (0 = right, y down). Null when the mark is inside.
 */
export function edgeArrow(point: { x: number; y: number }, width: number, height: number, inset: number): { x: number; y: number; angle: number } | null {
  const inside = point.x >= inset && point.x <= width - inset && point.y >= inset && point.y <= height - inset;
  if (inside) return null;
  const dx = point.x - width / 2;
  const dy = point.y - height / 2;
  // The largest step along (dx, dy) that stays inside the inset rectangle.
  const step = Math.min(dx === 0 ? Infinity : (width / 2 - inset) / Math.abs(dx), dy === 0 ? Infinity : (height / 2 - inset) / Math.abs(dy));
  return { x: width / 2 + dx * step, y: height / 2 + dy * step, angle: Math.atan2(dy, dx) };
}

/** One coordinate axis through the zero code, long enough to cross the whole view. */
export interface AxisLine {
  /** 0, 1 or 2: code value 1, 2 or 3. */
  axis: number;
  from: ScreenPoint;
  to: ScreenPoint;
}

export function axisLines(view: View): AxisLine[] {
  const project = projector(view);
  const halfDiagonal = Math.hypot(view.width, view.height) / 2 / viewScale(view);
  const reach = Math.hypot(...view.fit.center) + halfDiagonal;
  return [0, 1, 2].map((axis) => {
    const end = (sign: number): Vec3 => [axis === 0 ? sign * reach : 0, axis === 1 ? sign * reach : 0, axis === 2 ? sign * reach : 0];
    return { axis, from: project(end(-1)), to: project(end(1)) };
  });
}

/**
 * Screen direction of each positive code axis, for the orientation key in a corner:
 * dx right, dy down, unit length when the axis lies in the screen plane.
 */
export function axisDirections(orbit: Orbit): { axis: number; dx: number; dy: number; depth: number }[] {
  return [0, 1, 2].map((axis) => {
    const [x, y, z] = rotate(orbit, axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
    return { axis, dx: x, dy: -y, depth: z };
  });
}

/** The flat view's axis pairs, as code-value indices. */
export const AXIS_PAIRS = [
  [0, 1],
  [0, 2],
  [1, 2],
] as const;
export type AxisPair = (typeof AXIS_PAIRS)[number];

/** Position of a code on one axis pair in a square of `size` pixels, y up, at the 3-D view's zoom-1 scale. */
export function planar(code: Vec3, [horizontal, vertical]: AxisPair, fit: Fit, size: number): { x: number; y: number } {
  const scale = size / (2 * fit.radius * FIT_MARGIN);
  return {
    x: size / 2 + (code[horizontal] - fit.center[horizontal]) * scale,
    y: size / 2 - (code[vertical] - fit.center[vertical]) * scale,
  };
}
