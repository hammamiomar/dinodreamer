import { describe, expect, it } from "vitest";
import { emptyRows, type BlockCloud, type CloudRows } from "../../library/block-cloud";
import { MATERIAL_REQUEST_MAX_POINTS, type StrengthCuts } from "../../recipe";
import { pageToken, prepareCloud } from "./cloud-geometry";
import { evenSubsample, makeMaterialRequest } from "./material-request";
import { bandSelection } from "./request-anchor";
import { anchorToken, growPath, strongestBandRequest } from "./strongest-request";
import { STRONGEST } from "./strength-bands";

// Ring 4, maximum 12: cuts at 6, 8 and 10; Strongest from norm 10.
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
function cloud(sample: Row[], prefix: Row[]): BlockCloud {
  const s = Math.SQRT1_2;
  return {
    source: "full",
    whole: { block: 7, rows: 1000, publicRows: 600, pictures: 40, gateMedian: 4, maximumNorm: 13, axes: [[s, s, 0], [s, -s, 0], [0, 0, 1]] },
    rows: rows(prefix),
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
const prefix: Row[] = [
  { code: [0, 10.5, 0], imageId: 200, slot: 9, publicPreview: 0 },
  // The same occurrence as the sample's second row: counted once.
  { code: [8, 8, 0], imageId: 101, slot: 6 },
];

describe("the Strongest band request", () => {
  it("takes every loaded Strongest patch once and anchors at the sample patch nearest the lobe's axis", () => {
    const block = cloud(sample, prefix);
    const request = strongestBandRequest(block, strength)!;
    expect(request.anchor).toMatchObject({ band: "strongest", source: "library", imageId: 101, slot: 6 });
    expect(request.points.map((point) => point.source === "library" && point.imageId)).toEqual([100, 101, 200]);
    expect(request.coverage).toEqual({ source: "full", loadedRows: 5, blockRows: 1000, selectedPoints: 3 });
    expect(request.block).toBe(7);
  });

  it("is the request the block page makes with Start with the Strongest band and Send", () => {
    const block = cloud(sample, prefix);
    const prepared = prepareCloud(block, [], strength);
    const selection = bandSelection(prepared.bands, prepared.repeats, prepared.own, STRONGEST, block.sample, block.whole.axes[0], strength);
    if (selection.kind !== "band" || selection.anchor === null) throw new Error("The fixture has a Strongest anchor.");
    const page = makeMaterialRequest({
      block: 7,
      token: (index) => pageToken(block, [], index),
      points: evenSubsample(selection.indices, MATERIAL_REQUEST_MAX_POINTS, selection.anchor),
      anchor: selection.anchor,
      strength,
      coverage: { source: "full", loadedRows: prepared.libraryRows, blockRows: 1000, selectedPoints: selection.indices.length },
    });
    expect(strongestBandRequest(block, strength)).toEqual(page);
  });

  it("sends at most 4,352 points, the anchor among them, and counts the whole band", () => {
    const many: Row[] = Array.from({ length: 5000 }, (_, index) => ({ code: [10.5, 0.001 * index, 0], imageId: 1000 + index, slot: 5 }));
    const request = strongestBandRequest(cloud(sample, many), strength)!;
    expect(request.points).toHaveLength(MATERIAL_REQUEST_MAX_POINTS);
    expect(request.points.some((point) => point.source === "library" && point.imageId === 101)).toBe(true);
    expect(request.coverage?.selectedPoints).toBe(5002);
  });

  it("is null when the public sample has no Strongest patch to anchor it", () => {
    expect(strongestBandRequest(cloud(sample.slice(2), prefix), strength)).toBeNull();
  });
});

it("gives a request's anchor back as the patch the Look components draw", () => {
  const block = cloud(sample, prefix);
  const request = strongestBandRequest(block, strength)!;
  // The page's patch also carries its rank and gate; the components need these fields.
  expect(pageToken(block, [], 1)).toMatchObject(anchorToken(request.anchor!));
  expect(anchorToken(request.anchor!)).toMatchObject({ source: "library", imageId: 101, slot: 6, publicPreview: true });
  expect(anchorToken({ source: "upload", code: [1, 2, 2], slot: 30, norm: 3, band: "barely", strength })).toEqual({ source: "upload", code: [1, 2, 2], slot: 30, norm: 3 });
});

it("links a block to the Grow page, keeping the fake engine", () => {
  expect(growPath(12182, "")).toBe("/train?block=12182");
  expect(growPath(12182, "?engine=fake&page=2")).toBe("/train?block=12182&engine=fake");
});
