import { describe, expect, it } from "vitest";
import { axisDirections, FIT_MARGIN, projector, type Vec3 } from "../../ui/code-space/projection";
import {
  cameraView, codeAt, flattenTo, frameCodes, LOOK_CAMERA, LOOK_ZOOM_LIMITS, panBy, pinchBy, planeOrbit, pressGesture, turnBy, zoomAt,
  type CameraFrame, type LookCamera,
} from "./look-camera";

const frame: CameraFrame = { extent: 20, width: 640, height: 480 };
// A turned, zoomed and moved camera, so no test passes only because of a zero.
const camera: LookCamera = { orbit: { yaw: -0.48, pitch: 0.3, zoom: 1.7 }, center: [3, -1, 2] };
const screen = (at: LookCamera) => projector(cameraView(at, frame));

function expectAt(point: { x: number; y: number }, at: { x: number; y: number }) {
  expect(point.x).toBeCloseTo(at.x, 9);
  expect(point.y).toBeCloseTo(at.y, 9);
}

it("each flattened principal plane ignores exactly its perpendicular coordinate", () => {
  for (const [plane, hidden] of [["12", 2], ["13", 1], ["23", 0]] as const) {
    const first: Vec3 = [1, 2, 3];
    const second: [number, number, number] = [...first];
    second[hidden] += 10;
    const project = screen({ orbit: planeOrbit(plane, 1), center: [0, 0, 0] });
    const [a, b] = [project(first), project(second)];
    expectAt(a, b);
    expect(Math.abs(a.depth - b.depth)).toBeCloseTo(10, 10);
  }
});

it("finds the code under a pixel on the plane through the centre", () => {
  for (const at of [{ x: 0, y: 0 }, { x: 320, y: 240 }, { x: 611, y: 37 }]) {
    const projected = screen(camera)(codeAt(camera, frame, at));
    expectAt(projected, at);
    expect(projected.depth).toBeCloseTo(0, 9);
  }
  expect(codeAt(camera, frame, { x: 320, y: 240 })).toEqual(camera.center);
});

describe("zooming toward the pointer", () => {
  const pointer = { x: 530, y: 120 };

  it("keeps the code under the pointer at the pointer, at any depth", () => {
    const under = codeAt(camera, frame, pointer);
    // Five code units farther from the viewer, on the same line of sight.
    const toward = axisDirections(camera.orbit).map((direction) => direction.depth);
    const behind: Vec3 = [under[0] - 5 * toward[0], under[1] - 5 * toward[1], under[2] - 5 * toward[2]];
    const zoomed = zoomAt(camera, frame, pointer, 2.5);
    expect(zoomed.orbit).toEqual({ ...camera.orbit, zoom: 1.7 * 2.5 });
    expectAt(screen(zoomed)(under), pointer);
    expectAt(screen(zoomed)(behind), pointer);
  });

  it("pushes other codes away from the pointer by the zoom factor", () => {
    const elsewhere: Vec3 = [-4, 6, 1];
    const before = screen(camera)(elsewhere);
    const after = screen(zoomAt(camera, frame, pointer, 2))(elsewhere);
    expectAt(after, { x: pointer.x + 2 * (before.x - pointer.x), y: pointer.y + 2 * (before.y - pointer.y) });
  });

  it("stops at the limits and keeps the pointer's code there", () => {
    const near: LookCamera = { ...camera, orbit: { ...camera.orbit, zoom: 60 } };
    const clamped = zoomAt(near, frame, pointer, 2);
    expect(clamped.orbit.zoom).toBe(LOOK_ZOOM_LIMITS.max);
    expectAt(screen(clamped)(codeAt(near, frame, pointer)), pointer);
    expect(zoomAt(clamped, frame, pointer, 2)).toBe(clamped);
    expect(zoomAt(camera, frame, pointer, 1e-3).orbit.zoom).toBe(LOOK_ZOOM_LIMITS.min);
  });

  it("zooms about the centre when the pointer is the middle of the view", () => {
    expect(zoomAt(camera, frame, { x: 320, y: 240 }, 3).center).toEqual(camera.center);
  });
});

it("pans: every code follows the drag, and the zoom and orientation stay", () => {
  const codes: Vec3[] = [[0, 0, 0], [12, -3, 7], [-5, 9, -2]];
  const moved = panBy(camera, frame, 37, -21);
  expect(moved.orbit).toBe(camera.orbit);
  for (const code of codes) {
    const before = screen(camera)(code);
    const after = screen(moved)(code);
    expectAt(after, { x: before.x + 37, y: before.y - 21 });
  }
});

