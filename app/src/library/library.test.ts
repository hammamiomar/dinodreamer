import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidToken } from "../recipe-parse";
import { FIXTURE_BASE as BASE, fixtureFetch, fixtureLibrary, fixtureProvenancePage } from "./fixture-library";
import { Library, LibraryReadError, openLibrary } from "./library";
import { ADDRESS_FILE_BYTES, ADDRESS_ROW_BYTES, encodeAddressRow } from "./addresses";
import { decodeObservationRecord, ObservationBundle, RECORD_BYTES, recordedCode, recordResponses } from "./observations";
import {
  decodeBlockContributions,
  decodeBlockProvenance,
  decodeProvenanceCategories,
  decodeProvenancePage,
  decodeRelease,
  decodeStrongestBlocks,
} from "./records";

const FIXTURES = join(import.meta.dirname, "../../fixtures");
const LARGEST_SAFE_IMAGE = 9007199254740991;

describe("release and catalog", () => {
  it("opens the release named in the manifest", async () => {
    const { library } = await fixtureLibrary();
    expect(library.release.name).toBe("fixture");
    expect(library.previewUrl(7)).toBe(`${BASE}/web/v2/assets/${library.release.assetId}/previews/7.png`);
    expect(library.thumbnailUrl(7)).toBe(`${BASE}/web/v2/assets/${library.release.assetId}/thumbs/7.webp`);
  });

  it("refuses a manifest for another release", async () => {
    const { fetcher } = fixtureFetch();
    const renamed: typeof fetch = async (input) =>
      String(input).endsWith("releases/pass-003.json") ? fetcher(`${BASE}/releases/fixture.json`) : fetcher(input);
    await expect(openLibrary({ baseUrl: BASE, release: "pass-003" }, renamed)).rejects.toThrow(/describes release fixture/);
  });

  it("decodes the catalog's per-role counts for every block", async () => {
    const { library } = await fixtureLibrary();
    const catalog = await library.catalog();
    expect(catalog.blocks).toBe(26);
    expect(catalog.publicationId).toBe(library.release.publicationId);
    for (const counts of Object.values(catalog.respondingImages)) expect(counts).toHaveLength(26);
  });
});

