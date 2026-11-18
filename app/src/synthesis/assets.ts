// The engine's view of a release: which model files to fetch, and a browser cache for them.
//
// Every path except releases/*.json is immutable, so a cached
// response is reused for at most 14 days without revalidation. Listed files are checked once, when they
// arrive from the network: byte length and SHA-256. A cache hit is checked by length only.

import type { ReleaseLocation } from "./protocol";

export interface ModelFile {
  path: string;
  bytes: number;
  sha256?: string;
}

/** The fields of releases/<name>.json that the engine reads. */
export interface ModelRelease {
  release: string;
  assetId: string;
  /** encoder-stem, then encoder-layer-00 … 11. */
  encoder: ModelFile[];
  calibration: ModelFile;
  /** e.g. "model/<dictionary_id>/" */
  dictionary: string;
  blocks: number;
}

const ENCODER_LAYERS = 12;
const CACHE_NAME = "dinodreamer-assets-v1";
const CACHE_STORED_AT = "x-dinodreamer-stored-at";
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function field<T>(value: unknown, name: string, check: (value: unknown) => value is T): T {
  if (!check(value)) throw new Error(`release manifest: ${name} is missing or malformed`);
  return value;
}

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Decode the manifest at its boundary; the worker then trusts these fields. */
export function decodeModelRelease(value: unknown): ModelRelease {
  const record = field(value, "manifest", isRecord);
  if (record.format !== 1) throw new Error(`release manifest: unsupported format ${String(record.format)}`);
  const library = field(record.library, "library", isRecord);
  const model = field(record.model, "model", isRecord);
  if (model.image_size !== 256 || model.grid !== 16 || model.rank !== 3) {
    throw new Error("release manifest: the engine needs 256 px images, a 16 × 16 grid and rank-3 basis groups");
  }
  const encoderPrefix = field(model.encoder, "model.encoder", isString);
  const dictionary = field(model.dictionary, "model.dictionary", isString);
  const files = field(model.files, "model.files", Array.isArray).map((entry, index) => {
    const file = field(entry, `model.files[${index}]`, isRecord);
    return {
      path: field(file.path, `model.files[${index}].path`, isString),
      bytes: field(file.bytes, `model.files[${index}].bytes`, isCount),
      sha256: field(file.sha256, `model.files[${index}].sha256`, isString),
    };
  });
  const named = (path: string) => {
    const file = files.find((entry) => entry.path === path);
    if (!file) throw new Error(`release manifest: ${path} is not listed`);
    return file;
  };
  const layers = Array.from({ length: ENCODER_LAYERS }, (_, layer) =>
    named(`${encoderPrefix}encoder-layer-${String(layer).padStart(2, "0")}.safetensors`),
  );
  return {
    release: field(record.release, "release", isString),
    assetId: field(library.asset_id, "library.asset_id", isString),
    encoder: [named(`${encoderPrefix}encoder-stem.safetensors`), ...layers],
    calibration: named(`${dictionary}calibration.safetensors`),
    dictionary,
    blocks: field(model.blocks, "model.blocks", isCount),
  };
}

export function blockPath(release: ModelRelease, block: number): string {
  if (!Number.isInteger(block) || block < 0 || block >= release.blocks) {
    throw new Error(`Basis group ${block} is not in release ${release.release}`);
  }
  return `${release.dictionary}blocks/${String(block).padStart(5, "0")}.safetensors`;
}

export function previewPath(release: ModelRelease, imageId: number): string {
  return `web/v2/assets/${release.assetId}/previews/${imageId}.png`;
}

export async function fetchModelRelease(location: ReleaseLocation): Promise<ModelRelease> {
  const url = new URL(location.manifestPath, assetBase(location.baseUrl)).href;
  const response = await fetch(url, { cache: "no-cache" }).catch((error: unknown) => {
    throw new Error(`The release manifest could not be downloaded from ${url}: ${describeFetchError(error)}`);
  });
  if (!response.ok) throw new Error(`The release manifest could not be read (${response.status}).`);
  return decodeModelRelease(await response.json());
}

/**
 * ASSET_BASE_URL as an absolute directory URL. Production sets an absolute URL; the dev
 * server's `pnpm develop:remote` sets a path (`/remote-library`), which resolves against the
 * page or worker that loads the files.
 */
export function assetBase(baseUrl: string, page: string | undefined = globalThis.location?.href): string {
  const directory = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(directory, page).href;
}

