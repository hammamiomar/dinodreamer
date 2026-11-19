// The release client: reads the immutable library files of one release.
//
// Recent decoded files share a bounded memory cache. Concurrent reads of a cached
// file share one request. A failed read is forgotten so the next call retries.
// The browser's HTTP cache keeps the bytes across reloads.

import { ADDRESS_ROW_BYTES, decodeAddressRow, type TokenAddress } from "./addresses";
import { decodeObservationRecord, ObservationBundle, RECORD_BYTES } from "./observations";
import type { ObservationRecord } from "./observations";
import {
  decodeBlockContributions,
  decodeBlockProvenance,
  decodeBlockRecord,
  decodeCatalog,
  decodeImageInfo,
  decodeProvenanceCategories,
  decodeRelease,
  decodeStrongestBlocks,
} from "./records";
import type {
  BlockContributions,
  BlockProvenance,
  BlockRecord,
  Catalog,
  ImageInfo,
  ProvenanceCategories,
  ProvenanceTable,
  Release,
  StrongestBlocks,
} from "./records";
import type { Token } from "../recipe";
import { decodeLookFixture, decodeLookSummary, LOOK_CLOUDS_PATH, type LookCloud } from "./look-cloud";
import { emptyRows, sampleBlockCloud, sampleRows, withNoticeLine, withStrongestRows, type BlockCloud, type StrongestRead } from "./block-cloud";
import {
  FULL_CLOUDS_PATH,
  fullBlockCloud,
  loadNextPrefix,
  openFullCloud,
  readStrongestRows,
  STRONGEST_CLOUDS_PATH,
} from "./full-cloud";
import { ATLAS_CLOUDS_PATH, decodeAtlasCloud, decodeAtlasIndex, decodeAtlasManifest, type AtlasCloud, type CloudAtlas } from "./atlas-cloud";

/**
 * Decoded files kept per session. An observation bundle is about 3.4 kB per
 * listed image, so a production bundle can reach 0.5 MB; this bounds a long
 * browse to tens of megabytes.
 */
const MAX_CACHED_FILES = 96;

export class LibraryReadError extends Error {
  readonly url: string;
  /** HTTP status, or null for a network or decode failure. */
  readonly status: number | null;

  constructor(url: string, status: number | null, message: string) {
    super(message);
    this.name = "LibraryReadError";
    this.url = url;
    this.status = status;
  }

  /** The file does not exist in this release, e.g. a block with no records. */
  get missing(): boolean {
    return this.status === 404 || this.status === 403;
  }
}

export interface LibraryLocation {
  /** ASSET_BASE_URL, without a trailing slash. */
  baseUrl: string;
  /** Release name, e.g. "pass-003": the manifest is releases/<name>.json. */
  release: string;
}

type Fetch = typeof fetch;

/** Reads the release manifest, then returns a client for that release's library. */
export async function openLibrary(location: LibraryLocation, fetcher: Fetch = fetch): Promise<Library> {
  const url = `${location.baseUrl}/releases/${location.release}.json`;
  const release = await readFile(fetcher, url, "json", decodeRelease);
  if (release.name !== location.release) {
    throw new LibraryReadError(url, null, `${url} describes release ${release.name}, not ${location.release}`);
  }
  return new Library(location.baseUrl, release, fetcher);
}

/**
 * The Atlas manifest and index. Their path does not depend on the release manifest, so the
 * Atlas route starts this read beside the release read instead of after it: one round trip
 * less before the first cards (165 ms on Fast 4G). Library.cloudAtlas checks the release.
 */
export function readCloudAtlasFiles(baseUrl: string, fetcher: Fetch = fetch): Promise<CloudAtlas> {
  const prefix = `${baseUrl}/${ATLAS_CLOUDS_PATH}`;
  return Promise.all([
    readFile(fetcher, `${prefix}/manifest.json`, "json", decodeAtlasManifest),
    readFile(fetcher, `${prefix}/index.bin`, "bytes", decodeAtlasIndex),
  ]).then(([manifest, entries]) => ({ manifest, entries }));
}

