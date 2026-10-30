import { afterEach, describe, expect, test, vi } from "vitest";
import { AssetLoader, assetBase, blockPath, decodeModelRelease, fetchModelRelease, previewPath } from "./assets";

const encoder = "model/dinov3-vitb16-pretrain-lvd1689m/";
const dictionary = "model/monet-dtd-seed9-20261004-pass-003/";

function manifest() {
  const names = ["encoder-stem", ...Array.from({ length: 12 }, (_, layer) => `encoder-layer-${String(layer).padStart(2, "0")}`)];
  return {
    format: 1,
    release: "pass-003",
    library: { publication_id: "p", asset_id: "a" },
    model: {
      encoder,
      dictionary,
      files: [
        ...names.map((name) => ({ path: `${encoder}${name}.safetensors`, bytes: 4, sha256: "x" })),
        { path: `${dictionary}calibration.safetensors`, bytes: 4, sha256: "x" },
      ],
      blocks: 16384,
      rank: 3,
      image_size: 256,
      grid: 16,
    },
    licenses: [],
  };
}

function cacheWith(response: Response | undefined, deleted: string[] = []) {
  vi.stubGlobal("caches", {
    open: async () => ({
      keys: async () => [],
      match: async () => response?.clone(),
      delete: async (url: string) => deleted.push(url),
      put: async () => undefined,
    }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("release manifest", () => {
  test("names the encoder files in load order and the calibration", () => {
    const release = decodeModelRelease(manifest());
    expect(release.encoder.map((file) => file.path.slice(encoder.length))).toEqual([
      "encoder-stem.safetensors",
      ...Array.from({ length: 12 }, (_, layer) => `encoder-layer-${String(layer).padStart(2, "0")}.safetensors`),
    ]);
    expect(release.calibration.path).toBe(`${dictionary}calibration.safetensors`);
    expect(blockPath(release, 100)).toBe(`${dictionary}blocks/00100.safetensors`);
    expect(previewPath(release, 9007199254740991)).toBe("web/v2/assets/a/previews/9007199254740991.png");
    expect(() => blockPath(release, 16384)).toThrow();
  });

  test("refuses a manifest without the layer files", () => {
    const broken = manifest();
    broken.model.files = broken.model.files.slice(1);
    expect(() => decodeModelRelease(broken)).toThrow(/encoder-stem/);
  });
});

describe("asset base", () => {
  // The worker's own location, as the dev server serves it.
  const worker = "http://127.0.0.1:5331/src/synthesis/engine.worker.ts?worker_file&type=module";

  test("an absolute base is used as it is, as in production", () => {
    expect(assetBase("https://library.example/root", worker)).toBe("https://library.example/root/");
    expect(assetBase("https://library.example/root/", undefined)).toBe("https://library.example/root/");
  });

  test("a path base (pnpm develop:remote) resolves against the page or worker location", () => {
    expect(assetBase("/remote-library", worker)).toBe("http://127.0.0.1:5331/remote-library/");
  });

  test("the manifest and the files load from a path base", async () => {
    vi.stubGlobal("location", new URL(worker));
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(url);
      return url.endsWith(".json") ? Response.json(manifest()) : new Response(new Uint8Array([1]));
    });
    await fetchModelRelease({ baseUrl: "/remote-library", manifestPath: "releases/pass-003.json" });
    cacheWith(undefined);
    const loader = new AssetLoader("/remote-library");
    await loader.open();
    await loader.bytes("f.bin");
    expect(requested).toEqual(["http://127.0.0.1:5331/remote-library/releases/pass-003.json", "http://127.0.0.1:5331/remote-library/f.bin"]);
  });
});

describe("asset loader", () => {
  test("an accepted cached file makes no network request", async () => {
    cacheWith(new Response(new Uint8Array([1, 2, 3, 4])));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const loader = new AssetLoader("http://localhost/base");
    await loader.open();
    expect(await loader.bytes({ path: "model/x.safetensors", bytes: 4 })).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(fetch).not.toHaveBeenCalled();
    expect(loader.cacheHits).toBe(1);
  });

  test("a truncated cached file is evicted and fetched again", async () => {
    const deleted: string[] = [];
    cacheWith(new Response(new Uint8Array([1])), deleted);
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([5, 6])));
    const loader = new AssetLoader("http://localhost/base/");
    await loader.open();
    expect(await loader.bytes({ path: "f.bin", bytes: 2 })).toEqual(new Uint8Array([5, 6]));
    expect(deleted).toEqual(["http://localhost/base/f.bin"]);
  });

  test("a download that fails as a network error is retried once past the browser cache", async () => {
    // WebKit: a cached no-Origin answer poisons the URL for CORS fetches until a reload replaces it.
    cacheWith(undefined);
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.cache === "reload") return new Response(new Uint8Array([7, 8]));
      throw new TypeError("Load failed");
    });
    vi.stubGlobal("fetch", fetch);
    const loader = new AssetLoader("http://localhost/");
    await loader.open();
    expect(Array.from(await loader.bytes("previews/1.png"))).toEqual([7, 8]);
    expect(fetch.mock.calls.map(([, init]) => init?.cache)).toEqual([undefined, "reload"]);
  });

  test("when the reload fails too, the first error is reported as before", async () => {
    cacheWith(undefined);
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      throw new TypeError(init?.cache === "reload" ? "second failure" : "Load failed");
    });
    vi.stubGlobal("fetch", fetch);
    const loader = new AssetLoader("http://localhost/");
    await loader.open();
    await expect(loader.bytes("previews/1.png")).rejects.toThrow("Could not download previews/1.png: TypeError: Load failed");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("an HTTP error status is an answer and is not retried", async () => {
    cacheWith(undefined);
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const loader = new AssetLoader("http://localhost/");
    await loader.open();
    await expect(loader.bytes("previews/1.png")).rejects.toThrow("Could not load previews/1.png (404).");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("a download that does not match the release digest is refused", async () => {
    cacheWith(undefined);
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2])));
    const loader = new AssetLoader("http://localhost/");
    await loader.open();
    await expect(loader.bytes({ path: "f.bin", bytes: 2, sha256: "00" })).rejects.toThrow(/digest/);
  });

  test("a cache that fails while it is read falls back to one network request", async () => {
    vi.stubGlobal("caches", {
      open: async () => ({
        keys: async () => [],
        match: async () => Promise.reject(new Error("storage failed")),
        delete: async () => true,
        put: async () => undefined,
      }),
    });
    const fetch = vi.fn(async () => new Response(new Uint8Array([3, 4])));
    vi.stubGlobal("fetch", fetch);
    const loader = new AssetLoader("http://localhost/");
    await loader.open();
    expect(await loader.bytes({ path: "f.bin", bytes: 2 })).toEqual(new Uint8Array([3, 4]));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(loader.networkRequests).toBe(1);
  });

  test("an incomplete cached file whose eviction fails falls back to one network request", async () => {
    vi.stubGlobal("caches", {
      open: async () => ({
        keys: async () => [],
        match: async () => new Response(new Uint8Array([1])),
        delete: async () => Promise.reject(new Error("storage failed")),
        put: async () => undefined,
      }),
    });
    const fetch = vi.fn(async () => new Response(new Uint8Array([5, 6])));
    vi.stubGlobal("fetch", fetch);
    const loader = new AssetLoader("http://localhost/");
    await loader.open();
    expect(await loader.bytes({ path: "f.bin", bytes: 2 })).toEqual(new Uint8Array([5, 6]));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(loader.cacheHits).toBe(0);
  });

  test("unavailable browser storage does not prevent loading", async () => {
    vi.stubGlobal("caches", { open: async () => Promise.reject(new Error("blocked")) });
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([7])));
    const loader = new AssetLoader("http://localhost/");
    await loader.open();
    expect(await loader.bytes("block.safetensors")).toEqual(new Uint8Array([7]));
  });
});


