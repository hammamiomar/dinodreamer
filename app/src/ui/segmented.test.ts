import { describe, expect, it } from "vitest";
import { segmentGroups, stepChoice } from "./segmented";

describe("segmented control", () => {
  const segments = [{}, { unavailable: true }, {}, { unavailable: true }];

  it("moves to the next available segment and skips unavailable ones", () => {
    expect(stepChoice(segments, 0, 1)).toBe(2);
    expect(stepChoice(segments, 2, -1)).toBe(0);
  });

  it("wraps at both ends", () => {
    expect(stepChoice(segments, 2, 1)).toBe(0);
    expect(stepChoice(segments, 0, -1)).toBe(2);
  });

  it("stays put when no other segment is available", () => {
    expect(stepChoice([{}, { unavailable: true }], 0, 1)).toBeNull();
    expect(stepChoice([{}], 0, -1)).toBeNull();
  });

  it("starts a group at each segment set apart, keeping every segment's index", () => {
    const orders = [{ value: "random" }, { value: "context" }, { value: "starred", apart: true }, { value: "in_use" }];
    expect(segmentGroups(orders).map((group) => [group.start, group.segments.map((segment) => segment.value)])).toEqual([
      [0, ["random", "context"]],
      [2, ["starred", "in_use"]],
    ]);
    const plain = [{ value: "a" }, { value: "b" }];
    expect(segmentGroups(plain)).toHaveLength(1);
  });
});
