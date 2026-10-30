import { describe, expect, it } from "vitest";
import { emptyRows, type BlockCloud, type CloudRows } from "../../library/block-cloud";
import { MATERIAL_REQUEST_MAX_POINTS, type StrengthCuts } from "../../recipe";
import { pageToken, prepareCloud } from "./cloud-geometry";
import type { CloudToken } from "./cloud-token";
import { defaultOccurrence, leadingPictures, occurrenceRequest, type OccurrenceSource } from "./occurrence-request";
import { strongestBandRequest } from "./strongest-request";

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
  { code: [8.5, 0, 0], imageId: 104, slot: 9 },
];
const prefix: Row[] = [
  { code: [0, 10.5, 0], imageId: 200, slot: 9, publicPreview: 0 },
  // The same occurrence as the sample's second row: counted once.
  { code: [8, 8, 0], imageId: 101, slot: 6 },
  { code: [0, 8.2, 0], imageId: 201, slot: 10 },
];

function source(own: CloudToken[] = []): OccurrenceSource {
  const block = cloud(sample, prefix);
  return { cloud: block, prepared: prepareCloud(block, own, strength), strength, token: (index) => pageToken(block, own, index) };
}
const imageIds = (request: ReturnType<typeof occurrenceRequest>) => request.points.map((point) => (point.source === "library" ? point.imageId : "upload"));

describe("Grow from one occurrence", () => {
  it("makes, at Grow's default occurrence, the request /grow?block=N makes", () => {
    const page = source();
    const index = defaultOccurrence(page)!;
    expect(page.token(index)).toMatchObject({ imageId: 101, slot: 6 });
    expect(occurrenceRequest(page, index)).toEqual(strongestBandRequest(page.cloud, strength));
  });

  it("anchors at a Strongly picture and carries the loaded Strongly patches", () => {
    const page = source();
    const request = occurrenceRequest(page, 3);
    expect(request.anchor).toMatchObject({ band: "strongly", source: "library", imageId: 103, slot: 8 });
    expect(imageIds(request)).toEqual([103, 104, 201]);
    expect(request.coverage).toEqual({ source: "full", loadedRows: 7, blockRows: 1000, selectedPoints: 3 });
  });

  it("adds your picture's patch to its band's points when it is the anchor", () => {
    const own: CloudToken = { source: "upload", code: [10.5, 1, 0], slot: 40, norm: Math.hypot(10.5, 1, 0) };
    const request = occurrenceRequest(source([own]), 0);
    expect(request.anchor).toMatchObject({ band: "strongest", source: "upload", slot: 40 });
    expect(imageIds(request)).toEqual(["upload", 100, 101, 200]);
  });

  it("sends at most 4,352 points and keeps the anchor", () => {
    const many: Row[] = Array.from({ length: 5000 }, (_, index) => ({ code: [10.5, 0.001 * index, 0], imageId: 1000 + index, slot: 5 }));
    const block = cloud(sample, many);
    const page = { cloud: block, prepared: prepareCloud(block, [], strength), strength, token: (index: number) => pageToken(block, [], index) };
    const request = occurrenceRequest(page, 0);
    expect(request.points).toHaveLength(MATERIAL_REQUEST_MAX_POINTS);
    expect(request.points.some((point) => point.source === "library" && point.imageId === 100)).toBe(true);
    expect(request.coverage?.selectedPoints).toBe(5002);
  });

  it("has no default occurrence when the sample has no Strongest picture", () => {
    const block = cloud(sample.slice(2), prefix);
    expect(defaultOccurrence({ cloud: block, prepared: prepareCloud(block, [], strength), strength, token: (index) => pageToken(block, [], index) })).toBeNull();
  });
});

describe("the Strongest row's order", () => {
  it("opens with Grow's default occurrence, then the rest by strength", () => {
    expect(leadingPictures([4, 9, 2, 7], 2, 3)).toEqual([2, 4, 9]);
  });

  it("keeps the band's order when the lead is not in it or there is none", () => {
    expect(leadingPictures([4, 9, 2], 8, 2)).toEqual([4, 9]);
    expect(leadingPictures([4, 9, 2], null, 8)).toEqual([4, 9, 2]);
  });
});
