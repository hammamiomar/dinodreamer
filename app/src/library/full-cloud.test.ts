import { describe, expect, it, vi } from "vitest";
import {
  columnRange,
  decodeFullCloudHeader,
  decodeFullCloudRows,
  float16,
  float16Column,
  float16Tolerance,
  FULL_CLOUD_COLUMNS,
  FULL_CLOUD_PREFIX_ROWS,
  FULL_CLOUDS_PATH,
  fullCloudBytes,
  LOADED_ROWS_LIMIT,
  openFullCloud,
  rangeResponseProblem,
  readFullCloudRows,
  readStrongestRows,
  storedNormAgrees,
  type FullCloudColumn,
} from "./full-cloud";
import { cloudPoint } from "./block-cloud";
import { Library } from "./library";
import { fixtureLibrary } from "./fixture-library";

// The platform's binary16 conversion is the independent oracle; the app keeps its own decoder.
const Float16 = (globalThis as unknown as { Float16Array: new (values: number[]) => { buffer: ArrayBuffer } }).Float16Array;
const f16round = (Math as unknown as { f16round(value: number): number }).f16round;
/** The binary16 bits of each value, converted by one Float16Array for the whole list. */
const halfBits = (values: number[]) => new Uint16Array(new Float16(values).buffer);

interface Row {
  code: [number, number, number];
  imageId: number;
  slot: number;
  rank: number;
  publicPreview: number;
  gate: number;
}

/** Exact float16 values, IDs above 2³² and every public flag, for any row index. */
function rowAt(index: number): Row {
  return {
    code: [1 + (index % 7) / 8, -(index % 5) / 4, (index % 3) / 2],
    imageId: 2 ** 52 + index,
    slot: 5 + (index % 256),
    rank: 1 + (index % 32),
    publicPreview: index % 3 === 0 ? 0 : 1,
    gate: 0.5 + (index % 4) / 8,
  };
}

interface HeaderFields {
  version: number;
  block: number;
  rows: number;
  publicRows: number;
  seed: number;
  pictures: number;
  picturePatches: number;
  gateMedian: number;
  maximumNorm: number;
  axes: number[][];
  reserved: number;
}

function headerBytes(fields: Partial<HeaderFields> & { rows: number }): Uint8Array<ArrayBuffer> {
  const value: HeaderFields = {
    version: 2, block: 7125, publicRows: fields.rows, seed: 20261021, pictures: Math.ceil(fields.rows / 2), picturePatches: 2,
    gateMedian: 0.75, maximumNorm: 2.5, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], reserved: 0, ...fields,
  };
  const bytes = new Uint8Array(128);
  const view = new DataView(bytes.buffer);
  bytes.set([..."ATF2"].map((letter) => letter.charCodeAt(0)));
  view.setUint16(4, value.version, true);
  view.setUint16(6, 128, true);
  [value.block, value.rows, value.publicRows, value.seed, value.pictures, value.picturePatches]
    .forEach((field, index) => view.setUint32(8 + 4 * index, field, true));
  view.setFloat32(32, value.gateMedian, true);
  view.setFloat32(36, value.maximumNorm, true);
  value.axes.flat().forEach((part, index) => view.setFloat32(40 + 4 * index, part, true));
  view.setUint32(76, value.reserved, true);
  return bytes;
}

