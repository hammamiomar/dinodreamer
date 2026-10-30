import { describe, expect, it } from "vitest";
import { stepKeys, stepPoint } from "./point-steps";

describe("stepping through a map's points with the arrow keys", () => {
  it("starts at the first point going forward and at the last going back", () => {
    expect(stepPoint(null, 5, 1)).toBe(0);
    expect(stepPoint(null, 5, -1)).toBe(4);
  });

  it("moves one point at a time and wraps at both ends", () => {
    expect(stepPoint(2, 5, 1)).toBe(3);
    expect(stepPoint(4, 5, 1)).toBe(0);
    expect(stepPoint(0, 5, -1)).toBe(4);
  });

  it("has nothing to step to in an empty map", () => {
    expect(stepPoint(null, 0, 1)).toBeNull();
    expect(stepPoint(3, 0, -1)).toBeNull();
  });

  it("names the keys a stepped point answers to: Enter chooses, Space moves a draggable ring", () => {
    expect(stepKeys(true, false)).toBe("Enter chooses it.");
    expect(stepKeys(true, true)).toBe("Enter chooses it; Space moves the ring to it.");
    expect(stepKeys(false, true)).toBe("Space moves the ring to it.");
  });
});