describe("block records and observations", () => {
  it("decodes examples, cloud points and exact 64-bit image ids", async () => {
    const { library } = await fixtureLibrary();
    const record = await library.block(6);
    expect(record.block).toBe(6);
    expect(record.examples.length).toBeGreaterThan(0);
    expect(record.cloud.length).toBeGreaterThan(0);
    expect([...record.examples.map((example) => example.token), ...record.cloud.map((point) => point.token)].every(isValidToken)).toBe(true);
    expect(record.imageIds).toContain(LARGEST_SAFE_IMAGE);
    expect(record.imageIds).toEqual([...record.imageIds].sort((a, b) => a - b));
  });

  it("indexes one record per listed image, in the block's image order", async () => {
    const { library } = await fixtureLibrary();
    for (const block of [0, 4, 6]) {
      const [record, bundle] = await Promise.all([library.block(block), library.observations(block)]);
      expect(bundle.imageIds).toEqual(record.imageIds);
      expect(bundle.record(LARGEST_SAFE_IMAGE)?.imageId).toBe(LARGEST_SAFE_IMAGE);
    }
  });

  it("derives the same float32 norms the producer wrote into atlas cards", async () => {
    const { library } = await fixtureLibrary();
    const pages = await Promise.all([fixtureProvenancePage(library, "patch", "context"), fixtureProvenancePage(library, "cls", "context")]);
    let compared = 0;
    for (const card of pages.flatMap((page) => page.cards).filter((card) => card.block < 8)) {
      const bundle = await library.observations(card.block);
      for (const example of card.examples) {
        const responses = recordResponses(bundle.record(example.imageId)!);
        // The producer writes nine significant digits: enough to round back to the same float32.
        expect(responses.norm.slice(5)).toEqual(example.patches.norm.map(Math.fround));
        expect(responses.gated.slice(5)).toEqual(example.patches.gated);
        expect(responses.norm.slice(0, 5)).toEqual(example.prefix.norm.map(Math.fround));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(10);
  });

  it("reads a recorded code that matches the block's cloud point for the same token", async () => {
    const { library } = await fixtureLibrary();
    const [record, bundle] = await Promise.all([library.block(6), library.observations(6)]);
    const point = record.cloud.find((candidate) => bundle.has(candidate.token.imageId))!;
    const code = recordedCode(bundle.record(point.token.imageId)!, point.token.slot);
    expect(code.map(Math.fround)).toEqual(point.code.map(Math.fround));
  });

  it("reads one record alone with a range request, the same record as the bundle's", async () => {
    const { fetcher } = fixtureFetch();
    const ranges: string[] = [];
    // A server that honours the range answers 206 with the record's bytes only.
    const ranged = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range");
      const whole = await fetcher(input);
      if (!range) return whole;
      ranges.push(range);
      const [start, end] = range.replace("bytes=", "").split("-").map(Number) as [number, number];
      return new Response((await whole.arrayBuffer()).slice(start, end + 1), { status: 206 });
    }) as typeof fetch;
    const library = new Library(BASE, (await openLibrary({ baseUrl: BASE, release: "fixture" }, fetcher)).release, ranged);
    const [record, bundle] = await Promise.all([library.block(6), library.observations(6)]);
    const row = record.imageIds.indexOf(LARGEST_SAFE_IMAGE);
    const alone = await library.observationRecord(6, row);
    expect(ranges).toEqual([`bytes=${row * RECORD_BYTES}-${(row + 1) * RECORD_BYTES - 1}`]);
    expect(alone).toEqual(bundle.record(LARGEST_SAFE_IMAGE));
    // A server that ignores the range sends the whole file; the record is cut from it.
    const { library: plain } = await fixtureLibrary();
    expect(await plain.observationRecord(6, row)).toEqual(bundle.record(LARGEST_SAFE_IMAGE));
  });

  it("refuses a record that is cut short or belongs to another block", async () => {
    const bytes = await readFile(join(FIXTURES, "web/v2/readouts", (await fixtureLibrary()).library.release.publicationId, "observations/1.bin"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(decodeObservationRecord(buffer.slice(0, RECORD_BYTES), 1).block).toBe(1);
    expect(() => decodeObservationRecord(buffer.slice(0, RECORD_BYTES - 1), 1)).toThrow(/not 3409/);
    expect(() => decodeObservationRecord(buffer.slice(0, RECORD_BYTES), 2)).toThrow(/belongs to basis group 1/);
  });

  it("refuses a bundle that is truncated or belongs to another block", async () => {
    const bytes = await readFile(join(FIXTURES, "web/v2/readouts", (await fixtureLibrary()).library.release.publicationId, "observations/1.bin"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(() => new ObservationBundle(buffer.slice(0, RECORD_BYTES + 5), 1)).toThrow(/whole number/);
    expect(() => new ObservationBundle(buffer, 2)).toThrow(/belongs to basis group 1/);
  });
});

describe("strongest blocks of a picture", () => {
  it("reads a picture's blocks, strongest first, and they agree with the observation records", async () => {
    const { library } = await fixtureLibrary();
    const file = (await library.strongestBlocks(LARGEST_SAFE_IMAGE))!;
    expect(file.imageId).toBe(LARGEST_SAFE_IMAGE);
    expect(file.blocks.length).toBeGreaterThan(0);
    const relative = file.blocks.map((entry) => entry.relative);
    expect(relative).toEqual([...relative].sort((a, b) => b - a));
    for (const entry of file.blocks) {
      expect(isValidToken(entry.token)).toBe(true);
      const record = (await library.observations(entry.block)).record(LARGEST_SAFE_IMAGE)!;
      expect(entry.code.map(Math.fround)).toEqual(recordedCode(record, entry.token.slot).map(Math.fround));
      // cells are where the block fires: the record's gated patch tokens.
      const gatedCells = [...record.gated_T.slice(5)].flatMap((gated, cell) => (gated ? [cell] : []));
      expect(entry.cells).toEqual(gatedCells);
    }
  });

  it("is null for a release without the files", async () => {
    const { library } = await fixtureLibrary();
    const without = new Library(BASE, { ...library.release, strongestBlocks: null });
    expect(without.strongestBlocks(LARGEST_SAFE_IMAGE)).toBeNull();
  });

  it("is null for a picture the release has no file for, and still fails on other errors", async () => {
    const { library } = await fixtureLibrary();
    await expect(library.strongestBlocks(1)).resolves.toBeNull();
    const busy = new Library(BASE, library.release, async () => new Response("busy", { status: 503 }));
    await expect(busy.strongestBlocks(LARGEST_SAFE_IMAGE)).rejects.toThrow(/answered 503/);
  });

  it("refuses an entry whose slot does not match its role", () => {
    const entry = { block: 1, role: "cls", slot: 7, code: [1, 2, 3], response: 3.7, relative: 1, cells: [] };
    expect(() => decodeStrongestBlocks({ format: 1, image_id: 5, ranked_by: "relative", blocks: [entry] })).toThrow(
      "strongest blocks.blocks[0]: slot 7 is not a cls slot",
    );
  });
});

describe("provenance", () => {
  it("reads the table the manifest names: its sample, its orders and their block counts", async () => {
    const { library } = await fixtureLibrary();
    const table = library.release.provenance!;
    expect(table.prefix).toMatch(/\/provenance\/[0-9a-f]{16}\/$/);
    expect(table).toMatchObject({ sampleImages: 8192, minWinningTokens: 20, nearRadius: 2 });
    expect(table.orders).toEqual(["context", "local", "neighbourhood", "surround", "global", "position"]);
    // A family order lists only blocks with a family; the context order lists every record.
    expect(table.blocks.patch).toEqual({ context: 23, local: 3, neighbourhood: 4, surround: 6, global: 3, position: 4 });
    expect(table.blocks.cls?.neighbourhood).toBe(0);
    expect(table.blocks.storage0).toBeUndefined();
  });

  it("reads a block's records per role, signed and unclamped, and no role for a block without a record", async () => {
    const { library } = await fixtureLibrary();
    const file = await library.provenance(0)!;
    expect(file.block).toBe(0);
    // Fewer than 100 sample tokens: the shares, but no family.
    expect(file.roles.patch).toMatchObject({ sampleTokens: 59, far: 0.727570713, local: -0.068529591, family: null });
    expect(file.roles.cls).toMatchObject({ sampleTokens: 43, family: null });
    expect((await library.provenance(4)!).roles.patch).toMatchObject({ sampleTokens: 1966, carried: -0.113518588, context: 1.07080495, family: "surround" });
    expect((await library.provenance(7)!).roles).toEqual({});
    // A position block carries its border fraction; a split pair names each other.
    expect((await library.provenance(8)!).roles.patch).toMatchObject({ family: "position", borderFraction: 0.872115135, splitPartner: null });
    expect((await library.provenance(5)!).roles.patch?.splitPartner).toBe(6);
    expect((await library.provenance(6)!).roles.patch?.splitPartner).toBe(5);
  });

  it("is null for a release without a table, or with a table in a format this app does not read", async () => {
    const { library } = await fixtureLibrary();
    const without = new Library(BASE, { ...library.release, provenance: null });
    expect(without.provenance(0)).toBeNull();
    const manifest = JSON.parse(await readFile(join(FIXTURES, "releases/fixture.json"), "utf8"));
    manifest.library.provenance.format = 2;
    expect(decodeRelease(manifest).provenance).toBeNull();
  });

  it("keeps the records of known roles, ignores unknown keys, and refuses a missing share", () => {
    const record = { sample_tokens: 20, carried: 1, self: 0, near: 0, far: 0, cls: 0, storage: 0, attention_bias: 0, mlp: 0, constant: 0, context: 0, local: 1, family: "local" };
    const file = decodeBlockProvenance({ format: 1, block: 3, roles: { patch: { ...record, head_profile: [1, 2] }, storage: record } });
    expect(Object.keys(file.roles)).toEqual(["patch"]);
    const { far: _far, ...withoutFar } = record;
    expect(() => decodeBlockProvenance({ format: 1, block: 3, roles: { patch: withoutFar } })).toThrow("provenance.roles.patch.far: expected a finite number");
    // No family: null or an absent key; a family a later table adds keeps its word.
    const { family: _family, ...withoutFamily } = record;
    expect(decodeBlockProvenance({ format: 1, block: 3, roles: { patch: { ...record, family: null } } }).roles.patch?.family).toBeNull();
    expect(decodeBlockProvenance({ format: 1, block: 3, roles: { patch: withoutFamily } }).roles.patch?.family).toBeNull();
    expect(decodeBlockProvenance({ format: 1, block: 3, roles: { patch: { ...record, family: "position" } } }).roles.patch?.family).toBe("position");
    // The fuller table's border fraction and split partner; no partner is null, or −1 in the research table.
    const fuller = (fields: object) => decodeBlockProvenance({ format: 1, block: 3, roles: { patch: { ...record, ...fields } } }).roles.patch!;
    expect(fuller({ border_fraction: 0.871, split_partner: 4584 })).toMatchObject({ borderFraction: 0.871, splitPartner: 4584 });
    expect(fuller({ split_partner: -1 }).splitPartner).toBeNull();
    expect(fuller({ split_partner: null, border_fraction: null })).toMatchObject({ borderFraction: null, splitPartner: null });
    expect(fuller({})).toMatchObject({ borderFraction: null, splitPartner: null });
  });

  it("reads every block's category from one file, once, with the same words as the blocks' own files", async () => {
    const { library, requests } = await fixtureLibrary();
    const categories = (await library.provenanceCategories()!)!;
    expect(categories).toMatchObject({ table: "be913f021c39735e", rule: "the table's family column" });
    const patch = categories.roles.patch!;
    // 0 has fewer than 100 sample tokens, 7 and 25 have no record: no category.
    for (const block of [0, 1, 2, 3, 4, 7, 8, 10, 25]) {
      expect(patch.get(block) ?? null).toBe((await library.provenance(block)!).roles.patch?.family ?? null);
    }
    expect(patch.size).toBe(20);
    await library.provenanceCategories();
    expect([...requests].filter(([url]) => url.endsWith("/categories.json")).map(([, count]) => count)).toEqual([1]);
  });

  it("has no categories without a table, or for a table without the file, and asks for a missing file once", async () => {
    const { library } = await fixtureLibrary();
    expect(new Library(BASE, { ...library.release, provenance: null }).provenanceCategories()).toBeNull();
    const { fetcher, requests } = fixtureFetch();
    const table = { ...library.release.provenance!, prefix: "web/v2/readouts/older/provenance/0000000000000000/" };
    const older = new Library(BASE, { ...library.release, provenance: table }, fetcher);
    expect(await older.provenanceCategories()).toBeNull();
    expect(await older.provenanceCategories()).toBeNull();
    expect([...requests.values()]).toEqual([1]);
  });

  it("refuses a categories file that does not name every block with a known letter", () => {
    const file = { format: 1, table: "t", rule: "r", letters: { L: "local", "-": null }, roles: { patch: "L-L" } };
    expect(decodeProvenanceCategories(file, 3).roles.patch).toEqual(new Map([[0, "local"], [2, "local"]]));
    expect(() => decodeProvenanceCategories(file, 4)).toThrow("3 letters for 4 blocks");
    expect(() => decodeProvenanceCategories({ ...file, roles: { patch: "LXL" } }, 3)).toThrow("block 1 has the letter X");
    expect(() => decodeProvenanceCategories({ ...file, format: 2 }, 3)).toThrow("unsupported format 2");
    // A role this app does not know is left out.
    expect(Object.keys(decodeProvenanceCategories({ ...file, roles: { patch: "L-L", storage: "LLL" } }, 3).roles)).toEqual(["patch"]);
  });

  it("refuses a page of another order", async () => {
    const { library } = await fixtureLibrary();
    const prefix = library.release.provenance!.prefix.replace(/\/?$/, "/");
    const surround = JSON.parse(await readFile(join(FIXTURES, prefix, "atlas/patch/surround/0.json"), "utf8"));
    expect(() => decodeProvenancePage(surround, "local")).toThrow(/in order surround, not local/);
  });
});

describe("token addresses", () => {
  const folder = "web/v2/readouts/p/addresses/";
  const token = { imageId: 6177164541157906, role: "patch" as const, slot: 189 };
  /** A whole address file: row r names blocks 10 r + 0 … 31, each with the code [r, rank, 1]. */
  function addressFile(): Uint8Array<ArrayBuffer> {
    const file = new Uint8Array(ADDRESS_FILE_BYTES);
    for (let slot = 0; slot < 261; slot++) {
      const row = encodeAddressRow(Array.from({ length: 32 }, (_, rank) => ({ block: slot * 10 + rank, code: [slot, rank, 1] as [number, number, number] })));
      file.set(row, slot * ADDRESS_ROW_BYTES);
    }
    return file;
  }

  it("reads the folder the manifest names, and none without the field", async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURES, "releases/fixture.json"), "utf8"));
    expect(decodeRelease(manifest).addresses).toBeNull();
    expect(decodeRelease({ ...manifest, library: { ...manifest.library, addresses: folder } }).addresses).toBe(folder);
    const { library } = await fixtureLibrary();
    expect(library.tokenAddress(token)).toBeNull();
  });

  it("reads one token's row with a range request, or cuts it from a whole file", async () => {
    const { library } = await fixtureLibrary();
    const file = addressFile();
    const ranges: string[] = [];
    const asked: string[] = [];
    const ranged = (async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(String(input));
      const range = new Headers(init?.headers).get("Range")!;
      ranges.push(range);
      const [start, end] = range.replace("bytes=", "").split("-").map(Number) as [number, number];
      return new Response(file.slice(start, end + 1), { status: 206 });
    }) as typeof fetch;
    const withAddresses = { ...library.release, addresses: folder };
    const address = await new Library(BASE, withAddresses, ranged).tokenAddress(token)!;
    expect(asked).toEqual([`${BASE}/${folder}6177164541157906.bin`]);
    expect(ranges).toEqual([`bytes=${189 * 448}-${190 * 448 - 1}`]);
    expect(address.token).toEqual(token);
    expect(address.blocks.map((entry) => entry.block)).toEqual(Array.from({ length: 32 }, (_, rank) => 1890 + rank));
    expect(address.blocks[3]!.code).toEqual([189, 3, 1]);
    const whole = (async () => new Response(file)) as typeof fetch;
    expect(await new Library(BASE, withAddresses, whole).tokenAddress(token)!).toEqual(address);
    const missing = (async () => new Response("missing", { status: 404 })) as typeof fetch;
    await expect(new Library(BASE, withAddresses, missing).tokenAddress(token)!).rejects.toThrow(/answered 404/);
  });
});

