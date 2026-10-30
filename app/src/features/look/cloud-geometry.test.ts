import { expect, it } from "vitest";
import { emptyRows, type BlockCloud, type CloudRows } from "../../library/block-cloud";
import type { StrengthCuts } from "../../recipe";
import type { CloudToken } from "./cloud-token";
import { pageHasPicture, pageToken, prepareCloud } from "./cloud-geometry";

// Ring 4, maximum 12: cuts at 6, 8 and 10.
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

function cloud(sample: Row[], prefix: Row[] | null): BlockCloud {
  const s = Math.SQRT1_2;
  const sampleRows = rows(sample);
  return {
    source: prefix ? "full" : "sample",
    whole: { block: 7, rows: 1000, publicRows: 600, pictures: 40, gateMedian: 4, maximumNorm: 13, axes: [[s, s, 0], [s, -s, 0], [0, 0, 1]] },
    rows: prefix ? rows(prefix) : sampleRows,
    sample: sampleRows,
    strongest: null,
    canLoadMore: prefix !== null,
    notice: null,
    file: null,
  };
}

const own: CloudToken[] = [{ source: "upload", slot: 20, code: [0, 0, 7], norm: 7 }, { source: "upload", slot: 21, code: [0, 3, 0], norm: 3 }];
const sample: Row[] = [
  { code: [11, 0, 0], imageId: 100, slot: 5 },
  { code: [0, 9, 0], imageId: 101, slot: 6 },
  { code: [0, 0, 5], imageId: 102, slot: 7 },
  { code: [15, 0, 0], imageId: 103, slot: 8 },
];
const prefix: Row[] = [
  { code: [0, 10.5, 0], imageId: 200, slot: 9, publicPreview: 0 },
  { code: [0, 9, 0], imageId: 101, slot: 6 },
];

it("orders your picture, the sample, then the prefix, and bands every patch by the Atlas cuts", () => {
  const block = cloud(sample, prefix);
  const prepared = prepareCloud(block, own, strength);
  expect([prepared.count, prepared.own, prepared.sample]).toEqual([8, 2, 4]);
  expect(prepared.bands).toEqual([1, 0, 3, 2, 0, 3, 3, 2]);
  expect(prepared.sampleCounts).toEqual([1, 0, 1, 2]);
  expect(prepared.members).toEqual([[4], [], [3], [5, 2]]);
  expect(prepared.ownByStrength).toEqual([0, 1]);
  expect(prepared.strongest).toBe(5);
  expect(prepared.extent).toBe(15);
  expect(Array.from(prepared.repeats)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  expect(prepared.libraryRows).toBe(5);
  prepared.display.forEach((code, index) => expect(Math.hypot(...code)).toBeCloseTo(prepared.norms[index], 5));
  expect(pageToken(block, own, 1)).toBe(own[1]);
  expect(pageToken(block, own, 3)).toMatchObject({ source: "library", imageId: 101, slot: 6, publicPreview: true });
  expect(pageToken(block, own, 6)).toMatchObject({ source: "library", imageId: 200, slot: 9, publicPreview: false });
  expect([0, 2, 6, 7].map((index) => pageHasPicture(block, prepared.own, index))).toEqual([true, true, false, true]);
});

it("shows the sample alone when the full file cannot be read", () => {
  const prepared = prepareCloud(cloud(sample, null), own, strength);
  expect(prepared.count).toBe(6);
  expect(prepared.repeats.every((value) => value === 0)).toBe(true);
});

it("keeps every page index when more prefix rows load", () => {
  const first = prepareCloud(cloud(sample, prefix.slice(0, 1)), own, strength);
  const more = prepareCloud(cloud(sample, prefix), own, strength);
  expect(more.native.slice(0, first.count)).toEqual(first.native);
  expect(more.bands.slice(0, first.count)).toEqual(first.bands);
});

it("puts the strongest rows before the prefix and counts each occurrence once", () => {
  const block = { ...cloud(sample, prefix), strongest: rows([{ code: [15, 0, 0], imageId: 103, slot: 8 }, { code: [0, 13, 0], imageId: 300, slot: 11 }]) };
  const prepared = prepareCloud(block, own, strength);
  // own 0–1, sample 2–5, strongest 6–7, prefix 8–9.
  expect([prepared.count, prepared.strongestRows]).toEqual([10, 2]);
  expect(Array.from(prepared.repeats)).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 0, 1]);
  expect(prepared.libraryRows).toBe(6);
  expect(pageToken(block, own, 7)).toMatchObject({ imageId: 300, slot: 11 });
  expect(pageToken(block, own, 8)).toMatchObject({ imageId: 200, slot: 9 });
  expect(prepared.sampleCounts).toEqual([1, 0, 1, 2]);
});

it("counts a patch without a public picture once when strongest rows also occur in the prefix", () => {
  const hidden: Row = { code: [12, 0, 0], imageId: 300, slot: 20, publicPreview: 0 };
  const block = { ...cloud(sample, [...prefix, hidden]), strongest: rows([hidden]) };
  const prepared = prepareCloud(block, own, strength);
  expect(prepared.withoutPicture).toBe(2);
  expect(prepared.libraryRows).toBe(6);
});
