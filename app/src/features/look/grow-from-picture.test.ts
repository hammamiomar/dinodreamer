import { describe, expect, it } from "vitest";
import { emptyRows, type BlockCloud, type CloudRows } from "../../library/block-cloud";
import type { StrengthCuts } from "../../recipe";
import type { CloudToken } from "./cloud-token";
import { FIRING_BAND, pictureAnchor, pictureGrowRequest } from "./grow-from-picture";

// Ring 4, maximum 12: cuts at 6, 8 and 10; Strongly from 8, Strongest from 10.
const strength: StrengthCuts = { ring: 4, cuts: [6, 8, 10], maximum: 12 };
type Row = { code: [number, number, number]; imageId: number; slot: number; publicPreview?: number };

function rows(patches: Row[]): CloudRows {
  const result = emptyRows(patches.length);
  patches.forEach((patch, index) => {
    result.codes.set(patch.code, 3 * index);
    result.norms[index] = Math.hypot(...patch.code);
    result.imageIds[index] = patch.imageId;
    result.slots[index] = patch.slot;
    result.publicPreview[index] = patch.publicPreview ?? 1;
  });
  return result;
}

/** The whole cloud's first axis is the diagonal (1, 1, 0) / √2. */
function cloud(sample: Row[]): BlockCloud {
  const s = Math.SQRT1_2;
  return {
    source: "full",
    whole: { block: 7, rows: 1000, publicRows: 600, pictures: 40, gateMedian: 4, maximumNorm: 13, axes: [[s, s, 0], [s, -s, 0], [0, 0, 1]] },
    rows: rows([]),
    sample: rows(sample),
    strongest: null,
    canLoadMore: true,
    notice: null,
    file: null,
  };
}

const sample: Row[] = [
  { code: [11, 0, 0], imageId: 100, slot: 5 },
  { code: [8, 8, 0], imageId: 101, slot: 6 },
  { code: [0, 0, 5], imageId: 102, slot: 7 },
  { code: [0, 9, 0], imageId: 103, slot: 8 },
];
const upload = (code: [number, number, number], slot: number): CloudToken => ({ source: "upload", code, slot, norm: Math.hypot(...code) });

describe("the patch a picture's material grows toward", () => {
  it("is the picture's own patch from Strongly up, else the lift, else nothing", () => {
    expect(FIRING_BAND).toBe(2);
    expect(pictureAnchor(3, 0, 9)).toEqual({ index: 0, reason: "own" });
    expect(pictureAnchor(2, 0, 9)).toEqual({ index: 0, reason: "own" });
    expect(pictureAnchor(1, 0, 9)).toEqual({ index: 9, reason: "lift" });
    expect(pictureAnchor(0, 0, null)).toBeNull();
  });

  it("asks for the picture's own strongest patch when it is strong enough, with the picture's patches", () => {
    const own = [upload([3, 3, 0], 40), upload([7.5, 7.5, 0], 41), upload([2, 0, 0], 42)];
    const grow = pictureGrowRequest(cloud(sample), own, strength)!;
    expect(grow.reason).toBe("own");
    expect(grow.request.anchor).toMatchObject({ source: "upload", slot: 41, band: "strongest" });
    expect(grow.request.points.map((point) => point.slot)).toEqual([41, 40, 42]);
    expect(grow.request.coverage).toMatchObject({ selectedPoints: 3, blockRows: 1000 });
    expect(grow.request.block).toBe(7);
  });

  it("lifts a weak picture to the Strongest library patch nearest its direction, and carries it", () => {
    const own = [upload([3, 3, 0], 40), upload([2, 0, 0], 42)];
    const grow = pictureGrowRequest(cloud(sample), own, strength)!;
    expect(grow.reason).toBe("lift");
    expect(grow.request.anchor).toMatchObject({ source: "library", imageId: 101, slot: 6, band: "strongest" });
    expect(grow.request.points).toHaveLength(3);
    expect(grow.request.points.at(-1)).toMatchObject({ source: "library", imageId: 101 });
  });

  it("has nothing to grow toward without a Strongest patch to lift to, or without a patch at all", () => {
    const weakSample = sample.map((row) => ({ ...row, code: row.code.map((value) => value / 3) as [number, number, number] }));
    expect(pictureGrowRequest(cloud(weakSample), [upload([3, 3, 0], 40)], strength)).toBeNull();
    expect(pictureGrowRequest(cloud(sample), [], strength)).toBeNull();
  });
});
