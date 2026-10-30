// An explicit audit of the published full clouds, not part of the routine suite.
// It reads the public manifest, 16 headers and three first prefixes over the
// network, plus local tier-3 samples and Atlas records. Run from app/:
//
//   FULL_CLOUD_AUDIT=<tier3 blocks folder> ATLAS_ASSETS=<atlas assets folder> \
//   FULL_CLOUD_AUDIT_OUTPUT=/tmp/full-cloud-audit.json \
//   pnpm vitest run src/library/full-cloud.audit.test.ts
//
// About 4.4 MB of ranges and the 6.5 MB manifest.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudPoint } from "./block-cloud";
import { ATLAS_CLOUDS_PATH, decodeAtlasCloud, decodeAtlasIndex } from "./atlas-cloud";
import { float16Tolerance, FULL_CLOUDS_PATH, fullCloudBytes, nextPrefixEnd, openFullCloud, readFullCloudRows } from "./full-cloud";

const TIER3 = process.env.FULL_CLOUD_AUDIT;
const ATLAS = process.env.ATLAS_ASSETS;
const BASE = "https://library.computervision.vision";
const AUDIT_BLOCKS = [12240, 2568, 7178, 13345, 14544, 14552, 4009, 13364, 12002, 7705, 12299, 2632, 16250, 13633, 11266, 15498];
/** Small, near the library's median of 173,774.5 rows, and large. */
const JOIN_BLOCKS = [12240, 12002, 15498];
const LARGE_BLOCKS = [3178, 5024, 7125, 7887, 8296, 8827, 10731, 11971, 12199, 15624];

interface ManifestFile { block: number; rows: number; public_rows: number; pictures: number; max_patches_per_picture: number; bytes: number; etag: string }
interface Tier3Row { code: number[]; norm: number; image_id: number; slot: number; public_preview: boolean; winner_rank: number; gate: number }
interface Tier3Block { block: number; sampling: { source_block_rows: number; available_rows: number }; rows: Tier3Row[] }

/** The CDN refuses some default client user agents; count every response body byte. */
function countingFetch() {
  const counts = { requests: 0, bodyBytes: 0, statuses: {} as Record<number, number> };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", "Mozilla/5.0 dinodreamer full-cloud audit");
    const response = await fetch(input, { ...init, headers });
    counts.requests++;
    counts.statuses[response.status] = (counts.statuses[response.status] ?? 0) + 1;
    if (headers.has("Range") && response.status !== 206) {
      await response.body?.cancel();
      return new Response(null, { status: response.status, headers: response.headers });
    }
    const body = await response.arrayBuffer();
    counts.bodyBytes += body.byteLength;
    return new Response(body, { status: response.status, headers: response.headers });
  }) as typeof fetch;
  return { fetcher, counts };
}

const fullUrl = (block: number) => `${BASE}/${FULL_CLOUDS_PATH}/${block}.bin`;
const bandOf = (norm: number, cuts: readonly number[]) => cuts.filter((cut) => norm >= cut).length;
const shares = (counts: readonly number[]) => counts.map((count) => count / Math.max(1, counts.reduce((a, b) => a + b, 0)));

