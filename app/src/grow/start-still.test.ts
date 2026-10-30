import { describe, expect, it } from "vitest";
import { START_RADIUS } from "./material-kind";
import { centreDisc, startStill } from "./start-still";

describe("the start as a still", () => {
  it("keeps the engine's disc: 812 cells, rows and columns 48 to 79", () => {
    const disc = centreDisc(128, START_RADIUS);
    const kept = [...disc.keys()].filter((cell) => disc[cell] === 1);
    expect(kept).toHaveLength(812);
    const rows = kept.map((cell) => Math.floor(cell / 128));
    const columns = kept.map((cell) => cell % 128);
    expect([Math.min(...rows), Math.max(...rows), Math.min(...columns), Math.max(...columns)]).toEqual([48, 79, 48, 79]);
  });

  it("is mid grey outside the disc of a seeded start, and noise inside it", () => {
    const still = startStill({ rule: "cell", start: "centre-disc" });
    const pixel = (row: number, column: number) => [...still.subarray((row * 128 + column) * 4, (row * 128 + column) * 4 + 4)];
    expect(pixel(0, 0)).toEqual([128, 128, 128, 255]);
    expect(pixel(10, 100)).toEqual([128, 128, 128, 255]);
    const inside = Array.from({ length: 16 }, (_, offset) => pixel(56 + offset, 64)[0]);
    expect(new Set(inside).size).toBeGreaterThan(8);
  });

  it("is the same picture on every visit, and different for each rule", () => {
    const fine = startStill({ rule: "cell", start: "noise" });
    expect(startStill({ rule: "cell", start: "noise" })).toEqual(fine);
    expect(startStill({ rule: "pyramid", start: "noise" })).not.toEqual(fine);
  });
});
