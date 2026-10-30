import { describe, expect, it } from "vitest";
import { PREFIX, TOKENS, WIDTH } from "../how-shapes";
import { principalColours, principalScores } from "./token-colours";

/** A picture whose patches come in three families along three planted directions, plus small noise. */
function plantedTokens(): Float32Array {
  const tokens = new Float32Array(TOKENS * WIDTH);
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  for (let patch = 0; patch < 256; patch++) {
    const family = patch % 3;
    const at = (PREFIX + patch) * WIDTH;
    for (let channel = 0; channel < WIDTH; channel++) {
      // Families of unequal weight, so the three components come in a definite order.
      const planted = channel === family * 10 ? 30 - 8 * family + random() : 0;
      tokens[at + channel] = planted + 0.1 * random();
    }
  }
  return tokens;
}

describe("the principal colours of a picture's patches", () => {
  it("finds orthogonal components whose scores separate planted families", () => {
    const scores = principalScores(plantedTokens());
    const dot = (a: number, b: number) => {
      let sum = 0;
      for (let patch = 0; patch < 256; patch++) sum += scores[patch * 3 + a]! * scores[patch * 3 + b]!;
      return sum;
    };
    const norm = (a: number) => Math.sqrt(dot(a, a));
    expect(Math.abs(dot(0, 1)) / (norm(0) * norm(1))).toBeLessThan(1e-3);
    expect(Math.abs(dot(0, 2)) / (norm(0) * norm(2))).toBeLessThan(1e-3);
    expect(norm(0)).toBeGreaterThanOrEqual(norm(1));
    expect(norm(1)).toBeGreaterThanOrEqual(norm(2));
    // Patches of one family land together: their spread within a component is far below the spread across families.
    const family = (f: number) => Array.from({ length: 256 }, (_, patch) => patch).filter((patch) => patch % 3 === f);
    const mean = (patches: number[], component: number) => patches.reduce((sum, patch) => sum + scores[patch * 3 + component]!, 0) / patches.length;
    const spread = (patches: number[], component: number) => Math.sqrt(patches.reduce((sum, patch) => sum + (scores[patch * 3 + component]! - mean(patches, component)) ** 2, 0) / patches.length);
    const gap = Math.abs(mean(family(0), 0) - mean(family(1), 0));
    expect(gap).toBeGreaterThan(5 * Math.max(spread(family(0), 0), spread(family(1), 0)));
  });

  it("gives every patch a colour, stretched to the byte range, the same on every run", () => {
    const tokens = plantedTokens();
    const colours = principalColours(tokens);
    expect(colours.length).toBe(768);
    for (let component = 0; component < 3; component++) {
      const channel = Array.from({ length: 256 }, (_, patch) => colours[patch * 3 + component]!);
      expect(Math.min(...channel)).toBe(0);
      expect(Math.max(...channel)).toBe(255);
    }
    expect(Array.from(principalColours(tokens))).toEqual(Array.from(colours));
  });
});
