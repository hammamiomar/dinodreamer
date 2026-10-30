import { describe, expect, it } from "vitest";
import {
  ARROW_LABEL_MIN_PX,
  arrowHead,
  arrowLabelled,
  arrowNames,
  axisDirections,
  axisLines,
  chainCorners,
  chainOrbit,
  DEFAULT_ORBIT,
  depthOrder,
  edgeArrow,
  FIT_MARGIN,
  fitCodes,
  isClick,
  orbitBy,
  pickNearest,
  pickPoint,
  placeLabel,
  planar,
  projector,
  reachesDragMark,
  snapPoint,
  viewScale,
  ZOOM_LIMITS,
  zoomBy,
} from "./projection";
import type { Orbit, Vec3, View } from "./projection";

const CODES: Vec3[] = [
  [5.5, -4.2, 0],
  [0.9, -4.2, 2.8],
  [-0.6, 0.1, -4.5],
  [2.6, 0.3, -3.4],
  [3, 3, 3],
];

function view(orbit: Orbit = DEFAULT_ORBIT, width = 320, height = 320): View {
  return { fit: fitCodes(CODES), orbit, width, height };
}

describe("fit", () => {
  it("centres on the bounding box and encloses every code", () => {
    const fit = fitCodes(CODES);
    expect(fit.center).toEqual([(5.5 - 0.6) / 2, (-4.2 + 3) / 2, (-4.5 + 3) / 2]);
    for (const code of CODES) {
      expect(Math.hypot(code[0] - fit.center[0], code[1] - fit.center[1], code[2] - fit.center[2])).toBeLessThanOrEqual(fit.radius + 1e-12);
    }
  });

  it("is never degenerate", () => {
    expect(fitCodes([])).toEqual({ center: [0, 0, 0], radius: 1 });
    expect(fitCodes([[1, 2, 3]]).radius).toBeGreaterThan(0);
  });
});

describe("orbit projection", () => {
  it("puts the fit centre at the view centre for any orbit", () => {
    for (const orbit of [DEFAULT_ORBIT, { yaw: 2, pitch: -1.2, zoom: 3 }]) {
      const centre = projector(view(orbit, 400, 300))(fitCodes(CODES).center);
      expect(centre.x).toBeCloseTo(200, 9);
      expect(centre.y).toBeCloseTo(150, 9);
      expect(centre.depth).toBeCloseTo(0, 9);
    }
  });

  it("keeps every code inside the view at zoom 1, whatever the orbit", () => {
    for (const orbit of [DEFAULT_ORBIT, { yaw: 1.3, pitch: 0.9, zoom: 1 }, { yaw: -2.8, pitch: -1.5, zoom: 1 }]) {
      const project = projector(view(orbit));
      for (const code of CODES) {
        const point = project(code);
        expect(Math.hypot(point.x - 160, point.y - 160)).toBeLessThanOrEqual(160 / FIT_MARGIN + 1e-9);
      }
    }
  });

  it("only rotates: the distance from the centre is kept", () => {
    const current = view({ yaw: 0.7, pitch: -0.4, zoom: 2 });
    const scale = viewScale(current);
    const { center } = current.fit;
    const project = projector(current);
    for (const code of CODES) {
      const point = project(code);
      const onScreen = Math.hypot(point.x - 160, point.y - 160, point.depth * scale);
      expect(onScreen).toBeCloseTo(Math.hypot(code[0] - center[0], code[1] - center[1], code[2] - center[2]) * scale, 9);
    }
  });

  it("shows code value 1 to the right, 2 up and 3 toward the viewer without orbit", () => {
    const flat = view({ yaw: 0, pitch: 0, zoom: 1 });
    const project = projector(flat);
    const { center } = flat.fit;
    const right = project([center[0] + 1, center[1], center[2]]);
    const up = project([center[0], center[1] + 1, center[2]]);
    const toward = project([center[0], center[1], center[2] + 1]);
    expect(right.x).toBeGreaterThan(160);
    expect(up.y).toBeLessThan(160);
    expect(toward.depth).toBeCloseTo(1, 12);
    expect(toward.x).toBeCloseTo(160, 9);
  });

  it("returns to the same picture after a full turn", () => {
    const turned = projector(view({ ...DEFAULT_ORBIT, yaw: DEFAULT_ORBIT.yaw + 2 * Math.PI }))(CODES[0]!);
    const start = projector(view())(CODES[0]!);
    expect(turned.x).toBeCloseTo(start.x, 9);
    expect(turned.y).toBeCloseTo(start.y, 9);
  });

  it("scales with zoom about the centre", () => {
    const near = projector(view({ ...DEFAULT_ORBIT, zoom: 2 }))(CODES[0]!);
    const far = projector(view())(CODES[0]!);
    expect(near.x - 160).toBeCloseTo(2 * (far.x - 160), 9);
  });
});

