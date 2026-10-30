import { describe, expect, it } from "vitest";
import { attentionShares, sharePercents } from "./dino-math";
import { PREFIX, TOKENS } from "./how-shapes";

describe("attention shares", () => {
  it("splits a row into the prefix, the 3 × 3 neighbourhood and the rest, summing to the row", () => {
    const row = new Float32Array(TOKENS).fill(1 / TOKENS);
    const shares = attentionShares(row, 17); // row 1, column 1: a full 3 × 3 around it
    expect(shares.prefix).toBeCloseTo(PREFIX / TOKENS, 6);
    expect(shares.inside).toBeCloseTo(9 / TOKENS, 6);
    expect(shares.outside).toBeCloseTo((256 - 9) / TOKENS, 6);
    expect(shares.inside + shares.outside + shares.prefix).toBeCloseTo(1, 6);
  });

  it("counts a corner patch's smaller neighbourhood", () => {
    const row = new Float32Array(TOKENS).fill(1 / TOKENS);
    expect(attentionShares(row, 0).inside).toBeCloseTo(4 / TOKENS, 6);
    expect(attentionShares(row, 255).inside).toBeCloseTo(4 / TOKENS, 6);
  });
});

describe("share percents", () => {
  it("rounds the three shares to whole percentages that add up to 100", () => {
    // Rounded alone these print 68, 15 and 18: 101 in all.
    expect(sharePercents({ outside: 0.676, inside: 0.148, prefix: 0.176 })).toEqual({ outside: 68, inside: 15, prefix: 17 });
  });

  it("reads the shares of a float row that does not sum to exactly one", () => {
    expect(sharePercents({ outside: 0.5, inside: 0.25, prefix: 0.2499 })).toEqual({ outside: 50, inside: 25, prefix: 25 });
  });
});
