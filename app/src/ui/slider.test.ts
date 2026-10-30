import { describe, expect, test } from "vitest";
import { railFraction } from "./slider";

describe("the slider's marks", () => {
  test("a value sits along the rail from 0 at the minimum to 1 at the maximum", () => {
    expect(railFraction(0, 0, 5)).toBe(0);
    expect(railFraction(2, 0, 5)).toBe(0.4);
    expect(railFraction(32, 2, 32)).toBe(1);
  });

  test("outside the range or on an empty range it stays on the rail", () => {
    expect(railFraction(40, 2, 32)).toBe(1);
    expect(railFraction(-1, 0, 5)).toBe(0);
    expect(railFraction(3, 3, 3)).toBe(0);
  });
});