function columnBytes(column: FullCloudColumn, rows: readonly Row[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(rows.length * FULL_CLOUD_COLUMNS[column].rowBytes);
  const view = new DataView(bytes.buffer);
  // The file is little-endian whatever the platform's byte order.
  const writeHalves = (values: number[]) => halfBits(values).forEach((bits, index) => view.setUint16(2 * index, bits, true));
  if (column === "codes") writeHalves(rows.flatMap((row) => row.code));
  if (column === "norms") writeHalves(rows.map((row) => Math.hypot(...row.code)));
  if (column === "gates") writeHalves(rows.map((row) => row.gate));
  rows.forEach((row, index) => {
    if (column === "imageIds") view.setBigUint64(8 * index, BigInt(row.imageId), true);
    if (column === "slots") view.setUint16(2 * index, row.slot, true);
    if (column === "ranks") view.setUint8(index, row.rank);
    if (column === "publicPreview") view.setUint8(index, row.publicPreview);
  });
  return bytes;
}

/**
 * Column bodies by file row count and byte range. Several tests open files of the
 * same length, so a 65,536-row prefix is built once. A Response copies its body,
 * so a reader never changes a stored one.
 */
const columnBodies = new Map<string, Uint8Array<ArrayBuffer>>();

function columnBody(rows: number, start: number, last: number): Uint8Array<ArrayBuffer> {
  const key = `${rows}:${start}-${last}`;
  const stored = columnBodies.get(key);
  if (stored) return stored;
  const column = (Object.keys(FULL_CLOUD_COLUMNS) as FullCloudColumn[])
    .filter((name) => columnRange(name, rows, 0, 0).start <= start).pop()!;
  const { rowBytes } = FULL_CLOUD_COLUMNS[column];
  const first = (start - columnRange(column, rows, 0, 0).start) / rowBytes;
  const count = (last + 1 - start) / rowBytes;
  const body = columnBytes(column, Array.from({ length: count }, (_, offset) => rowAt(first + offset)));
  columnBodies.set(key, body);
  return body;
}

/**
 * A file of `rows` rows that is never allocated: each request builds only its
 * bytes, or reuses them from columnBodies. It answers like the CDN, or with one
 * deliberate fault.
 */
function virtualFile(rows: number, options: {
  fault?: "whole file" | "short" | "new etag on columns" | "wrong range";
  contentRange?: boolean;
  header?: Partial<HeaderFields>;
} = {}) {
  const header = headerBytes({ rows, ...options.header });
  const requests: string[] = [];
  const cancelled = vi.fn();
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("Range")!;
    requests.push(range);
    const [start, last] = /^bytes=(\d+)-(\d+)$/.exec(range)!.slice(1).map(Number);
    if (options.fault === "whole file") {
      const body = new ReadableStream({ pull: (controller) => controller.enqueue(new Uint8Array(65536)), cancel: cancelled });
      return new Response(body, { status: 200, headers: { ETag: '"one"' } });
    }
    let body = start === 0 ? header.slice(0, last + 1) : columnBody(rows, start, last);
    if (options.fault === "short" && start > 0) body = body.slice(1);
    const etag = options.fault === "new etag on columns" && start > 0 ? '"two"' : '"one"';
    const headers: Record<string, string> = { ETag: etag };
    if (options.contentRange !== false) {
      const shownStart = options.fault === "wrong range" && start > 0 ? start + 1 : start;
      headers["Content-Range"] = `bytes ${shownStart}-${last}/${fullCloudBytes(rows)}`;
    }
    return new Response(body, { status: 206, headers });
  }) as typeof fetch;
  return { fetcher, requests, cancelled };
}

describe("ATF2 byte arithmetic", () => {
  it("places each column as the contract's table does", () => {
    const rows = 1000;
    const starts = Object.fromEntries((Object.keys(FULL_CLOUD_COLUMNS) as FullCloudColumn[]).map((column) => [column, columnRange(column, rows, 0, rows).start]));
    expect(starts).toEqual({ codes: 128, norms: 6128, imageIds: 8128, slots: 16128, ranks: 18128, publicPreview: 19128, gates: 20128 });
    expect(fullCloudBytes(rows)).toBe(22128);
    const prefix = (Object.keys(FULL_CLOUD_COLUMNS) as FullCloudColumn[]).reduce((sum, column) => sum + columnRange(column, 200_000, 0, FULL_CLOUD_PREFIX_ROWS).length, 0);
    expect(prefix).toBe(1_441_792);
  });

  it("keeps offsets exact past 4 GiB for the largest file", () => {
    const rows = 200_777_690;
    expect(fullCloudBytes(rows)).toBe(4_417_109_308);
    // The producer's check reads the last 32 bytes: the final sixteen gates.
    expect(columnRange("gates", rows, rows - 16, rows)).toEqual({ start: 4_417_109_276, length: 32 });
    expect(columnRange("imageIds", rows, rows - 1, rows)).toEqual({ start: 128 + 16 * rows - 8, length: 8 });
    expect(columnRange("gates", rows, rows - 16, rows).start).toBeGreaterThan(2 ** 32);
  });

  it("reads rows above 4 GiB from a synthetic header without allocating the file", async () => {
    const rows = 200_777_690;
    const { fetcher, requests } = virtualFile(rows);
    const { header, file } = await openFullCloud(fetcher, "https://library.example/7125.bin", 7125);
    expect(header).toMatchObject({ block: 7125, rows, pictures: rows / 2, gateMedian: 0.75, maximumNorm: 2.5 });
    const loaded = await readFullCloudRows(fetcher, file, rows - 10, rows);
    expect(requests[0]).toBe("bytes=0-127");
    expect(requests).toContain("bytes=4417109288-4417109307");
    for (let offset = 0; offset < 10; offset++) {
      const row = rowAt(rows - 10 + offset);
      expect(cloudPoint(loaded, offset)).toMatchObject({
        code: row.code, imageId: row.imageId, slot: row.slot, winnerRank: row.rank, publicPreview: row.publicPreview === 1, gate: row.gate,
      });
    }
  });
});

