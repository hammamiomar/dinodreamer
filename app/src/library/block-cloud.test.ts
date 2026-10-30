import { describe, expect, it, vi } from "vitest";
import { appendRows, cloudPoint, emptyRows, principalFrame, sampleBlockCloud, withFirstPrefix, type BlockCloud } from "./block-cloud";
import { decodeLookFixture, decodeLookSummary } from "./look-cloud";
import { Library } from "./library";
import { fixtureLibrary } from "./fixture-library";

const row = (code: number[], imageId: number, slot: number) => ({
  code, norm: Math.hypot(...code), image_id: imageId, slot, public_preview: true, winner_rank: 3, gate: 1.5,
});
const sample = () => ({
  format: 2,
  block: 14544,
  source: { release: "pass-003" },
  sampling: { filter: "public_preview", selected_rows: 3, source_block_rows: 100, public_preview_fraction: 0.8 },
  rows: [row([3, 4, 0], 9007199254740991, 260), row([2, 3, 6], 2, 5), row([-2, 0, 0], 3, 6)],
});
const summary = () => ({ block: 14544, release: "pass-003", gate_median: 1.2, radius: { p50: 1.4 }, main_lobe: { direction: [1, 0, 0] }, patch_rows: 100 });

describe("the block cloud interface", () => {
  it("keeps the sample's points, whole count and fitted frame", () => {
    const fixture = decodeLookFixture(sample());
    const cloud = sampleBlockCloud({ fixture, summary: decodeLookSummary(summary()) }, "Showing the sample.");
    expect(cloud).toMatchObject({ source: "sample", canLoadMore: false, notice: "Showing the sample.", file: null });
    expect(cloud.sample).toBe(cloud.rows);
    expect(cloud.whole).toMatchObject({ block: 14544, rows: 100, publicRows: 80, pictures: null, gateMedian: 1.2, maximumNorm: 7 });
    expect(cloud.rows.count).toBe(3);
    fixture.points.forEach((point, index) => expect(cloudPoint(cloud.rows, index)).toEqual(point));
  });

  it("appends rows without renumbering the loaded rows", () => {
    const first = emptyRows(2);
    first.codes.set([1, 2, 3, 4, 5, 6]);
    first.imageIds.set([9007199254740991, 7]);
    const more = emptyRows(1);
    more.codes.set([7, 8, 9]);
    more.imageIds.set([11]);
    more.publicPreview.set([1]);
    const rows = appendRows(first, more);
    expect(rows.count).toBe(3);
    expect(cloudPoint(rows, 0)).toMatchObject({ code: [1, 2, 3], imageId: 9007199254740991, publicPreview: false });
    expect(cloudPoint(rows, 2)).toMatchObject({ code: [7, 8, 9], imageId: 11, publicPreview: true });
  });

  it("is shared per block and falls back to the sample on a whole-file answer", async () => {
    const published = (await fixtureLibrary()).library;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => Response.json(String(url).includes("/summaries/") ? summary() : sample()));
    const library = new Library("https://library.example", { ...published.release, name: "pass-003" }, fetcher);
    const [first, second] = await Promise.all([library.blockCloud(14544), library.blockCloud(14544)]);
    expect(first).toBe(second);
    expect(first).toMatchObject({ source: "sample", notice: expect.stringContaining("whole file") });
    expect(await library.loadMoreRows(first)).toBe(first);
  });
});

describe("a view's first prefix (withFirstPrefix)", () => {
  const file = { url: "https://library.example/full/14544.bin", etag: "\"a\"", rows: 100 };
  const initial = { source: "full", rows: emptyRows(0), canLoadMore: true, notice: null, file } as unknown as BlockCloud;

  it("takes the read when it holds rows of the same file", () => {
    const read = { ...initial, rows: emptyRows(64), file: { ...file } };
    expect(withFirstPrefix(initial, read)).toBe(read);
  });

  it("keeps the view as it was, with the reason, when the rows did not come", () => {
    const fallback = { ...initial, source: "sample", file: null, notice: "The full response set could not be read." } as BlockCloud;
    expect(withFirstPrefix(initial, fallback)).toMatchObject({ rows: { count: 0 }, canLoadMore: false, notice: "The full response set could not be read.", file });
    const changed = { ...initial, rows: emptyRows(64), file: { ...file, etag: "\"b\"" } };
    expect(withFirstPrefix(initial, changed)).toMatchObject({ rows: { count: 0 }, canLoadMore: false });
  });
});

describe("the cloud's principal frame", () => {
  const codes = [[8, 8, 0], [5, 5, 1], [3, 1, 0], [1, 2, -1], [-3, -2, 0]];
  const project = (code: number[], frame: ReturnType<typeof principalFrame>) =>
    frame.map((axis) => axis[0] * code[0] + axis[1] * code[1] + axis[2] * code[2]);

  it("preserves norms, diagonalizes the uncentred moment and orients PC1 along the main lobe", () => {
    const frame = principalFrame(codes, [1, 1, 0]);
    const transformed = codes.map((code) => project(code, frame));
    codes.forEach((code, index) => expect(Math.hypot(...transformed[index])).toBeCloseTo(Math.hypot(...code), 10));
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      expect(transformed.reduce((sum, code) => sum + code[a] * code[b], 0)).toBeCloseTo(0, 8);
    }
    const energy = [0, 1, 2].map((axis) => transformed.reduce((sum, code) => sum + code[axis] ** 2, 0));
    expect(energy[0]).toBeGreaterThan(energy[1]);
    expect(energy[1]).toBeGreaterThan(energy[2]);
    expect(project([1, 1, 0], frame)[0]).toBeGreaterThan(0);
  });

  it("remains a right-handed orthonormal frame for a rank-one cloud", () => {
    const [a, b, c] = principalFrame([[1, 0, 0], [2, 0, 0]], [1, 0, 0]);
    expect(a).toEqual([1, 0, 0]);
    expect(Math.hypot(...b)).toBeCloseTo(1, 12);
    expect(c[0] * a[0] + c[1] * a[1] + c[2] * a[2]).toBeCloseTo(0, 12);
    expect(a[1] * b[2] - a[2] * b[1]).toBeCloseTo(c[0], 12);
  });
});