export class Library {
  readonly release: Release;
  private readonly readoutUrl: string;
  private readonly assetUrl: string;
  private readonly fetcher: Fetch;
  private readonly files = new Map<string, Promise<unknown>>();

  private readonly baseUrl: string;

  constructor(baseUrl: string, release: Release, fetcher: Fetch = fetch) {
    this.release = release;
    this.baseUrl = baseUrl;
    this.readoutUrl = `${baseUrl}/web/v2/readouts/${release.publicationId}`;
    this.assetUrl = `${baseUrl}/web/v2/assets/${release.assetId}`;
    this.fetcher = fetcher;
  }

  catalog(): Promise<Catalog> {
    return this.read(`${this.readoutUrl}/catalog.json`, "json", decodeCatalog);
  }

  block(block: number): Promise<BlockRecord> {
    return this.read(`${this.readoutUrl}/blocks/${block}.json`, "json", decodeBlockRecord);
  }

  /**
   * A small global index owns sorting; full fixtures are never part of Atlas I/O. `started`
   * is a read of the same files begun before the release was known (readCloudAtlasFiles).
   */
  cloudAtlas(started?: Promise<CloudAtlas>): Promise<CloudAtlas> {
    return this.remember("cloud-atlas", async () => {
      const { manifest, entries } = await (started ?? readCloudAtlasFiles(this.baseUrl, this.fetcher));
      if (manifest.release !== this.release.name || manifest.blocks !== entries.length) {
        throw new Error("The Index data does not match this release.");
      }
      return { manifest, entries };
    });
  }

  /** At most 2,796 bytes; shared by Index cards and block headers. */
  atlasCloud(block: number, priority?: RequestPriority): Promise<AtlasCloud> {
    return this.read(
      `${this.baseUrl}/${ATLAS_CLOUDS_PATH}/blocks/${block}.bin`,
      "bytes",
      (buffer) => {
        const cloud = decodeAtlasCloud(buffer);
        if (cloud.block !== block) throw new Error("The Index record belongs to another basis group.");
        return cloud;
      },
      priority,
    );
  }

  /** One public sample and summary per block. The normal cache also shares concurrent reads. */
  lookCloud(block: number): Promise<LookCloud> {
    return this.remember(`look:${block}`, async () => {
      const prefix = `${this.baseUrl}/${LOOK_CLOUDS_PATH}`;
      const [fixture, summary] = await Promise.all([
        this.read(`${prefix}/${block}.json`, "json", decodeLookFixture),
        this.read(`${prefix}/summaries/${block}.json`, "json", decodeLookSummary),
      ]);
      if (fixture.block !== block || summary.block !== block || fixture.release !== this.release.name || summary.release !== this.release.name) {
        throw new Error("The response set does not match this basis group and release.");
      }
      return { fixture, summary };
    });
  }

  /**
   * The block view's first read: the full file's header, with the public sample and the strongest
   * rows read beside it, and none of the full file's rows yet. These are about a third of the bytes
   * of the first prefix, and they are all the first screen needs (the number, the line, the Level 4
   * pictures); the view draws from them and then appends the prefix (blockCloud). The prefix comes
   * last in the view's order, so the rows it adds renumber nothing. When the header cannot be read,
   * the sample's rows, with a notice that says why.
   */
  initialBlockCloud(block: number): Promise<BlockCloud> {
    return this.remember(`block-cloud-initial:${block}`, async () => {
      const sample = this.lookCloud(block);
      const strongest = this.strongestRead(block);
      try {
        const { header, file } = await openFullCloud(this.fetcher, `${this.baseUrl}/${FULL_CLOUDS_PATH}/${block}.bin`, block);
        return withStrongestRows(fullBlockCloud(header, file, emptyRows(0), sampleRows(await sample)), await strongest);
      } catch (error) {
        return this.fallbackToSample(block, error);
      }
    });
  }