/**
 * A fetch that heals a poisoned cache entry once. WebKit's HTTP cache does not split entries
 * by CORS mode: when a page has loaded a library picture without an Origin header (a plain
 * <img>), the library's answer has no access-control-allow-origin, is immutable for a year,
 * and every later CORS fetch of that URL fails with "TypeError: Load failed". A request with
 * cache "reload" bypasses the entry and replaces it with the CORS answer. Only a TypeError
 * (a network or CORS failure) is retried; an HTTP status is an answer, not a failure. When the
 * retry fails too, the first error is the one reported.
 */
export async function fetchHealing(url: string): Promise<Response> {
  try {
    return await fetch(url);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return await fetch(url, { cache: "reload" }).catch(() => {
      throw error;
    });
  }
}

/** A fetch rejection with its name: Safari says only "TypeError: Load failed" for a blocked or failed request. */
function describeFetchError(error: unknown): string {
  if (error instanceof Error) return error.name === "Error" ? error.message : `${error.name}: ${error.message}`;
  return String(error);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A response body read chunk by chunk, telling `onProgress` the bytes received so far. A listed length
 * sizes the buffer once; more bytes than it lists are refused as they arrive.
 */
async function readCounting(body: ReadableStream<Uint8Array>, path: string, expected: number | undefined,
  onProgress: (received: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (expected !== undefined && received > expected) {
      await reader.cancel();
      throw new Error(`${path} is longer than the release lists. Retry loading.`);
    }
    chunks.push(value);
    onProgress(received);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Immutable release files through the Cache API. Unavailable storage only disables caching. */
export class AssetLoader {
  cacheHits = 0;
  networkRequests = 0;
  networkBytes = 0;
  private cache: Cache | undefined;
  private readonly base: string;

  constructor(baseUrl: string) {
    this.base = assetBase(baseUrl);
  }

  async open(): Promise<void> {
    try {
      const cache = await caches.open(CACHE_NAME);
      const now = Date.now();
      // Inspect headers only. Untimestamped copies predate the retention policy.
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (!response) continue;
        const storedAt = Number(response.headers.get(CACHE_STORED_AT));
        const age = now - storedAt;
        if (!Number.isFinite(storedAt) || storedAt <= 0 || age < 0 || age >= CACHE_MAX_AGE_MS) {
          await cache.delete(request);
        }
      }
      this.cache = cache;
    } catch {
      this.cache = undefined;
    }
  }

  /**
   * A listed file has a known length and digest; an unlisted one (a block, a preview) has neither.
   * `onProgress`, when given, hears the bytes received so far as a download arrives, and the whole
   * length at once for a cached copy; the length and digest are checked on the whole file as before.
   */
  async bytes(file: ModelFile | string, onProgress?: (received: number) => void): Promise<Uint8Array<ArrayBuffer>> {
    const { path, bytes: expected, sha256 } = typeof file === "string" ? { path: file, bytes: undefined, sha256: undefined } : file;
    const url = new URL(path, this.base).href;
    const cached = await this.cachedBytes(url, expected);
    if (cached) {
      this.cacheHits++;
      onProgress?.(cached.length);
      return cached;
    }
    this.networkRequests++;
    const response = await fetchHealing(url).catch((error: unknown) => {
      throw new Error(`Could not download ${path}: ${describeFetchError(error)}`);
    });
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
    const bytes = onProgress && response.body ? await readCounting(response.body, path, expected, onProgress) : new Uint8Array(await response.arrayBuffer());
    this.networkBytes += bytes.length;
    if (expected !== undefined && bytes.length !== expected) throw new Error(`${path} is incomplete. Retry loading.`);
    if (sha256 !== undefined && (await sha256Hex(bytes)) !== sha256) throw new Error(`${path} does not match the release digest.`);
    try {
      await this.cache?.put(url, new Response(bytes, {
        headers: { [CACHE_STORED_AT]: String(Date.now()) },
      }));
    } catch {
      this.cache = undefined; // Quota or storage failure: keep working without a cache.
    }
    return bytes;
  }

  /**
   * The cached copy when it is complete; none otherwise, after evicting an incomplete one.
   * Storage that fails while it is read or evicted is dropped for this loader, and the
   * file comes from the network with its usual checks.
   */
  private async cachedBytes(url: string, expected: number | undefined): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (!this.cache) return undefined;
    try {
      const cached = await this.cache.match(url);
      if (!cached) return undefined;
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (expected === undefined || bytes.length === expected) return bytes;
      await this.cache.delete(url);
      return undefined;
    } catch {
      this.cache = undefined;
      return undefined;
    }
  }
}
