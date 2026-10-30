import { describe, expect, it } from "vitest";
import { minimapFrame, plotPoint, zeroAxes } from "./minimap-frame";

describe("minimapFrame", () => {
  it("fits the points once with a margin, on the larger of the two axes", () => {
    const frame = minimapFrame([
      [-1, 0],
      [3, 1],
      [1, -2],
    ]);
    expect(frame.centreA).toBe(1);
    expect(frame.centreB).toBe(-0.5);
    expect(frame.span).toBeCloseTo(4 / 0.72, 9);
  });

  it("does not change when a measured code moves: the frame is the block's, not the measurement's", () => {
    const cloud: [number, number][] = [
      [0, 0],
      [2, 2],
    ];
    const far = minimapFrame([...cloud, [1, 1]]);
    const near = minimapFrame([...cloud, [1.5, 1.5]]);
    expect(near).toEqual(far);
  });
});

describe("plotPoint", () => {
  const frame = minimapFrame([
    [-1, -1],
    [1, 1],
  ]);
  const size = 64;

  it("maps the centre to the middle, with y growing upwards", () => {
    expect(plotPoint(frame, size, 0, 0)).toEqual({ x: 32, y: 32, outside: false, angle: 0 });
    expect(plotPoint(frame, size, 0, 1).y).toBeLessThan(32);
  });

  it("draws a zero axis only when its zero lies inside the frame", () => {
    expect(zeroAxes(frame, size)).toEqual({ x: 32, y: 32 });
    // A neighbourhood of positive codes: both zeros are outside, so no axis, not a cross at the border.
    const positive = minimapFrame([
      [10, 10],
      [12, 12],
    ]);
    expect(zeroAxes(positive, size)).toEqual({});
    // Coordinate 1 spans zero, coordinate 2 does not: one axis.
    const mixed = minimapFrame([
      [-1, 5],
      [1, 6],
    ]);
    const axes = zeroAxes(mixed, size);
    expect(axes.x).toBe(32);
    expect(axes.y).toBeUndefined();
  });

  it("puts a code outside the frame on the border, pointing toward it", () => {
    const right = plotPoint(frame, size, 10, 0);
    expect(right.outside).toBe(true);
    expect(right.x).toBeCloseTo(size - size * 0.06, 9);
    expect(right.y).toBe(32);
    expect(right.angle).toBeCloseTo(Math.PI / 2, 9);

    const up = plotPoint(frame, size, 0, 10);
    expect(up.y).toBeCloseTo(size * 0.06, 9);
    expect(up.angle).toBeCloseTo(0, 9);
  });
});