  /**
   * The block's cloud with the first prefix of the full file, at most 65,536 rows: the initial
   * read and its first rows. When the full file's ranges fail (a whole-file answer, a wrong length,
   * a changed file), the sample's rows, with a notice that says why.
   */
  blockCloud(block: number): Promise<BlockCloud> {
    return this.remember(`block-cloud:${block}`, async () => {
      const initial = await this.initialBlockCloud(block);
      if (initial.file === null) return initial;
      try {
        return await loadNextPrefix(this.fetcher, initial, initial.file);
      } catch (error) {
        return this.fallbackToSample(block, error);
      }
    });
  }

  /** The public sample in the full file's place, with the reason. */
  private async fallbackToSample(block: number, error: unknown): Promise<BlockCloud> {
    const sample = await this.lookCloud(block);
    const points = sample.fixture.points.length.toLocaleString("en");
    const fallback = sampleBlockCloud(sample, `The full response set could not be read: ${errorMessage(error)} This page shows the ${points}-point public sample.`);
    return withStrongestRows(fallback, await this.strongestRead(block));
  }

  /** Resolves, never rejects, so the page works without these rows. Read once per block. */
  private strongestRead(block: number): Promise<StrongestRead> {
    return this.remember(`strongest:${block}`, async () => {
      try {
        const read = await readStrongestRows(this.fetcher, `${this.baseUrl}/${STRONGEST_CLOUDS_PATH}/${block}.bin`, block);
        return read && { rows: read.rows, wholeRows: read.header.rows };
      } catch (error) {
        return { problem: errorMessage(error) };
      }
    });
  }

  /**
   * A basis group's strongest library patch with a public picture, from its strongest rows: the
   * picture the Train panel shows for a selected group. Null when the rows cannot be read.
   */
  async strongestPatch(block: number): Promise<{ imageId: number; slot: number } | null> {
    const read = await this.strongestRead(block);
    if (!read || "problem" in read) return null;
    const index = read.rows.publicPreview.indexOf(1);
    return index < 0 ? null : { imageId: read.rows.imageIds[index]!, slot: read.rows.slots[index]! };
  }

  /**
   * The public pictures of a basis group's strongest patches, each once, strongest first, at most
   * `count`: the research page's strip for a group. Empty when the rows cannot be read.
   */
  async strongestPictures(block: number, count: number): Promise<number[]> {
    const read = await this.strongestRead(block);
    if (!read || "problem" in read) return [];
    const pictures = new Set<number>();
    for (let index = 0; index < read.rows.imageIds.length && pictures.size < count; index++) {
      if (read.rows.publicPreview[index] === 1) pictures.add(read.rows.imageIds[index]!);
    }
    return [...pictures];
  }

  /** The next prefix after the loaded rows. A failure keeps the loaded rows and stops loading. */
  async loadMoreRows(cloud: BlockCloud): Promise<BlockCloud> {
    if (!cloud.canLoadMore || cloud.file === null) return cloud;
    try {
      return await loadNextPrefix(this.fetcher, cloud, cloud.file);
    } catch (error) {
      const loaded = cloud.rows.count.toLocaleString("en");
      return { ...cloud, canLoadMore: false, notice: withNoticeLine(cloud.notice, `Loading stopped at ${loaded} points: ${errorMessage(error)}`) };
    }
  }

  observations(block: number): Promise<ObservationBundle> {
    return this.read(`${this.readoutUrl}/observations/${block}.bin`, "bytes", (buffer) => new ObservationBundle(buffer, block));
  }

  /**
   * One picture's record of observations/<block>.bin, read alone with an HTTP range
   * request: 3,409 bytes where the whole bundle is about 260 kB. `row` is the
   * picture's index in the block record's `imageIds`, the order of the file. An
   * Atlas card that shows three pictures by direction needs three records, not the
   * bundle. A server that ignores the range sends the whole file; the record is
   * cut from it.
   */
  observationRecord(block: number, row: number): Promise<ObservationRecord> {
    const url = `${this.readoutUrl}/observations/${block}.bin`;
    return this.remember(`${url}#${row}`, () => readRecord(this.fetcher, url, row, block));
  }

