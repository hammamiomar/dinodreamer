import { axisDirections, FIT_MARGIN, orbitBy, viewScale, type Orbit, type Vec3, type View } from "../../ui/code-space/projection";

// The block page's camera. An orthographic view looks at a centre in the principal
// frame and turns about it; zoom 1 shows a sphere of radius `extent` around the
// centre. Panning, zooming toward the pointer and framing a band move the centre.
// No DOM here, so every gesture is tested without a canvas.

export type PrincipalPlane = "12" | "13" | "23";
type Position = { x: number; y: number };

export interface LookCamera {
  orbit: Orbit;
  /** The code the view turns about and shows at the middle of the frame, in principal-frame code units. */
  center: Vec3;
}

/** What the camera draws into: the cloud's radius in code units and the view's size in CSS pixels. */
export interface CameraFrame {
  extent: number;
  width: number;
  height: number;
}

export const LOOK_ORBIT: Orbit = { yaw: -0.48, pitch: 0.3, zoom: 1 };
export const LOOK_CAMERA: LookCamera = { orbit: LOOK_ORBIT, center: [0, 0, 0] };
/**
 * Zoom 1 shows the whole cloud. A Strongest tip can be a few per cent of it, so the
 * block page zooms further than the shared code-space view, whose limit is 8.
 */
export const LOOK_ZOOM_LIMITS = { min: 0.5, max: 64 } as const;

export function cameraView(camera: LookCamera, frame: CameraFrame): View {
  return { fit: { center: camera.center, radius: frame.extent }, orbit: camera.orbit, width: frame.width, height: frame.height };
}

export function planeOrbit(plane: PrincipalPlane, zoom: number): Orbit {
  if (plane === "13") return { yaw: 0, pitch: Math.PI / 2, zoom };
  if (plane === "23") return { yaw: -Math.PI / 2, pitch: 0, zoom };
  return { yaw: 0, pitch: 0, zoom };
}

/** Looking flat keeps the centre and the zoom, so what is framed stays in view. */
export function flattenTo(camera: LookCamera, plane: PrincipalPlane): LookCamera {
  return { ...camera, orbit: planeOrbit(plane, camera.orbit.zoom) };
}

/** A drag of (dx, dy) pixels turns the view about its centre. */
export function turnBy(camera: LookCamera, dx: number, dy: number): LookCamera {
  return { ...camera, orbit: orbitBy(camera.orbit, dx, dy) };
}

/** The screen's right, up and toward-the-viewer directions, in code coordinates. */
function screenAxes(orbit: Orbit): { right: Vec3; up: Vec3; toward: Vec3 } {
  const directions = axisDirections(orbit);
  const along = (component: (direction: (typeof directions)[number]) => number): Vec3 =>
    [component(directions[0]), component(directions[1]), component(directions[2])];
  return { right: along((direction) => direction.dx), up: along((direction) => -direction.dy), toward: along((direction) => direction.depth) };
}

/** start + Σ length × direction. */
function step(start: Vec3, ...moves: [Vec3, number][]): Vec3 {
  const result: [number, number, number] = [start[0], start[1], start[2]];
  for (const [direction, length] of moves) {
    for (let axis = 0; axis < 3; axis++) result[axis] += direction[axis] * length;
  }
  return result;
}

/** The code under a screen position, on the plane through the centre that faces the viewer. */
export function codeAt(camera: LookCamera, frame: CameraFrame, at: Position): Vec3 {
  const scale = viewScale(cameraView(camera, frame));
  const { right, up } = screenAxes(camera.orbit);
  return step(camera.center, [right, (at.x - frame.width / 2) / scale], [up, (frame.height / 2 - at.y) / scale]);
}

const clampZoom = (zoom: number) => Math.max(LOOK_ZOOM_LIMITS.min, Math.min(LOOK_ZOOM_LIMITS.max, zoom));

/**
 * Zooms by `factor` and keeps the code under `at` at the same pixel. The limits clamp
 * the zoom; at a limit the camera is returned unchanged.
 */
export function zoomAt(camera: LookCamera, frame: CameraFrame, at: Position, factor: number): LookCamera {
  const zoom = clampZoom(camera.orbit.zoom * factor);
  if (zoom === camera.orbit.zoom) return camera;
  const fixed = codeAt(camera, frame, at);
  // The fixed code keeps its pixel when its offset from the centre shrinks as the scale grows.
  const keep = camera.orbit.zoom / zoom;
  const toCenter: Vec3 = [camera.center[0] - fixed[0], camera.center[1] - fixed[1], camera.center[2] - fixed[2]];
  return { orbit: { ...camera.orbit, zoom }, center: step(fixed, [toCenter, keep]) };
}

/** The cloud follows a drag of (dx, dy) pixels. */
export function panBy(camera: LookCamera, frame: CameraFrame, dx: number, dy: number): LookCamera {
  return { ...camera, center: codeAt(camera, frame, { x: frame.width / 2 - dx, y: frame.height / 2 - dy }) };
}

/**
 * Two fingers moving from `before` to `after`: the cloud follows their midpoint,
 * and the zoom follows their spread, about the new midpoint.
 */
export function pinchBy(camera: LookCamera, frame: CameraFrame, before: readonly [Position, Position], after: readonly [Position, Position]): LookCamera {
  const middle = ([a, b]: readonly [Position, Position]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const spread = ([a, b]: readonly [Position, Position]) => Math.hypot(b.x - a.x, b.y - a.y);
  const from = middle(before);
  const to = middle(after);
  const moved = panBy(camera, frame, to.x - from.x, to.y - from.y);
  return spread(before) > 0 ? zoomAt(moved, frame, to, spread(after) / spread(before)) : moved;
}

/**
 * Frames codes in the current orientation: their box on the screen fills the view,
 * with the fit margin. The centre moves to the middle of the box, in depth too, so a
 * turn afterwards keeps them in view. No codes leave the camera unchanged.
 */
export function frameCodes(camera: LookCamera, frame: CameraFrame, codes: readonly Vec3[]): LookCamera {
  if (codes.length === 0) return camera;
  const { right, up, toward } = screenAxes(camera.orbit);
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const code of codes) {
    const along = [right, up, toward].map((direction) => code[0] * direction[0] + code[1] * direction[1] + code[2] * direction[2]);
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], along[axis]);
      high[axis] = Math.max(high[axis], along[axis]);
    }
  }
  const middle = (axis: number) => (low[axis] + high[axis]) / 2;
  const center = step([0, 0, 0], [right, middle(0)], [up, middle(1)], [toward, middle(2)]);
  // Pixels per code unit that fit the box, against the scale at zoom 1. A single code fits at the zoom limit.
  const fits = Math.min(frame.width / ((high[0] - low[0]) * FIT_MARGIN), frame.height / ((high[1] - low[1]) * FIT_MARGIN));
  const unit = viewScale(cameraView({ orbit: { ...camera.orbit, zoom: 1 }, center }, frame));
  return { orbit: { ...camera.orbit, zoom: clampZoom(fits / unit) }, center };
}

export type PressGesture = "turn" | "pan" | "lasso";

/**
 * What a one-pointer drag does. Shift or the middle button pans with either tool;
 * the lasso tool draws with a plain drag and turns with Alt or the right button;
 * the wand tool turns. A press that does not move is a click with either gesture.
 */
export function pressGesture(tool: "wand" | "lasso", press: { button: number; shiftKey: boolean; altKey: boolean }): PressGesture {
  if (press.button === 1 || press.shiftKey) return "pan";
  if (tool === "lasso" && press.button === 0 && !press.altKey) return "lasso";
  return "turn";
}