describe("ATF2 decoding", () => {
  it("decodes every binary16 pattern as the platform does", () => {
    const bits = new Uint16Array(65536).map((_, index) => index);
    const reference = new (globalThis as unknown as { Float16Array: new (buffer: ArrayBuffer) => ArrayLike<number> }).Float16Array(bits.buffer);
    const different = bits.filter((index) => !Object.is(float16(index), reference[index]) && !(Number.isNaN(float16(index)) && Number.isNaN(reference[index])));
    expect(different).toHaveLength(0);
  });

  it("reads a column the same way with and without the platform's Float16Array", () => {
    const bits = new Uint16Array(65536).map((_, index) => index);
    const native = float16Column(bits.buffer);
    const scalar = float16Column(bits.buffer, null);
    const same = (a: number, b: number) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
    expect(native.constructor.name).toBe("Float16Array");
    expect(bits.filter((index) => !same(native[index], scalar[index]))).toHaveLength(0);
  });

  it("bounds float16 rounding of FP32 values and of a stored norm", () => {
    let seed = 1;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    let tightest = 0;
    for (let trial = 0; trial < 20000; trial++) {
      const value = Math.fround((random() - 0.5) * 2 ** (40 * random() - 30));
      expect(Math.abs(f16round(value) - value)).toBeLessThanOrEqual(float16Tolerance(value));
      tightest = Math.max(tightest, Math.abs(f16round(value) - value) / float16Tolerance(value));
      const code = [0, 1, 2].map(() => Math.fround((random() - 0.5) * 2 ** (12 * random() - 6)));
      const stored = code.map(f16round);
      expect(storedNormAgrees(stored, f16round(Math.fround(Math.hypot(...code))))).toBe(true);
    }
    // The bound is the half-unit of the last place, not a loose margin.
    expect(tightest).toBeGreaterThan(0.99);
    expect(storedNormAgrees([3, 4, 0], 5 * 1.003)).toBe(false);
  });

  it("validates the header once at the file boundary", () => {
    expect(decodeFullCloudHeader(headerBytes({ rows: 824, block: 12016 }).buffer as ArrayBuffer)).toMatchObject({ block: 12016, rows: 824, publicRows: 824 });
    const invalid: Array<Partial<HeaderFields>> = [
      { block: 16384 }, { publicRows: 825 }, { seed: 1 }, { pictures: 0 }, { picturePatches: 257 },
      { maximumNorm: 0 }, { reserved: 1 }, { axes: [[1, 0, 0], [0.1, 1, 0], [0, 0, 1]] },
    ];
    for (const fields of invalid) expect(() => decodeFullCloudHeader(headerBytes({ rows: 824, ...fields }).buffer as ArrayBuffer)).toThrow("invalid");
    const wrongSignature = headerBytes({ rows: 824 });
    wrongSignature[3] = "1".charCodeAt(0);
    expect(() => decodeFullCloudHeader(wrongSignature.buffer as ArrayBuffer)).toThrow("signature");
  });

  it("rejects a row whose norm or address is not possible", () => {
    const rows = [rowAt(0), rowAt(1)];
    const bodies = () => Object.fromEntries((Object.keys(FULL_CLOUD_COLUMNS) as FullCloudColumn[])
      .map((column) => [column, columnBytes(column, rows).buffer])) as Record<FullCloudColumn, ArrayBuffer>;
    expect(decodeFullCloudRows(bodies(), 2).count).toBe(2);
    const misaligned = bodies();
    new DataView(misaligned.norms).setUint16(2, halfBits([9])[0], true);
    expect(() => decodeFullCloudRows(misaligned, 2)).toThrow("response magnitude");
    for (const [column, offset, value] of [["slots", 2, 261], ["ranks", 1, 33], ["publicPreview", 1, 2]] as const) {
      const broken = bodies();
      if (column === "slots") new DataView(broken.slots).setUint16(offset, value, true);
      else new DataView(broken[column]).setUint8(offset, value);
      expect(() => decodeFullCloudRows(broken, 2)).toThrow("source identity");
    }
    const unsafe = bodies();
    new DataView(unsafe.imageIds).setUint32(12, 2 ** 21, true);
    expect(() => decodeFullCloudRows(unsafe, 2)).toThrow("source identity");
  });
});

