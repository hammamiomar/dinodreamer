import { describe, expect, it } from "vitest";
import { randomGroup } from "./random-group";

describe("a basis group at random", () => {
  it("covers the whole collection, 0 to 16,383, evenly", () => {
    expect(randomGroup(0)).toBe(0);
    expect(randomGroup(0.5)).toBe(8192);
    expect(randomGroup(0.99999999)).toBe(16383);
  });

  it("never draws the group on the page, and steps over it evenly", () => {
    expect(randomGroup(0, 0)).toBe(1);
    expect(randomGroup(0.99999999, 16383)).toBe(16382);
    expect(randomGroup(0, 4009)).toBe(0);
    expect(randomGroup(4009 / 16383, 4009)).toBe(4010);
    for (let random = 0; random < 1; random += 0.001) expect(randomGroup(random, 4009)).not.toBe(4009);
  });
});
