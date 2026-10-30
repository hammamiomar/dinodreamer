import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ATLAS_CLOUDS_PATH,
  decodeAtlasCloud,
  decodeAtlasIndex,
} from "./atlas-cloud";
import { Library, readCloudAtlasFiles } from "./library";
import { LOOK_CLOUDS_PATH } from "./look-cloud";
import type { Release } from "./records";

/** An index of one row: block 12182. */
function oneRowIndex(): ArrayBuffer {
  const bytes = new ArrayBuffer(32);
  const view = new DataView(bytes);
  [..."ATI1"].forEach((letter, index) => view.setUint8(index, letter.charCodeAt(0)));
  view.setUint16(4, 1, true);
  view.setUint16(6, 24, true);
  view.setUint16(8, 12182, true);
  view.setUint16(10, 4096, true);
  view.setFloat32(12, 8.25, true);
  view.setFloat32(16, 0.25, true);
  [3406, 480, 141, 69].forEach((count, band) => view.setUint16(24 + 2 * band, count, true));
  return bytes;
}

function example(): ArrayBuffer {
  const bytes = readFileSync(
    new URL("../../fixtures/atlas-clouds/block-12182.bin", import.meta.url),
  );
  return Uint8Array.from(bytes).buffer;
}

describe("compact Atlas boundary", () => {
  it("reads the real Python producer output, with exact picture addresses", () => {
    const cloud = decodeAtlasCloud(example());
    expect(cloud.block).toBe(12182);
    expect(cloud.total).toBe(4096);
    expect(cloud.points).toHaveLength(512);
    expect(cloud.counts).toEqual([3406, 480, 141, 69]);
    // Four per band, whatever the band's share: Strongest has 69 patches and four pictures.
    expect(cloud.pictures.map((picture) => picture.band)).toEqual([
      0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    ]);
    expect(new Set(cloud.pictures.map((picture) => picture.imageId)).size).toBe(16);
    expect(cloud.pictures[0]).toEqual({
      imageId: 3127331618592017,
      slot: 89,
      band: 0,
    });
    expect(cloud.cuts[0]).toBeCloseTo(
      cloud.ring + (cloud.maximum - cloud.ring) / 4,
      5,
    );
    expect(example().byteLength).toBe(2796);
  });

  it("rejects truncated records, inconsistent counts and unsafe picture IDs", () => {
    expect(() => decodeAtlasCloud(example().slice(0, -1))).toThrow(
      "response set length",
    );
    const counts = example();
    new DataView(counts).setUint16(20, 3, true);
    expect(() => decodeAtlasCloud(counts)).toThrow("patch counts");
    const ids = example();
    new DataView(ids).setBigUint64(60 + 512 * 5, 2n ** 53n, true);
    expect(() => decodeAtlasCloud(ids)).toThrow("picture record");
  });

  it("rejects an older format and a band with the wrong number of pictures", () => {
    const older = example();
    new DataView(older).setUint8(3, "1".charCodeAt(0));
    expect(() => decodeAtlasCloud(older)).toThrow("response set size");
    // The first picture moved from Barely to Weakly: five Weakly pictures, three Barely.
    const moved = example();
    new DataView(moved).setUint8(60 + 512 * 5 + 10, 1);
    expect(() => decodeAtlasCloud(moved)).toThrow("pictures per response level");
  });

  it("uses an index read begun before the release was known, and still checks the release", async () => {
    const manifest = (release: string) => ({ format: 1, source: LOOK_CLOUDS_PATH, release, blocks: 1, domain: { xMin: -10, xMax: 25, yMaximum: 10 }, materials: [] });
    const answer = (release: string) => vi.fn(async (url: RequestInfo | URL) => String(url).endsWith("manifest.json")
      ? new Response(JSON.stringify(manifest(release)))
      : new Response(oneRowIndex()));
    const fetcher = answer("pass-003");
    const started = readCloudAtlasFiles("https://library.test", fetcher);
    const library = new Library("https://library.test", { name: "pass-003" } as Release, fetcher);
    await expect(library.cloudAtlas(started)).resolves.toMatchObject({ entries: [{ block: 12182 }] });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `https://library.test/${ATLAS_CLOUDS_PATH}/manifest.json`,
      `https://library.test/${ATLAS_CLOUDS_PATH}/index.bin`,
    ]);
    const other = answer("pass-002");
    const stale = new Library("https://library.test", { name: "pass-003" } as Release, other);
    await expect(stale.cloudAtlas(readCloudAtlasFiles("https://library.test", other))).rejects.toThrow("does not match this release");
  });

  it("reads an index without fetching any per-card data", () => {
    const bytes = oneRowIndex();
    expect(decodeAtlasIndex(bytes)).toEqual([
      {
        block: 12182,
        total: 4096,
        reach: 8.25,
        nearRing: 0.25,
        pole: 0,
        counts: [3406, 480, 141, 69],
      },
    ]);
  });

  it("shares one compact read across views and retries only a failed read", async () => {
    const fetcher = vi.fn(async () => new Response(example()));
    const library = new Library(
      "https://library.test",
      { name: "pass-003" } as Release,
      fetcher,
    );
    const [clouds, bands] = await Promise.all([
      library.atlasCloud(12182),
      library.atlasCloud(12182),
    ]);
    expect(clouds).toBe(bands);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `https://library.test/${ATLAS_CLOUDS_PATH}/blocks/12182.bin`,
    );
    const failedFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockImplementation(async () => new Response(example()));
    const retry = new Library(
      "https://library.test",
      { name: "pass-003" } as Release,
      failedFetch,
    );
    await expect(retry.atlasCloud(12182)).rejects.toThrow("503");
    await expect(retry.atlasCloud(12182)).resolves.toHaveProperty(
      "block",
      12182,
    );
    expect(failedFetch).toHaveBeenCalledTimes(2);
  });
});
