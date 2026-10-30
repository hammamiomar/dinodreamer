import { describe, expect, it } from "vitest";
import { CELLS, type Recipe } from "../recipe";
import { createPaintedRequest, createRecipe } from "../features/editor/model";
import { cellPulls, intervalAppearanceLoss, paintedCodeLoss } from "./fake-objective";

function recipe(field: number[], code: [number, number, number] = [1, 0, 0]): Recipe {
  const where = new Array<number>(CELLS).fill(0);
  where.splice(0, field.length, ...field);
  return createPaintedRequest(createRecipe("fixture"), { token: { imageId: 7, role: "patch", slot: 5 }, block: 3, code }, where);
}

describe("painted fake objective", () => {
  it("weights raw Code by mass and peak while keeping per-slot errors unchanged", () => {
    const measured = { requestId: 1, slots: new Uint16Array([5, 6]), codes: new Float32Array(6), errors: new Float32Array([1, 4]) };
    expect(paintedCodeLoss(recipe([100, 50]).requests[0], measured)).toBeCloseTo(2, 12);
    expect(paintedCodeLoss(recipe([50, 25]).requests[0], measured)).toBeCloseTo(1, 12);
    expect(paintedCodeLoss(recipe([100, 100]).requests[0], measured)).toBeCloseTo(2.5, 12);
    expect(Array.from(measured.errors)).toEqual([1, 4]);
  });

  it("integrates the reference curve including its interval variance", () => {
    expect(intervalAppearanceLoss([2, 10], [100, 100], [[0, 4, 8, 12]])).toBeCloseTo(4, 12);
    expect(intervalAppearanceLoss([2, 10], [50, 50], [[0, 4, 8, 12]])).toBeCloseTo(2, 12);
  });

  it("uses unequal masses and equal reference-image weights", () => {
    expect(intervalAppearanceLoss([1, 2], [100, 50], [[0]])).toBeCloseTo(2, 12);
    expect(intervalAppearanceLoss([1, 2], [100, 100], [[0]])).toBeCloseTo(2.5, 12);
    // Equal image weights give Q = 1 despite the different window sizes.
    expect(intervalAppearanceLoss([0], [100], [[0], [2, 2, 2]])).toBeCloseTo(1, 12);
  });

  it("keeps tied-value loss independent of unequal mass order", () => {
    const a = intervalAppearanceLoss([3, 3, 8], [100, 20, 40], [[0, 4, 8, 12]]);
    const b = intervalAppearanceLoss([3, 3, 8], [20, 100, 40], [[0, 4, 8, 12]]);
    expect(a).toBeCloseTo(b, 12);
  });

  it("gives a faint added cell a vanishing contribution", () => {
    const full = intervalAppearanceLoss([2], [100], [[0, 4, 8, 12]]);
    const near = intervalAppearanceLoss([2, 100], [100, 0.000001], [[0, 4, 8, 12]]);
    expect(Math.abs(near - full)).toBeLessThan(0.0001);
  });

  it("mixes every overlapping Code field and scales motion with strength", () => {
    const first = recipe([100]);
    const second = recipe([25], [0, 1, 0]).requests[0];
    const combined = { ...first, requests: [...first.requests, { ...second, id: 2 }] };
    const result = cellPulls(combined);
    expect(result.pull_N[0]).toBeCloseTo(1.25, 12);
    expect(Array.from(result.colours_N3.slice(0, 3))).toEqual([0.86, 0.5900000000000001, 0.5]);
    const reversed = cellPulls({ ...combined, requests: [...combined.requests].reverse() });
    expect(reversed).toEqual(result);
    expect(cellPulls(recipe([50])).pull_N[0]).toBe(0.5);
    expect(cellPulls(recipe([50])).colours_N3).toEqual(cellPulls(first).colours_N3);
    expect(result.pull_N[1]).toBe(0);
  });
});
