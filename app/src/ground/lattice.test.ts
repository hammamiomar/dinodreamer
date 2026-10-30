import { describe, expect, test } from "vitest";
import { BEND_AT_END, bendFor, bendPoint, latticeLines, MODULE_PX, scrollProgress, type LatticeView } from "./lattice";

const WINDOW = { width: 1440, height: 900 };

/** Whether (x, y) lies on the polyline, within `tolerance` pixels of one of its segments. */
function onLine(points_P2: Float64Array, x: number, y: number, tolerance = 0.01): boolean {
  for (let index = 0; index + 3 < points_P2.length; index += 2) {
    const [x0, y0, x1, y1] = [points_P2[index], points_P2[index + 1], points_P2[index + 2], points_P2[index + 3]];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const along = ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (length * length);
    if (along < -1e-9 || along > 1 + 1e-9) continue;
    const across = Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / length;
    if (across <= tolerance) return true;
  }
  return false;
}

describe("the lattice's bend is a function of the scroll position", () => {
  test("progress is 0 on a page that does not scroll, 1 at the bottom, and held to [0, 1]", () => {
    expect(scrollProgress(0, 900, 900)).toBe(0);
    expect(scrollProgress(500, 1900, 900)).toBe(0.5);
    expect(scrollProgress(1000, 1900, 900)).toBe(1);
    expect(scrollProgress(-40, 1900, 900)).toBe(0);
    expect(scrollProgress(1200, 1900, 900)).toBe(1);
  });

  test("a reading page bends by BEND_AT_END · p; a flat page never bends", () => {
    expect(bendFor(0, true)).toBe(0);
    expect(bendFor(0.5, true)).toBeCloseTo(BEND_AT_END / 2, 12);
    expect(bendFor(1, false)).toBe(0);
  });

  test("the map is the identity at k = 0 and never moves the window's centre", () => {
    expect(bendPoint(100, 700, { ...WINDOW, bend: 0 })).toEqual([100, 700]);
    const [x, y] = bendPoint(720, 450, { ...WINDOW, bend: BEND_AT_END });
    expect(x).toBeCloseTo(720, 9);
    expect(y).toBeCloseTo(450, 9);
  });

  test("the map is conformal, so the cells stay square where they bend (Cauchy–Riemann)", () => {
    const view = { ...WINDOW, bend: BEND_AT_END };
    const step = 1e-3;
    for (const [x, y] of [[80, 60], [1300, 820], [400, 700]]) {
      const [x0, y0] = bendPoint(x, y, view);
      const [xRight, yRight] = bendPoint(x + step, y, view);
      const [xDown, yDown] = bendPoint(x, y + step, view);
      const dXdx = (xRight - x0) / step;
      const dYdx = (yRight - y0) / step;
      const dXdy = (xDown - x0) / step;
      const dYdy = (yDown - y0) / step;
      expect(dXdx).toBeCloseTo(dYdy, 4);
      expect(dXdy).toBeCloseTo(-dYdx, 4);
    }
  });
});

describe("the lattice's lines", () => {
  const flat: LatticeView = { ...WINDOW, scrollY: 1000, bend: 0 };

  test("flat, every module corner of the page in the window is a crossing of one line of each family", () => {
    const lines = latticeLines(flat);
    for (const [pageX, pageY] of [[64, 1024], [640, 1408], [1408, 1856]]) {
      const y = pageY - flat.scrollY;
      const through = lines.filter((line) => onLine(line.points_P2, pageX, y));
      expect(through).toHaveLength(2);
    }
  });

  test("every fourth line of a family is the bright one", () => {
    const lines = latticeLines(flat);
    const brightAt = (x: number, y: number) => lines.filter((line) => onLine(line.points_P2, x, y)).map((line) => line.bright);
    // The window's top edge is the page's y = 1000. There the family x − yPage = 64·n passes
    // x = 1000 + 64·n, and only its n = 0 and n = 4 lines are bright; the other family misses these points.
    expect(brightAt(1000, 0)).toEqual([true]);
    expect(brightAt(1000 + MODULE_PX, 0)).toEqual([false]);
    expect(brightAt(1000 + 4 * MODULE_PX, 0)).toEqual([true]);
  });

  test("bent, each line stays one polyline with vertices about 24 px apart in the window, and covers it", () => {
    const view: LatticeView = { ...WINDOW, scrollY: 1000, bend: BEND_AT_END };
    const lines = latticeLines(view);
    const inWindow = (x: number, y: number) => x >= 0 && x <= WINDOW.width && y >= 0 && y <= WINDOW.height;
    let longest = 0;
    let leftmost = Infinity;
    let rightmost = -Infinity;
    for (const line of lines) {
      for (let index = 0; index + 3 < line.points_P2.length; index += 2) {
        if (!inWindow(line.points_P2[index], line.points_P2[index + 1])) continue;
        longest = Math.max(longest, Math.hypot(line.points_P2[index + 2] - line.points_P2[index], line.points_P2[index + 3] - line.points_P2[index + 1]));
      }
      for (let index = 0; index < line.points_P2.length; index += 2) {
        leftmost = Math.min(leftmost, line.points_P2[index]);
        rightmost = Math.max(rightmost, line.points_P2[index]);
      }
    }
    // The bend stretches a segment by |1 + 2k·z|, at most about 1.41 in a 1440 × 900 window at k = 0.35.
    expect(longest).toBeLessThan(24 * 1.5);
    expect(leftmost).toBeLessThan(0);
    expect(rightmost).toBeGreaterThan(WINDOW.width);
  });
});
