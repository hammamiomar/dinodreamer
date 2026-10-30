import { describe, expect, it } from "vitest";
import { easeOutCubic, MOVE_MS, valuesAt } from "./tween";

describe("easeOutCubic", () => {
  it("leaves at 0 and arrives at 1, past halfway at half time", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 12);
  });

  it("holds its ends outside 0 to 1", () => {
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("only rises", () => {
    let last = -Infinity;
    for (let step = 0; step <= 20; step += 1) {
      const value = easeOutCubic(step / 20);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });
});

describe("valuesAt", () => {
  const from = [-0.14, 0.13, 0.92];
  const to = [0.31, 0.19, 0.4];

  it("starts at the old values and ends exactly at the new ones", () => {
    expect(valuesAt(from, to, 0)).toEqual(from);
    expect(valuesAt(from, to, MOVE_MS)).toBe(to);
    expect(valuesAt(from, to, MOVE_MS * 3)).toBe(to);
  });

  it("is at the eased fraction of each value's way in between, signs included", () => {
    const half = valuesAt(from, to, MOVE_MS / 2);
    to.forEach((end, index) => expect(half[index]).toBeCloseTo(from[index]! + (end - from[index]!) * 0.875, 12));
    // The first value crosses zero on its way from −14 % to 31 %.
    expect(valuesAt(from, to, MOVE_MS * 0.1)[0]).toBeLessThan(0);
    expect(half[0]).toBeGreaterThan(0);
  });

  it("holds the start before its first frame, and takes another duration", () => {
    expect(valuesAt(from, to, -16)).toEqual(from);
    expect(valuesAt([0], [10], 100, 200)[0]).toBeCloseTo(8.75, 12);
  });
});
