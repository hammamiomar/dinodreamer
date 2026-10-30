import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeAtlasCloud } from "../../library/atlas-cloud";
import type { StrengthCuts } from "../../recipe";
import { bandIndex, bandMembers, lobePosition, sampleStrengthCuts, strengthCuts } from "./strength-bands";

// Ring 4, maximum 12: cuts at 6, 8 and 10.
const strength: StrengthCuts = { ring: 4, cuts: [6, 8, 10], maximum: 12 };

describe("the Atlas band rule", () => {
  it("puts inside-ring patches in Barely, a cut in its upper band and the far tail in Strongest", () => {
    const norms = [1, 4, 5.99, 6, 7.99, 8, 9.99, 10, 12, 30];
    expect(norms.map((norm) => bandIndex(norm, strength))).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 3]);
  });

  it("keeps every patch Barely when the sample never passes the ring", () => {
    const flat: StrengthCuts = { ring: 5, cuts: [5, 5, 5], maximum: 4.5 };
    expect([1, 5, 9].map((norm) => bandIndex(norm, flat))).toEqual([0, 0, 0]);
  });

  it("reads the cuts that the Python producer stored for block 12182", () => {
    const bytes = readFileSync(new URL("../../../fixtures/atlas-clouds/block-12182.bin", import.meta.url));
    const record = decodeAtlasCloud(Uint8Array.from(bytes).buffer);
    const cuts = strengthCuts(record);
    expect(cuts.ring).toBeCloseTo(5.177, 3);
    expect(cuts.maximum).toBeCloseTo(23.204, 3);
    expect(bandIndex(cuts.cuts[2], cuts)).toBe(3);
    expect(bandIndex(Math.fround(cuts.cuts[2] - 1e-4), cuts)).toBe(2);
    expect(lobePosition(cuts.cuts[1], cuts)).toBeCloseTo(0.5, 5);
    // The page's own computation on the sample gives the stored cuts, to float32 precision.
    const fromSample = sampleStrengthCuts(record.ring, Float32Array.from([1, record.maximum, record.ring]));
    fromSample.cuts.forEach((cut, index) => expect(cut).toBeCloseTo(cuts.cuts[index], 4));
    expect(fromSample.maximum).toBe(record.maximum);
  });

  it("applies the producer's rule to a sample, including one that never passes the ring", () => {
    expect(sampleStrengthCuts(4, [3, 12, 7])).toEqual(strength);
    expect(sampleStrengthCuts(5, [1, 4.5])).toEqual({ ring: 5, cuts: [5, 5, 5], maximum: 4.5 });
  });
});

it("measures the position along the lobe from the ring to the sample maximum", () => {
  expect(lobePosition(4, strength)).toBe(0);
  expect(lobePosition(10, strength)).toBe(0.75);
  expect(lobePosition(2, strength)).toBe(-0.25);
  expect(lobePosition(14, strength)).toBe(1.25);
});

it("lists each band strongest first, keeps row order for ties and honours the filter", () => {
  const norms = Float32Array.from([5, 11, 7, 12, 11, 9, 1]);
  expect(bandMembers(norms, strength)).toEqual([[0, 6], [2], [5], [3, 1, 4]]);
  expect(bandMembers(norms, strength, (index) => index !== 3)).toEqual([[0, 6], [2], [5], [1, 4]]);
});
