import { describe, expect, test } from "vitest";
import { ringArcs, ringMark } from "./ring";

describe("the strength ring", () => {
  test("four arcs, Barely to Strongest, each a quarter of 270° on the same circle", () => {
    const arcs = ringArcs(22);
    expect(arcs).toHaveLength(4);
    for (const arc of arcs) expect(arc).toMatch(/^M [\d.]+ [\d.]+ A 22 22 0 0 1 [\d.]+ [\d.]+$/);
  });

  test("the mark starts at the lower left, ends at the lower right, and stays on the arc", () => {
    const start = ringMark(0, 22);
    expect(start.angleDeg).toBe(135);
    expect(start.x).toBeCloseTo(28 - 22 * Math.SQRT1_2, 9);
    expect(start.y).toBeCloseTo(28 + 22 * Math.SQRT1_2, 9);
    expect(ringMark(1, 22).angleDeg).toBe(405);
    expect(ringMark(0.5, 22).angleDeg).toBe(270);
    expect(ringMark(1.4, 22).angleDeg).toBe(405);
    expect(ringMark(-0.2, 22).angleDeg).toBe(135);
  });
});
