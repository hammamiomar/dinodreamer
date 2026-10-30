import { describe, expect, it } from "vitest";
import { emptyRows, type CloudRows } from "../../library/block-cloud";
import type { StrengthCuts } from "../../recipe";
import { anchorFollowingSelection, bandSelection, nearestInBand } from "./request-anchor";

// Ring 4, maximum 12: cuts at 6, 8 and 10.
const strength: StrengthCuts = { ring: 4, cuts: [6, 8, 10], maximum: 12 };

function rows(patches: { code: [number, number, number]; imageId: number; slot: number; publicPreview?: boolean }[]): CloudRows {
  const result = emptyRows(patches.length);
  patches.forEach((patch, index) => {
    result.codes.set(patch.code, 3 * index);
    result.norms[index] = Math.hypot(...patch.code);
    result.imageIds[index] = patch.imageId;
    result.slots[index] = patch.slot;
    result.publicPreview[index] = patch.publicPreview === false ? 0 : 1;
  });
  return result;
}

describe("the anchor that follows a selection", () => {
  const norms = [5, 11, 7, 11, 2];

  it("asks for the wand's first seed, the patch the person clicked", () => {
    expect(anchorFollowingSelection({ kind: "wand", seeds: [2, 1] }, [0, 1, 2, 3], norms)).toBe(2);
  });

  it("asks for the strongest patch of a lasso or of the picture's patches; equal norms keep the lower index", () => {
    expect(anchorFollowingSelection({ kind: "lasso", indices: [4, 3, 0, 1], passes: 2 }, [4, 3, 0, 1], norms)).toBe(1);
    expect(anchorFollowingSelection({ kind: "picture", indices: [4, 2] }, [4, 2], norms)).toBe(2);
  });

  it("has no anchor without a selection or with an empty intersection", () => {
    expect(anchorFollowingSelection({ kind: "none" }, [], norms)).toBeNull();
    expect(anchorFollowingSelection({ kind: "lasso", indices: [], passes: 2 }, [], norms)).toBeNull();
  });
});

describe("lifting a patch to another band", () => {
  const cloud = rows([
    { code: [11, 0, 0], imageId: 9, slot: 20 },                          // Strongest, along x
    { code: [10, 1, 0], imageId: 5, slot: 30 },                          // Strongest, 5.7° off x
    { code: [0, 11, 0], imageId: 4, slot: 40 },                          // Strongest, 90° off
    { code: [10.5, 0, 0], imageId: 3, slot: 50, publicPreview: false },  // Strongest, no picture
    { code: [7, 0, 0], imageId: 2, slot: 60 },                           // Weakly
  ]);

  it("keeps the direction: the Strongest patch with a picture nearest in angle", () => {
    const lift = nearestInBand(cloud, [5, 0.1, 0], 3, strength);
    expect(lift?.index).toBe(0);
    expect(lift?.degrees).toBeCloseTo(Math.atan2(0.1, 5) * 180 / Math.PI, 5);
    expect(nearestInBand(cloud, [1, 0.15, 0], 3, strength)?.index).toBe(1);
    expect(nearestInBand(cloud, [5, 0, 0], 1, strength)).toEqual({ index: 4, degrees: 0 });
  });

  it("breaks equal angles by image ID, then slot", () => {
    const tied = rows([
      { code: [11, 0, 0], imageId: 9, slot: 20 },
      { code: [11.5, 0, 0], imageId: 6, slot: 70 },
      { code: [10.5, 0, 0], imageId: 6, slot: 10 },
    ]);
    expect(nearestInBand(tied, [1, 0, 0], 3, strength)?.index).toBe(2);
  });

  it("finds nothing in an empty band or from a zero code", () => {
    expect(nearestInBand(cloud, [1, 0, 0], 2, strength)).toBeNull();
    expect(nearestInBand(cloud, [0, 0, 0], 3, strength)).toBeNull();
  });
});

it("selects every loaded patch of a band once, anchored nearest the lobe's direction", () => {
  // Page indices: one picture patch, three sample rows, two prefix rows (the last repeats a sample row).
  const sample = rows([
    { code: [11, 0, 0], imageId: 9, slot: 20 },
    { code: [10, 4, 0], imageId: 5, slot: 30 },
    { code: [7, 0, 0], imageId: 2, slot: 60 },
  ]);
  const bands = [3, 3, 3, 1, 3, 3] as const;
  const repeats = Uint8Array.from([0, 0, 0, 0, 0, 1]);
  const selection = bandSelection(bands, repeats, 1, 3, sample, [1, 0.5, 0], strength);
  expect(selection).toEqual({ kind: "band", band: 3, indices: [1, 2, 4], anchor: 2 });
  expect(anchorFollowingSelection(selection, [1, 2, 4], [0, 11, 10.8, 7, 12, 11])).toBe(2);
  expect(bandSelection(bands, repeats, 1, 2, sample, [1, 0, 0], strength)).toEqual({ kind: "band", band: 2, indices: [], anchor: null });
});
