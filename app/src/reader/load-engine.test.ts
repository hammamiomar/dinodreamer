import { beforeEach, expect, it, vi } from "vitest";
import { loadReaderEngine } from "./load-engine";

interface MockRelease {
  dictionary: string;
  encoder: { path: string; bytes?: number }[];
  calibration: { path: string; bytes?: number };
}

interface MockIndex {
  dictionaryId: string;
  files: { firstBlock: number; blocks: number; path?: string; bytes?: number }[];
}

const { engine, download, state } = vi.hoisted(() => ({
  engine: {
    on_device_lost: vi.fn(), load_stem: vi.fn(), load_layer: vi.fn(),
    load_calibration: vi.fn(), load_reader_chunk: vi.fn(), free: vi.fn(),
  },
  download: vi.fn(),
  state: {
    release: null as unknown as MockRelease,
    index: null as unknown as MockIndex,
    cacheHits: 0,
  },
}));

vi.mock("dinodreamer-engine", () => ({ BrowserEngine: { create: async () => engine } }));
vi.mock("../app/engine-wasm", () => ({ initializeEngine: async () => {} }));
vi.mock("../synthesis/assets", () => ({
  fetchModelRelease: async () => state.release,
  AssetLoader: class {
    get cacheHits() {
      return state.cacheHits;
    }
    open = async () => {};
    bytes = download;
  },
}));
vi.mock("./assets", () => ({ decodeReaderIndex: () => state.index }));
const location = { baseUrl: "https://library.example/", manifestPath: "release.json" };

beforeEach(() => {
  vi.clearAllMocks();
  state.cacheHits = 0;
  state.release = {
    dictionary: "model/test/",
    encoder: Array.from({ length: 13 }, (_, layer) => ({ path: `layer-${layer}` })),
    calibration: { path: "calibration" },
  };
  state.index = {
    dictionaryId: "test",
    files: [{ firstBlock: 0, blocks: 16384 }],
  };
  download.mockImplementation(async (file: string | { path?: string }) => {
    if (typeof file === "string") return new TextEncoder().encode("{}");
    return new Uint8Array([1]);
  });
});

it("releases the engine when a later model download fails", async () => {
  const failure = new Error("Download interrupted");
  download.mockImplementation(async (file: string | { path?: string }) => {
    if (typeof file === "string") return new TextEncoder().encode("{}");
    if (file.path === "layer-2") throw failure;
    return new Uint8Array([1]);
  });
  await expect(loadReaderEngine(location, vi.fn(), vi.fn())).rejects.toBe(failure);
  expect(engine.free).toHaveBeenCalledTimes(1);
});

it("hands a successfully loaded engine to its owner without freeing it", async () => {
  const progress = vi.fn();
  const result = await loadReaderEngine(location, progress, vi.fn());
  expect(result.engine).toBe(engine);
  expect(engine.free).not.toHaveBeenCalled();
  // Falls back cleanly to file-count progress when manifest byte counts are omitted.
  expect(progress).toHaveBeenLastCalledWith("Loading the basis collection", 15, 15);
});

it("reports streaming byte and MB progress across encoder, calibration, and basis chunks when byte lengths are present", async () => {
  const MB = 1024 * 1024;
  state.release = {
    dictionary: "model/test/",
    encoder: [
      { path: "encoder-stem.safetensors", bytes: MB },
      { path: "encoder-layer-00.safetensors", bytes: 2 * MB },
      { path: "encoder-layer-01.safetensors", bytes: 2 * MB },
    ],
    calibration: { path: "calibration.safetensors", bytes: MB },
  };
  state.index = {
    dictionaryId: "test",
    files: [
      { firstBlock: 0, blocks: 8192, path: "model/test/chunk-0.bin", bytes: 2 * MB },
      { firstBlock: 8192, blocks: 8192, path: "model/test/chunk-1.bin", bytes: 2 * MB },
    ],
  };

  const totalBytes = 10 * MB;
  download.mockImplementation(async (file: string | { path?: string; bytes?: number }, onProgress?: (received: number) => void) => {
    if (typeof file === "string") return new TextEncoder().encode("{}");
    const size = file.bytes ?? 1;
    // Stream in 128 KB pieces to exercise throttling and mid-file byte progress.
    const step = 128 * 1024;
    for (let received = step; received <= size; received += step) {
      onProgress?.(received);
    }
    return new Uint8Array(size);
  });

  const events: { message: string; done: number; total: number }[] = [];
  await loadReaderEngine(location, (message, done, total) => events.push({ message, done, total }), vi.fn());

  expect(events[0]).toEqual({ message: "Starting WebGPU engine…", done: 0, total: totalBytes });
  expect(events.some((event) => event.message.startsWith("Downloading DINOv3 stem · ") && event.message.endsWith("/ 10.0 MB"))).toBe(true);
  expect(events.some((event) => event.message.startsWith("Downloading DINOv3 layer 1 of 2 · "))).toBe(true);
  expect(events.some((event) => event.message.startsWith("Downloading basis calibration · "))).toBe(true);
  expect(events.some((event) => event.message.startsWith("Loading 16,384 basis matrices (1/2) · "))).toBe(true);
  expect(events.at(-1)).toEqual({
    message: "Loading 16,384 basis matrices (2/2) · 10.0 / 10.0 MB",
    done: totalBytes,
    total: totalBytes,
  });

  // Monotonic byte progress and throttling (10 MB / 128 KB = 80 raw chunks should be throttled well below 80).
  for (let index = 1; index < events.length; index++) {
    expect(events[index]!.done).toBeGreaterThanOrEqual(events[index - 1]!.done);
    expect(events[index]!.total).toBe(totalBytes);
  }
  expect(events.length).toBeLessThan(60);
});

it("reports cached encoder copy wording when encoder files come from the local cache", async () => {
  const MB = 1024 * 1024;
  state.release = {
    dictionary: "model/test/",
    encoder: [
      { path: "encoder-stem.safetensors", bytes: MB },
      { path: "encoder-layer-00.safetensors", bytes: MB },
    ],
    calibration: { path: "calibration.safetensors", bytes: MB },
  };
  state.index = {
    dictionaryId: "test",
    files: [{ firstBlock: 0, blocks: 16384, path: "model/test/chunk-0.bin", bytes: MB }],
  };

  download.mockImplementation(async (file: string | { path?: string; bytes?: number }, onProgress?: (received: number) => void) => {
    if (typeof file === "string") return new TextEncoder().encode("{}");
    state.cacheHits++;
    const size = file.bytes ?? 1;
    onProgress?.(size);
    return new Uint8Array(size);
  });

  const messages: string[] = [];
  await loadReaderEngine(location, (message) => messages.push(message), vi.fn());
  expect(messages.some((message) => message.startsWith("Loading cached DINOv3 encoder ("))).toBe(true);
});
