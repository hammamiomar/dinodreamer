import { describe, expect, it } from "vitest";
import { strokeStamps } from "./live-brush";

describe("the live brush", () => {
  it("stamps every quarter radius along a movement, never at its start", () => {
    expect(strokeStamps(10, 10, 10, 10, 12)).toEqual([]);
    expect(strokeStamps(0, 0, 6, 0, 12)).toEqual([[3, 0, 12], [6, 0, 12]]);
    expect(strokeStamps(0, 0, 0, 2.5, 2)).toEqual([[0, 0.8333333333333334, 2], [0, 1.6666666666666667, 2], [0, 2.5, 2]]);
  });
});