describe("model cache retention", () => {
  const day = 24 * 60 * 60 * 1000;
  const storedAt = "x-dinodreamer-stored-at";

  test("open evicts old and undated copies without reading bodies, and keeps fresh copies", async () => {
    const now = Date.now();
    const bodyRead = vi.fn();
    const entry = (time?: number) => ({
      headers: new Headers(time === undefined ? {} : { [storedAt]: String(time) }),
      arrayBuffer: bodyRead,
    });
    const entries = new Map([
      ["https://library.example/old", entry(now - 14 * day - 1)],
      ["https://library.example/fresh", entry(now - day)],
      ["https://library.example/undated", entry()],
    ]);
    const cache = {
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      match: async (request: Request) => entries.get(request.url),
      delete: vi.fn(async (request: Request) => entries.delete(request.url)),
    };
    vi.stubGlobal("caches", { open: async () => cache });
    const loader = new AssetLoader("https://library.example/");
    await loader.open();
    expect([...entries.keys()]).toEqual(["https://library.example/fresh"]);
    expect(bodyRead).not.toHaveBeenCalled();
  });

  test("a download records its storage time and a later open reuses it without extending its life", async () => {
    const entries = new Map<string, Response>();
    const cache = {
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      match: async (request: Request | string) => entries.get(typeof request === "string" ? request : request.url)?.clone(),
      delete: async (request: Request) => entries.delete(request.url),
      put: vi.fn(async (url: string, response: Response) => { entries.set(url, response.clone()); }),
    };
    vi.stubGlobal("caches", { open: async () => cache });
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2])));
    vi.stubGlobal("fetch", fetch);
    const before = Date.now();
    const loader = new AssetLoader("https://library.example/");
    await loader.open();
    await loader.bytes("model.bin");
    const timestamp = Number(entries.get("https://library.example/model.bin")!.headers.get(storedAt));
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());
    const reopened = new AssetLoader("https://library.example/");
    await reopened.open();
    expect(await reopened.bytes("model.bin")).toEqual(new Uint8Array([1, 2]));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
});