describe("pinching with two fingers", () => {
  const before = [{ x: 200, y: 200 }, { x: 300, y: 260 }] as const;

  it("zooms by the change in spread about the midpoint", () => {
    const middle = { x: 250, y: 230 };
    const spread = [{ x: 150, y: 170 }, { x: 350, y: 290 }] as const;
    const under = codeAt(camera, frame, middle);
    const pinched = pinchBy(camera, frame, before, spread);
    expect(pinched.orbit.zoom).toBeCloseTo(camera.orbit.zoom * 2, 9);
    expectAt(screen(pinched)(under), middle);
  });

  it("pans when both fingers move together", () => {
    const pinched = pinchBy(camera, frame, before, [{ x: 230, y: 190 }, { x: 330, y: 250 }]);
    expect(pinched.orbit.zoom).toBeCloseTo(camera.orbit.zoom, 9);
    expectAt(screen(pinched)(codeAt(camera, frame, { x: 250, y: 230 })), { x: 280, y: 220 });
  });

  it("carries the code under the old midpoint to the new one while zooming", () => {
    const under = codeAt(camera, frame, { x: 250, y: 230 });
    const after = [{ x: 100, y: 330 }, { x: 260, y: 410 }] as const;
    expectAt(screen(pinchBy(camera, frame, before, after))(under), { x: 180, y: 370 });
  });
});

describe("framing a set of codes", () => {
  // A base around the ring and a tip far out along the first axis, as in a block's lobe.
  const base: Vec3[] = [[1, 2, 0], [-3, 1, 1], [2, -2, -1], [0, 0, 3]];
  const tip: Vec3[] = [[18, 1.5, -0.5], [19.5, -1, 0.5], [17, 0, 1], [20, 0.5, 0]];

  it("fills the view with the tip and leaves the base outside it", () => {
    const framed = frameCodes(LOOK_CAMERA, frame, tip);
    const project = screen(framed);
    expect(framed.orbit.zoom).toBeGreaterThan(4);
    const xs = tip.map((code) => project(code).x);
    const ys = tip.map((code) => project(code).y);
    // The box is centred and touches the margin on its tighter side.
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(320, 9);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(240, 9);
    const widthUsed = (Math.max(...xs) - Math.min(...xs)) / 640;
    const heightUsed = (Math.max(...ys) - Math.min(...ys)) / 480;
    expect(Math.max(widthUsed, heightUsed)).toBeCloseTo(1 / FIT_MARGIN, 9);
    for (const code of base) {
      const at = project(code);
      expect(at.x < 0 || at.x > 640 || at.y < 0 || at.y > 480).toBe(true);
    }
  });

  it("centres the box in depth too, so a turn keeps the codes near the middle", () => {
    const framed = frameCodes(LOOK_CAMERA, frame, tip);
    const depths = tip.map((code) => screen(framed)(code).depth);
    expect(Math.min(...depths) + Math.max(...depths)).toBeCloseTo(0, 9);
    const turned = screen(turnBy(framed, 120, 40));
    for (const code of tip) {
      const at = turned(code);
      expect(at.x > 0 && at.x < 640 && at.y > 0 && at.y < 480).toBe(true);
    }
  });

  it("keeps the camera for no codes and stops at the zoom limit for one", () => {
    expect(frameCodes(camera, frame, [])).toBe(camera);
    const single = frameCodes(camera, frame, [tip[0]]);
    expect(single.orbit.zoom).toBe(LOOK_ZOOM_LIMITS.max);
    expectAt(screen(single)(tip[0]), { x: 320, y: 240 });
  });
});

it("turns and flattens about the centre, keeping the zoom", () => {
  const middle = { x: 320, y: 240 };
  expectAt(screen(turnBy(camera, 80, -30))(camera.center), middle);
  const flat = flattenTo(camera, "13");
  expect(flat.center).toBe(camera.center);
  expect(flat.orbit).toEqual(planeOrbit("13", camera.orbit.zoom));
  expectAt(screen(flat)(camera.center), middle);
});

it("maps a press to its drag gesture", () => {
  const plain = { button: 0, shiftKey: false, altKey: false };
  expect(pressGesture("wand", plain)).toBe("turn");
  expect(pressGesture("lasso", plain)).toBe("lasso");
  expect(pressGesture("lasso", { ...plain, altKey: true })).toBe("turn");
  expect(pressGesture("lasso", { ...plain, button: 2 })).toBe("turn");
  for (const tool of ["wand", "lasso"] as const) {
    expect(pressGesture(tool, { ...plain, shiftKey: true })).toBe("pan");
    expect(pressGesture(tool, { ...plain, button: 1 })).toBe("pan");
  }
});