  /**
   * The blocks where a picture responds most, strongest first. Null when the
   * release does not have these files yet; resolves to null when the release has
   * no file for this picture (the folder answers 404).
   */
  strongestBlocks(imageId: number): Promise<StrongestBlocks | null> | null {
    if (this.release.strongestBlocks === null) return null;
    const url = `${this.baseUrl}/${this.release.strongestBlocks.replace(/\/?$/, "/")}${imageId}.json`;
    const file = this.read(url, "json", (value) => {
      const file = decodeStrongestBlocks(value);
      if (file.imageId !== imageId) throw new Error(`the file describes image ${file.imageId}, not ${imageId}`);
      return file;
    });
    return file.catch((error: unknown) => {
      if (error instanceof LibraryReadError && error.status === 404) return null;
      throw error;
    });
  }

  /**
   * A token's address, its 32 blocks strongest first with its code in each: one 448-byte row
   * of addresses/<image_id>.bin, read alone with an HTTP range request. Null when the release
   * does not publish addresses yet. A server that ignores the range sends the whole file; the
   * row is cut from it.
   */
  tokenAddress(token: Token): Promise<TokenAddress> | null {
    if (this.release.addresses === null) return null;
    const url = `${this.baseUrl}/${this.release.addresses.replace(/\/?$/, "/")}${token.imageId}.bin`;
    return this.remember(`${url}#${token.slot}`, () => readAddressRow(this.fetcher, url, token));
  }

  /**
   * The block's provenance per role, about 500 bytes. Null when the release names
   * no provenance table. A block the table has no record of has no roles.
   */
  provenance(block: number): Promise<BlockProvenance> | null {
    const table = this.release.provenance;
    if (table === null) return null;
    return this.read(`${this.provenanceUrl(table)}${block}.json`, "json", (value) => {
      const file = decodeBlockProvenance(value);
      if (file.block !== block) throw new Error(`the file describes basis group ${file.block}, not ${block}`);
      return file;
    });
  }

  /**
   * Every block's response category per role, from the table's categories.json: about 16 kB,
   * 4 kB on the wire. Null when the release names no provenance table; it resolves to null when
   * the table has no such file (an older table, or a table before the file's upload).
   */
  provenanceCategories(): Promise<ProvenanceCategories | null> | null {
    const table = this.release.provenance;
    if (table === null) return null;
    const url = `${this.provenanceUrl(table)}categories.json`;
    // The file's absence is remembered as well, so a view asks the bucket once.
    return this.remember(url, () =>
      readFile(this.fetcher, url, "json", (value) => decodeProvenanceCategories(value, this.release.blocks)).catch((error: unknown) => {
        if (error instanceof LibraryReadError && error.missing) return null;
        throw error;
      }),
    );
  }

  /**
   * Each listed example's code as five vectors that add to it, by entry id, about 25 kB.
   * Null when the release names no contributions table.
   */
  contributions(block: number): Promise<BlockContributions> | null {
    const table = this.release.contributions;
    if (table === null) return null;
    return this.read(`${this.baseUrl}/${table.prefix.replace(/\/?$/, "/")}${block}.json`, "json", (value) => {
      const file = decodeBlockContributions(value);
      if (file.block !== block) throw new Error(`the file describes basis group ${file.block}, not ${block}`);
      return file;
    });
  }

  imageInfo(imageId: number): Promise<ImageInfo> {
    return this.read(`${this.assetUrl}/images/${imageId}.json`, "json", decodeImageInfo);
  }

  /** The exact 256 × 256 prepared view, lossless. The block inspector and the editor's references use it. */
  previewUrl(imageId: number): string {
    return `${this.assetUrl}/previews/${imageId}.png`;
  }

  /**
   * A 256 px WebP of the same view, about a tenth of the bytes, for lists of many
   * images (Atlas cards, block example lists). Not exact; it may be missing for
   * some images, so a view that shows it falls back to `previewUrl`.
   */
  thumbnailUrl(imageId: number): string {
    return `${this.assetUrl}/thumbs/${imageId}.webp`;
  }