describe.skipIf(!TIER3 || !ATLAS)("published full clouds", () => {
  const report: Record<string, unknown> = { date: new Date().toISOString(), base: BASE };
  let manifest: { files: ManifestFile[] } & Record<string, unknown>;

  it("lists every block once with the contract's file length", async () => {
    const { fetcher, counts } = countingFetch();
    manifest = await (await fetcher(`${BASE}/${FULL_CLOUDS_PATH}/manifest.json`)).json();
    const files = manifest.files;
    expect(manifest).toMatchObject({ format: "ATF2", version: 2, header_bytes: 128, row_bytes: 22, release: "pass-003", blocks: 16384 });
    expect(files.map((file) => file.block)).toEqual(Array.from({ length: 16384 }, (_, block) => block));
    const sum = (field: "rows" | "public_rows" | "bytes") => files.reduce((total, file) => total + file[field], 0);
    expect(files.filter((file) => file.bytes !== fullCloudBytes(file.rows))).toEqual([]);
    expect([sum("rows"), sum("public_rows"), sum("bytes")]).toEqual([8_858_370_048, 5_305_311_232, 194_886_238_208]);
    expect([manifest.rows, manifest.public_rows, manifest.bytes]).toEqual([sum("rows"), sum("public_rows"), sum("bytes")]);
    const large = files.filter((file) => file.bytes > 512 * 2 ** 20);
    expect(large.map((file) => file.block)).toEqual(LARGE_BLOCKS);
    report.manifest = {
      bodyBytes: counts.bodyBytes,
      blocks: files.length,
      rows: sum("rows"),
      publicRows: sum("public_rows"),
      bytes: sum("bytes"),
      largest: (({ block, rows, bytes }) => ({ block, rows, bytes }))(files.reduce((a, b) => (b.bytes > a.bytes ? b : a))),
      above512MiB: large.map((file) => ({ block: file.block, rows: file.rows, bytes: file.bytes, etag: file.etag })),
    };
  }, 60_000);

  it("matches 16 headers to the manifest, tier-3 samples and Atlas records", async () => {
    const { fetcher, counts } = countingFetch();
    const atlasRoot = join(ATLAS!, ATLAS_CLOUDS_PATH);
    const index = decodeAtlasIndex((await readFile(join(atlasRoot, "index.bin"))).buffer as ArrayBuffer);
    const rows = [];
    for (const block of AUDIT_BLOCKS) {
      const { header, file } = await openFullCloud(fetcher, fullUrl(block), block);
      const listed = manifest.files[block];
      const tier3: Tier3Block = JSON.parse(await readFile(join(TIER3!, `block-${block}.json`), "utf8"));
      const atlas = decodeAtlasCloud((await readFile(join(atlasRoot, "blocks", `${block}.bin`))).buffer as ArrayBuffer);
      const entry = index.find((candidate) => candidate.block === block)!;
      expect([header.rows, header.publicRows, header.pictures, header.maximumPicturePatches, file.etag])
        .toEqual([listed.rows, listed.public_rows, listed.pictures, listed.max_patches_per_picture, listed.etag]);
      expect([header.rows, header.publicRows]).toEqual([tier3.sampling.source_block_rows, tier3.sampling.available_rows]);
      expect([atlas.wins, entry.total, atlas.total]).toEqual([header.rows, 4096, 4096]);
      expect(atlas.publicShare).toBeCloseTo(header.publicRows / header.rows, 6);
      expect(header.gateMedian).toBe(atlas.ring);
      const sampleMaximum = Math.max(...tier3.rows.map((row) => row.norm));
      expect(Math.fround(sampleMaximum)).toBe(atlas.maximum);
      expect(header.maximumNorm).toBeGreaterThanOrEqual(atlas.maximum);
      rows.push({
        block,
        rows: header.rows,
        publicRows: header.publicRows,
        pictures: header.pictures,
        gateMedian: header.gateMedian,
        wholeMaximum: header.maximumNorm,
        sampleMaximum: atlas.maximum,
        maximumRatio: header.maximumNorm / atlas.maximum,
        atlasSampleCounts: entry.counts,
        etag: file.etag,
      });
    }
    report.headers = { requests: counts.requests, bodyBytes: counts.bodyBytes, statuses: counts.statuses, blocks: rows };
  }, 120_000);

  it("joins first prefixes of three blocks to the tier-3 rows within float16 rounding", async () => {
    const atlasRoot = join(ATLAS!, ATLAS_CLOUDS_PATH);
    const joins = [];
    for (const block of JOIN_BLOCKS) {
      const { fetcher, counts } = countingFetch();
      const started = performance.now();
      const { header, file } = await openFullCloud(fetcher, fullUrl(block), block);
      const loaded = await readFullCloudRows(fetcher, file, 0, nextPrefixEnd(0, header.rows));
      const seconds = (performance.now() - started) / 1000;
      const tier3: Tier3Block = JSON.parse(await readFile(join(TIER3!, `block-${block}.json`), "utf8"));
      const atlas = decodeAtlasCloud((await readFile(join(atlasRoot, "blocks", `${block}.bin`))).buffer as ArrayBuffer);

      const byAddress = new Map<string, number>();
      for (let index = 0; index < loaded.count; index++) byAddress.set(`${loaded.imageIds[index]}:${loaded.slots[index]}`, index);
      expect(byAddress.size).toBe(loaded.count);
      let joined = 0;
      let largestCodeError = 0;
      const mismatches: unknown[] = [];
      for (const row of tier3.rows) {
        const index = byAddress.get(`${row.image_id}:${row.slot}`);
        if (index === undefined) continue;
        joined++;
        const point = cloudPoint(loaded, index);
        const codeOk = row.code.every((value, axis) => Math.abs(point.code[axis] - value) <= float16Tolerance(value));
        largestCodeError = Math.max(largestCodeError, ...row.code.map((value, axis) => Math.abs(point.code[axis] - value) / float16Tolerance(value)));
        const ok = codeOk
          && Math.abs(point.norm - row.norm) <= float16Tolerance(row.norm)
          && Math.abs(point.gate - row.gate) <= float16Tolerance(row.gate)
          && point.winnerRank === row.winner_rank && point.publicPreview;
        if (!ok) mismatches.push({ row, point });
      }
      // Image-balanced rounds: the first min(L, P) rows come from distinct pictures.
      const firstRound = Math.min(loaded.count, header.pictures);
      const distinctPictures = new Set(loaded.imageIds.subarray(0, firstRound)).size;
      const prefixCounts = [0, 0, 0, 0];
      const prefixPublicCounts = [0, 0, 0, 0];
      for (let index = 0; index < loaded.count; index++) {
        const band = bandOf(loaded.norms[index], atlas.cuts);
        prefixCounts[band]++;
        if (loaded.publicPreview[index]) prefixPublicCounts[band]++;
      }
      expect(mismatches).toEqual([]);
      expect(distinctPictures).toBe(firstRound);
      if (header.rows <= loaded.count) expect(joined).toBe(tier3.rows.length);
      joins.push({
        block,
        rows: header.rows,
        loadedRows: loaded.count,
        requests: counts.requests,
        bodyBytes: counts.bodyBytes,
        seconds,
        tier3Rows: tier3.rows.length,
        joined,
        largestCodeErrorOverTolerance: largestCodeError,
        distinctPicturesInFirstRound: distinctPictures,
        loadedPublicRows: loaded.publicPreview.reduce((sum, flag) => sum + flag, 0),
        bandShares: {
          atlasSample: shares(atlas.counts),
          prefixAllRows: shares(prefixCounts),
          prefixPublicRows: shares(prefixPublicCounts),
        },
      });
    }
    report.joins = joins;
    const outputPath = process.env.FULL_CLOUD_AUDIT_OUTPUT ?? process.env.FULL_CLOUD_AUDIT_OUT;
    if (outputPath) await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  }, 300_000);
});