describe("orbit controls", () => {
  it("turns with a drag and stops the tilt short of the poles", () => {
    const turned = orbitBy(DEFAULT_ORBIT, 100, 0);
    expect(turned.yaw).toBeCloseTo(DEFAULT_ORBIT.yaw + 1, 12);
    expect(orbitBy(DEFAULT_ORBIT, 0, 10_000).pitch).toBeLessThan(Math.PI / 2);
    expect(orbitBy(DEFAULT_ORBIT, 0, -10_000).pitch).toBeGreaterThan(-Math.PI / 2);
  });

  it("keeps zoom within its limits", () => {
    expect(zoomBy(DEFAULT_ORBIT, 100).zoom).toBe(ZOOM_LIMITS.max);
    expect(zoomBy(DEFAULT_ORBIT, 0.001).zoom).toBe(ZOOM_LIMITS.min);
  });
});

describe("drawing and picking", () => {
  it("draws far points first", () => {
    expect(depthOrder([{ depth: 1 }, { depth: -2 }, { depth: 0 }, { depth: -2 }])).toEqual([1, 3, 2, 0]);
  });

  it("picks the nearest point within 8 px, and nothing farther", () => {
    const points = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 100, y: 100 },
    ];
    expect(pickNearest(points, { x: 13, y: 10 })).toBe(1);
    expect(pickNearest(points, { x: 12, y: 10 })).toBe(0);
    expect(pickNearest(points, { x: 100, y: 108 })).toBe(2);
    expect(pickNearest(points, { x: 100, y: 108.5 })).toBeNull();
  });

  it("picks what a distance comparison picks, on a dense cloud with depth ties", () => {
    // 4,000 points on a 0.5 px grid with repeated depths, so equal distances and depth ties are common.
    const points = Array.from({ length: 4000 }, (_, index) => ({ x: (index % 80) * 0.5, y: Math.floor(index / 80) * 0.5, depth: index % 7 }));
    const reference = (pointer: { x: number; y: number }) => {
      let best: number | null = null;
      let bestDistance = Infinity;
      let bestDepth = -Infinity;
      points.forEach((point, index) => {
        const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
        if (distance > 8) return;
        if (distance < bestDistance || (distance === bestDistance && point.depth > bestDepth)) {
          [best, bestDistance, bestDepth] = [index, distance, point.depth];
        }
      });
      return best;
    };
    for (let step = 0; step < 300; step++) {
      const pointer = { x: (step * 7.3) % 52 - 6, y: (step * 3.1) % 37 - 6 };
      expect(pickNearest(points, pointer)).toBe(reference(pointer));
    }
  });

  it("picks the selected point anywhere inside its ring, even where another point is nearer", () => {
    const points = [
      { x: 10, y: 10 },
      { x: 15, y: 10 },
    ];
    // 4 px from the selected point and 1 px from the other.
    expect(pickNearest(points, { x: 14, y: 10 })).toBe(1);
    expect(pickPoint(points, { x: 14, y: 10 }, 0)).toBe(0);
    // Past the ring's edge, 7 px out, the nearest point wins again; with no selection it always does.
    expect(pickPoint(points, { x: 18, y: 10 }, 0)).toBe(1);
    expect(pickPoint(points, { x: 14, y: 10 }, -1)).toBe(1);
  });

  it("picks the point drawn on top when two share a projected centre", () => {
    const fit = fitCodes([[0, 0, -1], [0, 0, 1]]);
    const project = projector({ fit, orbit: { yaw: 0, pitch: 0, zoom: 1 }, width: 320, height: 320 });
    for (const codes of [[[0, 0, -1], [0, 0, 1]], [[0, 0, 1], [0, 0, -1]]] as Vec3[][]) {
      const points = codes.map(project);
      expect(points[0]!.x).toBeCloseTo(points[1]!.x, 9);
      expect(points[0]!.y).toBeCloseTo(points[1]!.y, 9);
      const front = codes.findIndex((code) => code[2] === 1);
      // depthOrder draws the front point last, so it is on top; the pick must agree.
      expect(depthOrder(points).at(-1)).toBe(front);
      expect(pickNearest(points, { x: points[0]!.x, y: points[0]!.y })).toBe(front);
    }
  });

  it("treats a press that barely moved as a click", () => {
    expect(isClick({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);
    expect(isClick({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
  });

  it("lifts the draggable ring from a press on it, from further away for a finger", () => {
    const ring = { x: 100, y: 100 };
    expect(reachesDragMark(ring, { x: 108, y: 106 }, false)).toBe(true);
    expect(reachesDragMark(ring, { x: 111, y: 100 }, false)).toBe(false);
    expect(reachesDragMark(ring, { x: 111, y: 100 }, true)).toBe(true);
    expect(reachesDragMark(ring, { x: 100, y: 122 }, true)).toBe(true);
    expect(reachesDragMark(ring, { x: 100, y: 123 }, true)).toBe(false);
  });

  it("snaps a dragged ring to the nearest point inside the view, at any distance, and to none outside it", () => {
    const points = [
      { x: 10, y: 10, depth: 0 },
      { x: 300, y: 300, depth: 0 },
      // Outside the 320 px view: never a place for the ring.
      { x: 330, y: 160, depth: 0 },
    ];
    expect(snapPoint(points, { x: 120, y: 120 }, 320, 320)).toBe(0);
    expect(snapPoint(points, { x: 200, y: 200 }, 320, 320)).toBe(1);
    expect(snapPoint(points, { x: 319, y: 160 }, 320, 320)).toBe(1);
    expect(snapPoint(points, { x: 321, y: 160 }, 320, 320)).toBeNull();
    expect(snapPoint([], { x: 160, y: 160 }, 320, 320)).toBeNull();
    // Two points at one place: the nearer the viewer, drawn on top, as a click picks.
    expect(snapPoint([{ x: 50, y: 50, depth: -1 }, { x: 50, y: 50, depth: 2 }], { x: 160, y: 160 }, 320, 320)).toBe(1);
  });

  it("draws the axes through the zero code across the whole view", () => {
    const current = view();
    const zero = projector(current)([0, 0, 0]);
    for (const line of axisLines(current)) {
      // The zero code lies on the segment between the two ends.
      const cross = (line.to.x - line.from.x) * (zero.y - line.from.y) - (line.to.y - line.from.y) * (zero.x - line.from.x);
      expect(Math.abs(cross)).toBeLessThan(1e-6 * Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y) ** 2 + 1e-6);
      // Unless the axis points at the viewer, both ends leave the view.
      const length = Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y);
      if (length > 1) expect(length).toBeGreaterThan(320);
    }
  });

  it("gives the orientation key's directions", () => {
    const [one, two, three] = axisDirections({ yaw: 0, pitch: 0, zoom: 1 });
    expect(one!.dx).toBeCloseTo(1, 12);
    expect(one!.dy).toBeCloseTo(0, 12);
    expect(two!.dx).toBeCloseTo(0, 12);
    expect(two!.dy).toBeCloseTo(-1, 12);
    expect(three!.depth).toBeCloseTo(1, 12);
  });
});

describe("flat axis-pair view", () => {
  it("uses one scale for both axes, matching the 3-D view at zoom 1", () => {
    const fit = fitCodes(CODES);
    const centre = planar(fit.center, [0, 2], fit, 320);
    expect(centre).toEqual({ x: 160, y: 160 });
    const offset = planar([fit.center[0] + 1, fit.center[1], fit.center[2] + 1], [0, 2], fit, 320);
    expect(offset.x - 160).toBeCloseTo(160 - offset.y, 12);
    expect(offset.x - 160).toBeCloseTo(viewScale({ fit, orbit: { yaw: 0, pitch: 0, zoom: 1 }, width: 320, height: 320 }), 12);
  });
});

describe("marks outside the view", () => {
  it("shows nothing for a mark inside the view", () => {
    expect(edgeArrow({ x: 100, y: 200 }, 320, 320, 10)).toBeNull();
  });

  it("places the arrow on the edge, toward the mark", () => {
    const right = edgeArrow({ x: 1000, y: 160 }, 320, 320, 10)!;
    expect(right).toEqual({ x: 310, y: 160, angle: 0 });
    const corner = edgeArrow({ x: -500, y: -500 }, 320, 320, 10)!;
    expect(corner.x).toBeCloseTo(10, 9);
    expect(corner.y).toBeCloseTo(10, 9);
    expect(corner.angle).toBeCloseTo((-3 * Math.PI) / 4, 9);
    const steep = edgeArrow({ x: 200, y: 1000 }, 320, 320, 10)!;
    expect(steep.y).toBeCloseTo(310, 9);
    expect(steep.x).toBeCloseTo(160 + 40 * (150 / 840), 9);
  });
});

describe("a chain of arrows", () => {
  it("starts at the origin and ends at the sum of its vectors, through each partial sum", () => {
    // Block 1836's strongest patch example: itself, near, far, prefix, constants.
    const vectors: Vec3[] = [
      [-2.37763834, 1.50906372, -2.11845374],
      [1.44944572, -0.655615926, 1.87691569],
      [7.11920834, -1.27047324, 7.72578669],
      [-0.0397685096, 0.240078777, -0.140557021],
      [1.37485099, -0.551056921, -0.180166453],
    ];
    const corners = chainCorners(vectors);
    expect(corners).toHaveLength(6);
    expect(corners[0]).toEqual([0, 0, 0]);
    expect(corners[1]).toEqual(vectors[0]);
    expect(corners[5]!.map((value) => Number(value.toFixed(2)))).toEqual([7.53, -0.73, 7.16]);
    expect(chainCorners([])).toEqual([[0, 0, 0]]);
  });

  it("faces the chain broadside: its end and its widest corner lie in the screen's plane", () => {
    const vectors: Vec3[] = [
      [-2.37763834, 1.50906372, -2.11845374],
      [1.44944572, -0.655615926, 1.87691569],
      [7.11920834, -1.27047324, 7.72578669],
      [-0.0397685096, 0.240078777, -0.140557021],
      [1.37485099, -0.551056921, -0.180166453],
    ];
    const orbit = chainOrbit(vectors);
    const project = projector({ fit: { center: [0, 0, 0], radius: 12 }, orbit, width: 400, height: 400 });
    const corners = chainCorners(vectors);
    const depths = corners.map((corner) => Math.abs(project(corner).depth));
    // The origin, the end and the corner that spans the plane have no depth; the others stay close to it.
    expect(depths[0]).toBeCloseTo(0, 9);
    expect(depths[5]).toBeLessThan(1e-9);
    expect(Math.max(...depths)).toBeLessThan(0.15 * Math.hypot(...corners[5]!));
    // A chain on one line, or no chain, keeps the starting view.
    expect(chainOrbit([[1, 2, 3], [2, 4, 6]])).toEqual(DEFAULT_ORBIT);
    expect(chainOrbit([])).toEqual(DEFAULT_ORBIT);
  });

  it("labels an arrow that is long enough on screen, or lit", () => {
    expect(arrowLabelled(ARROW_LABEL_MIN_PX, false)).toBe(true);
    expect(arrowLabelled(ARROW_LABEL_MIN_PX - 1, false)).toBe(false);
    expect(arrowLabelled(3, true)).toBe(true);
  });
});

describe("an arrow's head and name", () => {
  it("puts the head's tip at the arrow's end, its back corners one head-length behind and half as wide", () => {
    const head = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 6)!;
    expect(head[0]).toEqual({ x: 100, y: 0 });
    expect(head.slice(1).map((point) => [point.x, Math.abs(point.y)])).toEqual([
      [94, 3],
      [94, 3],
    ]);
    // Too short on screen to carry a head: the line alone.
    expect(arrowHead({ x: 0, y: 0 }, { x: 8, y: 0 }, 6)).toBeNull();
  });

  it("names the arrows long enough on screen, the longest first", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
      { x: 100, y: 60 },
    ];
    const names = arrowNames(corners, ["itself", "near", "far"], null);
    expect(names.map((name) => name.text)).toEqual(["itself", "far"]);
    expect(names[0]!.middle).toEqual({ x: 50, y: 0 });
  });

  it("names only the lit arrow while one is lit, however short", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
    ];
    expect(arrowNames(corners, ["itself", "near"], 1).map((name) => [name.text, name.lit])).toEqual([["near", true]]);
  });

  it("places a name on the other side of its arrow when the first side is taken, and inside the view's edges", () => {
    const name = { middle: { x: 100, y: 100 }, normal: { x: 0, y: -1 } };
    const first = placeLabel(name, 40, [], 320)!;
    expect(first.align).toBe("center");
    expect(first.bottom).toBeLessThanOrEqual(100);
    const second = placeLabel(name, 40, [first], 320)!;
    expect(second.top).toBeGreaterThanOrEqual(100);
    expect(placeLabel(name, 40, [first, second], 320)).toBeNull();
    // A name near the left edge slides back inside it.
    const edge = placeLabel({ middle: { x: 10, y: 100 }, normal: { x: -1, y: 0 } }, 60, [], 320)!;
    expect(edge.left).toBeGreaterThanOrEqual(4);
  });
});