/** A whole v3 file: rows by stored norm, descending; field 76 holds the whole count. */
function strongestFile(wholeRows: number, options: { order?: "descending" | "ascending"; fileRows?: number } = {}) {
  const fileRows = options.fileRows ?? Math.min(1024, wholeRows);
  const rows = Array.from({ length: fileRows }, (_, index) => rowAt(index))
    .sort((a, b) => f16round(Math.hypot(...b.code)) - f16round(Math.hypot(...a.code)));
  if (options.order === "ascending") rows.reverse();
  const header = headerBytes({ rows: fileRows, version: 3, reserved: wholeRows, publicRows: wholeRows - 1, pictures: wholeRows - 2 });
  const parts = [header, ...(Object.keys(FULL_CLOUD_COLUMNS) as FullCloudColumn[]).map((column) => columnBytes(column, rows))];
  const file = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((offset, part) => (file.set(part, offset), offset + part.length), 0);
  return file;
}

describe("strongest rows, version 3", () => {
  const serve = (file: Uint8Array<ArrayBuffer>, status = 200) => (async () => new Response(file, { status })) as unknown as typeof fetch;

  it("reads field 12 as the rows in the file and field 76 as the whole count", async () => {
    const { header, rows } = (await readStrongestRows(serve(strongestFile(200_777_690)), "https://library.example/7125.bin", 7125))!;
    expect(header).toMatchObject({ version: 3, fileRows: 1024, rows: 200_777_690, publicRows: 200_777_689, pictures: 200_777_688 });
    expect(rows.count).toBe(1024);
    expect(rows.norms[0]).toBeGreaterThanOrEqual(rows.norms[1023]);
    const small = await readStrongestRows(serve(strongestFile(824)), "https://library.example/7125.bin", 7125);
    expect(small!.header).toMatchObject({ fileRows: 824, rows: 824 });
  });

  it("rejects a wrong row count, order, length or answer, and a v3 file as a full cloud", async () => {
    const url = "https://library.example/7125.bin";
    await expect(readStrongestRows(serve(strongestFile(5000, { fileRows: 1000 })), url, 7125)).rejects.toThrow("strongest row count");
    await expect(readStrongestRows(serve(strongestFile(5000, { order: "ascending" })), url, 7125)).rejects.toThrow("descending");
    await expect(readStrongestRows(serve(strongestFile(5000).slice(0, -1)), url, 7125)).rejects.toThrow("length");
    await expect(readStrongestRows(serve(strongestFile(5000), 500), url, 7125)).rejects.toThrow("500");
    await expect(readStrongestRows(serve(strongestFile(5000), 404), url, 7125)).resolves.toBeNull();
    await expect(readStrongestRows(serve(strongestFile(5000)), url, 12)).rejects.toThrow("basis group 7125");
    const asRanges = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const [start, last] = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")!)!.slice(1).map(Number);
      return new Response(strongestFile(5000).slice(start, last + 1), { status: 206 });
    }) as typeof fetch;
    await expect(openFullCloud(asRanges, url, 7125)).rejects.toThrow("version 3");
  });
});

