import { describe, expect, it } from "vitest";
import { depthOrder } from "../../ui/code-space/projection";
import { DEPTH_BINS, drawOrder, plainDotAlpha, plainDotOrder, selectedDotOrder } from "./cloud-drawing";

const depths = (values: number[]) => values.map((depth) => ({ depth }));

describe("the cloud's draw order", () => {
  it("draws farthest first and keeps index order for equal depths, as depthOrder", () => {
    const points = depths([1, -2, 0, -2]);
    expect([...drawOrder(points)]).toEqual(depthOrder(points));
    expect([...drawOrder(points)]).toEqual([1, 3, 2, 0]);
  });

  it("agrees with depthOrder when depths are farther apart than one bin", () => {
    // 500 distinct depths in a shuffled order: index × 7,919 mod 500.
    const points = depths(Array.from({ length: 500 }, (_, index) => (index * 7919) % 500 - 250));
    expect([...drawOrder(points)]).toEqual(depthOrder(points));
  });

  it("keeps index order inside one bin", () => {
    // Depths 0 to 1: the middle three fall in bin 32,767, nearest first.
    const step = 1 / DEPTH_BINS / 8;
    expect([...drawOrder(depths([0, 0.5 + 2 * step, 0.5 + step, 0.5, 1]))]).toEqual([0, 1, 2, 3, 4]);
  });

  it("handles no points and a cloud at one depth", () => {
    expect([...drawOrder([])]).toEqual([]);
    expect([...drawOrder(depths([3, 3, 3]))]).toEqual([0, 1, 2]);
  });
});

describe("the plain dots", () => {
  it("leave out the selected dots and your picture's, keeping the draw order", () => {
    const order = Uint32Array.from([4, 0, 3, 1, 2]);
    expect([...plainDotOrder(order, new Set([3]), new Set([1]))]).toEqual([4, 0, 2]);
    expect(plainDotOrder(order, new Set(), new Set())).toBe(order);
  });

  it("give way to the selected dots, drawn over them in draw order; your picture's patches go with the marks", () => {
    const order = Uint32Array.from([4, 0, 3, 1, 2]);
    expect([...selectedDotOrder(order, new Set([2, 3, 1]), new Set([1]))]).toEqual([3, 2]);
    expect(selectedDotOrder(order, new Set(), new Set([1]))).toHaveLength(0);
  });

  it("fade behind a selection", () => {
    expect(plainDotAlpha(new Set())).toBe(0.82);
    expect(plainDotAlpha(new Set([1]))).toBe(0.18);
  });
});