describe("contributions", () => {
  // Block 1836's strongest patch example in the table bfd9ea9ae773f9bb.
  const entry = {
    entry_id: 159862,
    vectors: [
      [-2.37763834, 1.50906372, -2.11845374],
      [1.44944572, -0.655615926, 1.87691569],
      [7.11920834, -1.27047324, 7.72578669],
      [-0.0397685096, 0.240078777, -0.140557021],
      [1.37485099, -0.551056921, -0.180166453],
    ],
    shares: [-0.314951599, 0.228884667, 1.01253963, -0.0136509128, 0.0871782154],
  };
  const table = { prefix: "web/v2/readouts/p/contributions/bfd9ea9ae773f9bb/", format: 1, parts: ["itself", "near", "far", "prefix", "constants"] };

  it("reads the table the manifest names, and no table in another format, with other parts or without the field", async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURES, "releases/fixture.json"), "utf8"));
    expect(decodeRelease(manifest).contributions).toBeNull();
    expect(decodeRelease({ ...manifest, library: { ...manifest.library, contributions: table } }).contributions).toEqual({ prefix: table.prefix });
    expect(decodeRelease({ ...manifest, library: { ...manifest.library, contributions: { ...table, format: 2 } } }).contributions).toBeNull();
    const otherParts = { ...table, parts: ["itself", "near", "far", "constants", "prefix"] };
    expect(decodeRelease({ ...manifest, library: { ...manifest.library, contributions: otherParts } }).contributions).toBeNull();
  });

  it("reads a block's file by entry id, five vectors that add to the code, and refuses a short one", () => {
    const file = decodeBlockContributions({ format: 1, block: 1836, entries: [entry] });
    const read = file.entries.get(159862)!;
    expect(read.vectors).toHaveLength(5);
    const code = read.vectors.reduce<number[]>((sum, vector) => sum.map((value, axis) => value + vector[axis]!), [0, 0, 0]);
    expect(code.map((value) => Number(value.toFixed(2)))).toEqual([7.53, -0.73, 7.16]);
    expect(read.shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 5);
    expect(() => decodeBlockContributions({ format: 1, block: 1836, entries: [{ ...entry, vectors: entry.vectors.slice(0, 4) }] })).toThrow(
      "contributions.entries[0].vectors: expected 5 vectors",
    );
    expect(() => decodeBlockContributions({ format: 1, block: 1836, entries: [{ ...entry, shares: [1, 0, 0, 0] }] })).toThrow("expected 5 shares");
  });

  it("reads a block's file from the table's folder, and nothing for a release without a table", async () => {
    const { library } = await fixtureLibrary();
    expect(library.contributions(1836)).toBeNull();
    const asked: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ format: 1, block: 1836, entries: [entry] }));
    }) as typeof fetch;
    const withTable = new Library(BASE, { ...library.release, contributions: { prefix: table.prefix } }, fetcher);
    expect((await withTable.contributions(1836))!.entries.get(159862)!.shares[2]).toBe(1.01253963);
    expect(asked).toEqual([`${BASE}/${table.prefix}1836.json`]);
    await expect(withTable.contributions(7)!).rejects.toThrow(/describes basis group 1836, not 7/);
  });
});