describe("range responses", () => {
  const range = { start: 128, length: 6 };
  const expected = { etag: '"one"', fileBytes: 22128 };

  it("accepts only 206 with the same file and the requested bytes", () => {
    expect(rangeResponseProblem(new Response(null, { status: 206, headers: { ETag: '"one"', "Content-Range": "bytes 128-133/22128" } }), range, expected)).toBeNull();
    // The CDN does not expose Content-Range to browser JavaScript; ETag alone is still compared.
    expect(rangeResponseProblem(new Response(null, { status: 206, headers: { ETag: '"one"' } }), range, expected)).toBeNull();
    expect(rangeResponseProblem(new Response(null, { status: 200 }), range, expected)).toMatch("whole file");
    expect(rangeResponseProblem(new Response(null, { status: 416 }), range, expected)).toMatch("416");
    expect(rangeResponseProblem(new Response(null, { status: 206, headers: { ETag: '"two"' } }), range, expected)).toMatch("changed");
    expect(rangeResponseProblem(new Response(null, { status: 206, headers: { "Content-Range": "bytes 128-134/22128" } }), range, expected)).toMatch("different part");
    expect(rangeResponseProblem(new Response(null, { status: 206, headers: { "Content-Range": "bytes 128-133/22150" } }), range, expected)).toMatch("different part");
  });

  it("cancels a whole-file answer before reading its body", async () => {
    const { fetcher, requests, cancelled } = virtualFile(4096, { fault: "whole file" });
    await expect(openFullCloud(fetcher, "https://library.example/7125.bin", 7125)).rejects.toThrow("whole file");
    expect(requests).toEqual(["bytes=0-127"]);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it.each([
    ["short", "bytes instead of"],
    ["new etag on columns", "changed"],
    ["wrong range", "different part"],
  ] as const)("rejects a %s column read", async (fault, message) => {
    const { fetcher } = virtualFile(4096, { fault });
    const { file } = await openFullCloud(fetcher, "https://library.example/7125.bin", 7125);
    await expect(readFullCloudRows(fetcher, file, 0, 4096)).rejects.toThrow(message);
  });

  it("checks the file length from the header range when the browser can read it", async () => {
    const { fetcher } = virtualFile(4096, { header: { rows: 4095 } });
    await expect(openFullCloud(fetcher, "https://library.example/7125.bin", 7125)).rejects.toThrow("length");
  });
});

describe("the library's full cloud", () => {
  const sample = {
    format: 2, block: 7125, source: { release: "pass-003" },
    sampling: { filter: "public_preview", selected_rows: 1, source_block_rows: 200_777_690, public_preview_fraction: 0.5 },
    rows: [{ code: [3, 4, 0], norm: 5, image_id: 9, slot: 9, public_preview: true, winner_rank: 1, gate: 1 }],
  };
  const summary = { block: 7125, release: "pass-003", gate_median: 1, radius: { p50: 1.2 }, main_lobe: { direction: [1, 0, 0] }, patch_rows: 200_777_690 };

  async function library(file: ReturnType<typeof virtualFile>, strongest: Uint8Array<ArrayBuffer> | null = null) {
    const published = (await fixtureLibrary()).library;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/strongest/")) return strongest ? new Response(strongest) : new Response("missing", { status: 404 });
      if (String(url).endsWith(".bin")) return file.fetcher(url, init);
      return Response.json(String(url).includes("/summaries/") ? summary : sample);
    });
    return { library: new Library("https://library.example", { ...published.release, name: "pass-003" }, fetcher), fetcher };
  }

  it("reads the header, then a first prefix of 65,536 rows, then appends without renumbering", async () => {
    const file = virtualFile(100_000);
    const { library: client, fetcher } = await library(file);
    const cloud = await client.blockCloud(7125);
    expect(fetcher.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/full/"))).toEqual(Array(8).fill(`https://library.example/${FULL_CLOUDS_PATH}/7125.bin`));
    expect(cloud.strongest).toBeNull();
    expect(cloud.sample.count).toBe(1);
    expect(file.requests[0]).toBe("bytes=0-127");
    expect(file.requests).toHaveLength(8);
    expect(cloud).toMatchObject({ source: "full", canLoadMore: true, notice: null, whole: { rows: 100_000, maximumNorm: 2.5, gateMedian: 0.75 } });
    expect(cloud.rows.count).toBe(FULL_CLOUD_PREFIX_ROWS);
    const more = await client.loadMoreRows(cloud);
    expect(more).toMatchObject({ canLoadMore: false, rows: { count: 100_000 } });
    for (const index of [0, 1, FULL_CLOUD_PREFIX_ROWS - 1]) expect(cloudPoint(more.rows, index)).toEqual(cloudPoint(cloud.rows, index));
    expect(cloudPoint(more.rows, FULL_CLOUD_PREFIX_ROWS).imageId).toBe(rowAt(FULL_CLOUD_PREFIX_ROWS).imageId);
    expect(cloudPoint(more.rows, 99_999).imageId).toBe(rowAt(99_999).imageId);
    expect(file.requests).toHaveLength(15);
    expect(await client.loadMoreRows(more)).toBe(more);
  });

  it("opens on the header, the sample and the strongest rows, and the first prefix comes after them", async () => {
    const file = virtualFile(100_000);
    const { library: client } = await library(file, strongestFile(100_000));
    const initial = await client.initialBlockCloud(7125);
    expect(file.requests).toEqual(["bytes=0-127"]);
    expect(initial).toMatchObject({ source: "full", canLoadMore: true, notice: null, rows: { count: 0 }, strongest: { count: 1024 }, whole: { rows: 100_000 } });
    const cloud = await client.blockCloud(7125);
    // The header is read once: the cloud is the initial read with its first prefix appended, the same sample and strongest rows.
    expect(file.requests).toHaveLength(8);
    expect(cloud.rows.count).toBe(FULL_CLOUD_PREFIX_ROWS);
    expect(cloud.sample).toBe(initial.sample);
    expect(cloud.strongest).toBe(initial.strongest);
    expect(cloud.whole).toBe(initial.whole);
  });

  it("stops at the page's limit of loaded rows", async () => {
    const { library: client } = await library(virtualFile(1_000_000));
    let cloud = await client.blockCloud(7125);
    while (cloud.canLoadMore) cloud = await client.loadMoreRows(cloud);
    expect(cloud.rows.count).toBe(LOADED_ROWS_LIMIT);
  });

  it("falls back to the sample with a plain notice when the host sends the whole file", async () => {
    const file = virtualFile(200_777_690, { fault: "whole file" });
    const cloud = await (await library(file)).library.blockCloud(7125);
    expect(cloud).toMatchObject({ source: "sample", canLoadMore: false, file: null, whole: { rows: 200_777_690 } });
    expect(cloud.sample).toBe(cloud.rows);
    expect(cloud.notice).toBe("The full response set could not be read: The host sent the whole file instead of the requested part. This page shows the 1-point public sample.");
    expect(file.cancelled).toHaveBeenCalledOnce();
  });

  it("carries the strongest rows with either source, and survives a bad strongest file", async () => {
    const { library: full } = await library(virtualFile(100_000), strongestFile(100_000));
    const cloud = await full.blockCloud(7125);
    expect(cloud).toMatchObject({ source: "full", notice: null, strongest: { count: 1024 } });
    expect((await full.loadMoreRows(cloud)).strongest).toBe(cloud.strongest);
    const { library: fallback } = await library(virtualFile(200_777_690, { fault: "whole file" }), strongestFile(200_777_690));
    expect(await fallback.blockCloud(7125)).toMatchObject({ source: "sample", strongest: { count: 1024 } });
    const { library: unordered } = await library(virtualFile(100_000), strongestFile(100_000, { order: "ascending" }));
    expect(await unordered.blockCloud(7125)).toMatchObject({
      source: "full", strongest: null, notice: "The strongest patches could not be read: The strongest rows are not in descending order.",
    });
    const { library: other } = await library(virtualFile(100_000), strongestFile(99_999));
    expect(await other.blockCloud(7125)).toMatchObject({
      source: "full", strongest: null, notice: "The strongest patches could not be read: The file counts 99,999 patches, not 100,000.",
    });
  });

  // Two 70,000-row virtual files and a 65,536-row prefix decoded: about 2 s alone, past the
  // 5 s default when the whole suite runs in parallel on a loaded machine.
  it("keeps the loaded rows when a later prefix fails", { timeout: 20_000 }, async () => {
    const { library: client } = await library(virtualFile(70_000));
    const cloud = await client.blockCloud(7125);
    const broken = virtualFile(70_000, { fault: "new etag on columns" });
    const { library: other } = await library(broken);
    const stopped = await other.loadMoreRows(cloud);
    expect(stopped).toMatchObject({ source: "full", canLoadMore: false, rows: { count: FULL_CLOUD_PREFIX_ROWS } });
    // The same objects, not equal copies: a deep match walks all 65,536 rows for a weaker check.
    expect(stopped.rows).toBe(cloud.rows);
    expect(stopped.sample).toBe(cloud.sample);
    expect(stopped.notice).toBe("Loading stopped at 65,536 points: The file changed while it was being read.");
  });
});
