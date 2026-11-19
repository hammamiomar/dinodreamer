import { describe, expect, it } from "vitest";
import { FIRING_MAX_ALPHA, FIRING_MIN_ALPHA, firingAlpha, firingScale, patchResponses } from "./responses";

describe("where a block fires", () => {
  it("tints nothing where the block does not fire, however strong the response", () => {
    expect(firingAlpha(50, false, 10)).toBe(0);
    expect(firingAlpha(0, true, 10)).toBe(0);
  });

  it("gives the picture's strongest firing token the maximum and a weak one the floor", () => {
    expect(firingAlpha(10, true, 10)).toBeCloseTo(FIRING_MAX_ALPHA, 12);
    expect(firingAlpha(1e-9, true, 10)).toBeCloseTo(FIRING_MIN_ALPHA, 4);
    // A quarter of the strongest is halfway up the range: the square root spreads the weaker tokens.
    expect(firingAlpha(2.5, true, 10)).toBeCloseTo((FIRING_MIN_ALPHA + FIRING_MAX_ALPHA) / 2, 12);
  });

  it("rises with the response among firing tokens", () => {
    const alphas = Array.from({ length: 101 }, (_, step) => firingAlpha(step / 10, true, 10));
    for (let step = 1; step < alphas.length; step += 1) expect(alphas[step]!).toBeGreaterThanOrEqual(alphas[step - 1]!);
  });

  it("draws nothing in a picture where the block fires nowhere", () => {
    expect(firingScale({ norm: [3, 4], gated: [false, false] })).toBe(0);
    expect(firingAlpha(4, true, 0)).toBe(0);
  });

  it("scales to the strongest firing token over every token set of the picture, ignoring stronger non-firing ones", () => {
    const patches = { norm: [9, 2, 5], gated: [false, true, true] };
    const prefix = { norm: [7, 1], gated: [true, false] };
    expect(firingScale(patches)).toBe(5);
    expect(firingScale(patches, prefix)).toBe(7);
  });
});

describe("patch responses", () => {
  it("keeps the 256 patch slots of a 261-slot set", () => {
    const all = { norm: Array.from({ length: 261 }, (_, slot) => slot), gated: Array.from({ length: 261 }, (_, slot) => slot === 5) };
    const patches = patchResponses(all);
    expect(patches.norm).toHaveLength(256);
    expect(patches.norm[0]).toBe(5);
    expect(patches.gated[0]).toBe(true);
  });
});