describe("reading and caching", () => {
  it("shares one request between concurrent reads of a file", async () => {
    const { library, requests } = await fixtureLibrary();
    const [first, second] = await Promise.all([library.block(1), library.block(1)]);
    expect(first).toBe(second);
    await library.block(1);
    expect(requests.get(`${BASE}/web/v2/readouts/${library.release.publicationId}/blocks/1.json`)).toBe(1);
  });

  it("reports a missing block and retries a failed read", async () => {
    const { fetcher } = fixtureFetch();
    let failNext = true;
    const flaky: typeof fetch = async (input) => {
      if (failNext && String(input).endsWith("blocks/2.json")) {
        failNext = false;
        throw new TypeError("network down");
      }
      return fetcher(input);
    };
    const library = new Library(BASE, (await openLibrary({ baseUrl: BASE, release: "fixture" }, fetcher)).release, flaky);
    const missing = await library.block(12).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(LibraryReadError);
    expect((missing as LibraryReadError).missing).toBe(true);
    await expect(library.block(2)).rejects.toThrow(/could not reach/);
    expect((await library.block(2)).block).toBe(2);
  });
});

it("rejects an observation from the wrong HTTP byte range even if the record itself is valid", async () => {
  const { library: original } = await fixtureLibrary();
  const bytes = await readFile(join(FIXTURES, "web/v2/readouts", original.release.publicationId, "observations/1.bin"));
  const wrongRange: typeof fetch = async () => new Response(bytes.subarray(0, RECORD_BYTES), {
    status: 206,
    headers: { "Content-Range": `bytes 0-${RECORD_BYTES - 1}/${bytes.length}` },
  });
  const library = new Library(BASE, original.release, wrongRange);
  await expect(library.observationRecord(1, 1)).rejects.toThrow("different part of the file");
});
