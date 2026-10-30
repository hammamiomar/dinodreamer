import { describe, expect, it } from "vitest";
import { patchSlot } from "../../../recipe";
import type { CodeMeasurement } from "../../../synthesis/protocol";
import { codeStats, matchMap, meanCode, type Code } from "./readout";

function measurement(slots: number[], codes: Code[], requested: Code): CodeMeasurement {
  const errors = codes.map((code) => code.reduce((sum, value, axis) => sum + (value - requested[axis]) ** 2, 0));
  return {
    requestId: 1,
    slots: new Uint16Array(slots),
    codes: new Float32Array(codes.flat()),
    errors: new Float32Array(errors),
  };
}

describe("codeStats", () => {
  it("separates distance from spread: a matching mean does not hide scattered tokens", () => {
    const requested: Code = [1, 0, 0];
    // Two tokens on opposite sides of the request: the mean matches exactly.
    const stats = codeStats(measurement([5, 6], [[1, 1, 0], [1, -1, 0]], requested), requested)!;
    expect(stats.mean).toEqual([1, 0, 0]);
    expect(stats.angleDegrees).toBeCloseTo(0, 6);
    expect(stats.distance).toBeCloseTo(1, 6);
    expect(stats.spread).toBeCloseTo(1, 6);
    expect(stats.count).toBe(2);
  });

  it("reports the angle and third-coordinate difference, and no angle without a direction", () => {
    const requested: Code = [1, 0, 0];
    const stats = codeStats(measurement([5], [[0, 1, 0.5]], requested), requested)!;
    expect(stats.angleDegrees).toBeCloseTo(90, 4);
    expect(stats.thirdDifference).toBeCloseTo(0.5, 6);
    expect(codeStats(measurement([5], [[0, 0, 0]], requested), requested)!.angleDegrees).toBeUndefined();
  });

  it("is undefined when nothing was measured", () => {
    expect(codeStats(measurement([], [], [1, 0, 0]), [1, 0, 0])).toBeUndefined();
    expect(meanCode(new Float32Array())).toBeUndefined();
  });
});

describe("matchMap", () => {
  it("normalizes each measured patch cell by the request's squared length", () => {
    const requested: Code = [2, 0, 0];
    const map = matchMap(measurement([patchSlot(0, 1), patchSlot(3, 3)], [[2, 0, 0], [0, 0, 0]], requested), requested);
    expect(map[1]).toBe(0);
    expect(map[3 * 16 + 3]).toBe(1);
    expect(map.filter((value) => value === null)).toHaveLength(254);
  });

  it("has no cells for a CLS or storage measurement", () => {
    const map = matchMap(measurement([0], [[1, 0, 0]], [1, 0, 0]), [1, 0, 0]);
    expect(map.every((value) => value === null)).toBe(true);
  });
});

describe("painted Code readouts", () => {
  it("weights the mean, RMS distance and spread by the applied field", () => {
    const requested: Code = [1, 0, 0];
    const field = new Array<number>(256).fill(0);
    field[0] = 100;
    field[1] = 50;
    const measured = measurement([5, 6], [[2, 0, 0], [3, 0, 0]], requested);
    const stats = codeStats(measured, requested, field)!;
    expect(stats.mean[0]).toBeCloseTo(7 / 3, 12);
    expect(stats.distance).toBeCloseTo(Math.sqrt(2), 12);
    expect(stats.spread).toBeCloseTo(Math.sqrt(2 / 9), 12);
    expect(codeStats(measured, requested, field.map((value) => value / 2))).toEqual(stats);
    const prefix = codeStats(measurement([2], [[2, 0, 0]], requested), requested, field)!;
    expect(prefix.distance).toBe(1);
  });
});