  /** The table's folder as a URL, ending in a slash. */
  private provenanceUrl(table: ProvenanceTable): string {
    return `${this.baseUrl}/${table.prefix.replace(/\/?$/, "/")}`;
  }

  private read<T>(url: string, kind: "json", decode: (value: unknown) => T): Promise<T>;
  private read<T>(url: string, kind: "bytes", decode: (value: ArrayBuffer) => T, priority?: RequestPriority): Promise<T>;
  private read<T>(url: string, kind: "json" | "bytes", decode: (value: never) => T, priority?: RequestPriority): Promise<T> {
    return this.remember(url, () => readFile(this.fetcher, url, kind, decode, priority));
  }

  /** The decoded file under `key`, loaded once; a failed load is forgotten so the next call retries. */
  private remember<T>(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.files.get(key);
    if (cached) {
      // Refresh the entry's position so the oldest unused file is evicted first.
      this.files.delete(key);
      this.files.set(key, cached);
      return cached as Promise<T>;
    }
    const pending = load();
    this.files.set(key, pending);
    pending.catch(() => {
      if (this.files.get(key) === pending) this.files.delete(key);
    });
    if (this.files.size > MAX_CACHED_FILES) {
      const oldest = this.files.keys().next().value!;
      this.files.delete(oldest);
    }
    return pending;
  }
}

/** One record of an observation bundle by a range request (Library.observationRecord). */
async function readRecord(fetcher: Fetch, url: string, row: number, block: number): Promise<ObservationRecord> {
  const body = await readRange(fetcher, url, row * RECORD_BYTES, RECORD_BYTES);
  try {
    return decodeObservationRecord(body, block);
  } catch (error) {
    throw new LibraryReadError(url, null, `${url}, record ${row}: ${errorMessage(error)}`);
  }
}

/** One token's row of an address file by a range request (Library.tokenAddress). */
async function readAddressRow(fetcher: Fetch, url: string, token: Token): Promise<TokenAddress> {
  const start = token.slot * ADDRESS_ROW_BYTES;
  const body = await readRange(fetcher, url, start, ADDRESS_ROW_BYTES);
  try {
    return decodeAddressRow(body, token);
  } catch (error) {
    throw new LibraryReadError(url, null, `${url}, slot ${token.slot}: ${errorMessage(error)}`);
  }
}

/** `length` bytes from `start`: the 206 body, or that slice of a whole file sent with 200. */
async function readRange(fetcher: Fetch, url: string, start: number, length: number): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
  } catch (error) {
    throw new LibraryReadError(url, null, `could not reach ${url}: ${errorMessage(error)}`);
  }
  if (!response.ok) throw new LibraryReadError(url, response.status, `${url} answered ${response.status}`);
  const contentRange = response.headers.get("Content-Range");
  // Cross-origin hosts may hide this header. When exposed, it must identify the requested row.
  if (response.status === 206 && contentRange !== null) {
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange.trim());
    if (!match || Number(match[1]) !== start || Number(match[2]) !== start + length - 1) {
      await response.body?.cancel().catch(() => undefined);
      throw new LibraryReadError(url, response.status, `${url}: the host sent a different part of the file.`);
    }
  }
  try {
    const body = await response.arrayBuffer();
    return response.status === 206 ? body : body.slice(start, start + length);
  } catch (error) {
    throw new LibraryReadError(url, null, `${url}: ${errorMessage(error)}`);
  }
}

async function readFile<T>(fetcher: Fetch, url: string, kind: "json" | "bytes", decode: (value: never) => T, priority?: RequestPriority): Promise<T> {
  let response: Response;
  try {
    response = priority ? await fetcher(url, { priority }) : await fetcher(url);
  } catch (error) {
    throw new LibraryReadError(url, null, `could not reach ${url}: ${errorMessage(error)}`);
  }
  if (!response.ok) throw new LibraryReadError(url, response.status, `${url} answered ${response.status}`);
  try {
    const body = kind === "json" ? await response.json() : await response.arrayBuffer();
    return decode(body as never);
  } catch (error) {
    throw new LibraryReadError(url, null, `${url}: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
