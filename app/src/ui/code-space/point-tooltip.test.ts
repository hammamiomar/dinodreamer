import { describe, expect, it } from "vitest";
import { liftedPoint, tooltipPlace } from "./point-tooltip";

describe("where a point's tooltip opens", () => {
  it("opens on the roomier side of the point, inside the view", () => {
    expect(tooltipPlace({ x: 0.25, y: 0.25 }, false)).toEqual({ left: "calc(25.000% + 12px)", top: "calc(25.000% + 12px)" });
    expect(tooltipPlace({ x: 0.75, y: 0.8 }, false)).toEqual({ right: "calc(25.000% + 12px)", bottom: "calc(20.000% + 12px)" });
  });

  it("opens above a finger that drags a ring, clear of the fingertip, even near the view's top", () => {
    expect(tooltipPlace({ x: 0.25, y: 0.75 }, true)).toEqual({ left: "calc(25.000% + 12px)", bottom: "calc(25.000% + 40px)" });
    expect(tooltipPlace({ x: 0.9, y: 0.1 }, true)).toEqual({ right: "calc(10.000% + 12px)", bottom: "calc(90.000% + 40px)" });
  });
});

describe("the picture of the point a lifted ring sits on", () => {
  const points = [
    { key: "1:5", code: [0, 0, 0] as const, label: "Image 1 · patch (0, 5)" },
    { key: "2:9", code: [1, 1, 1] as const, label: "Image 2 · patch (0, 9)" },
  ];
  const places = [
    { x: 40, y: 200 },
    { x: 120, y: 60 },
  ];

  it("shows at that point for a mouse, and nothing while no ring is lifted or the pointer is outside the view", () => {
    expect(liftedPoint({ point: 1, finger: null }, points, places)).toEqual({ point: points[1], at: { x: 120, y: 60 }, finger: false });
    expect(liftedPoint(null, points, places)).toBeNull();
    expect(liftedPoint({ point: null, finger: { x: 10, y: 10 } }, points, places)).toBeNull();
  });

  it("opens from no lower than a finger that holds the ring, so the hand does not cover it", () => {
    expect(liftedPoint({ point: 0, finger: { x: 50, y: 180 } }, points, places)?.at).toEqual({ x: 40, y: 180 });
    expect(liftedPoint({ point: 0, finger: { x: 50, y: 230 } }, points, places)?.at).toEqual({ x: 40, y: 200 });
    expect(liftedPoint({ point: 0, finger: { x: 50, y: 230 } }, points, places)?.finger).toBe(true);
  });
});
