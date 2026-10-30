import { describe, expect, it } from "vitest";
import { compactCount, compactFigure, count } from "./text";

describe("figures", () => {
  it("writes a compact figure with a space before its magnitude", () => {
    expect(compactFigure(1_081_343)).toBe("1.1 M");
    expect(compactFigure(2_300)).toBe("2.3 K");
    expect(compactFigure(42)).toBe("42");
  });

  it("writes a figure with its unit", () => {
    expect(compactCount(1_081_343, "picture")).toBe("1.1 M pictures");
    expect(compactCount(1, "token")).toBe("1 token");
    expect(count(16384, "block")).toBe("16,384 blocks");
  });
});
