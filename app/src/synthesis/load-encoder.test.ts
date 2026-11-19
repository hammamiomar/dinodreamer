import { describe, expect, it, vi } from "vitest";
import type { AssetLoader, ModelRelease } from "./assets";
import { loadEncoderEngine, type EncoderEngine } from "./load-encoder";

vi.mock("dinodreamer-engine", () => ({ BrowserEngine: { create: vi.fn() } }));
vi.mock("../app/engine-wasm", () => ({ initializeEngine: vi.fn(async () => {}) }));

function mockRelease(layers: number): ModelRelease {
  return {
    release: "test-release",
    assetId: "assets",
    encoder: [
      { path: "model/encoder-stem.safetensors", bytes: 4 },
      ...Array.from({ length: layers }, (_, layer) => ({
        path: `model/encoder-layer-${String(layer).padStart(2, "0")}.safetensors`,
        bytes: 4,
      })),
    ],
    calibration: { path: "model/calibration.safetensors", bytes: 4 },
    dictionary: "model/dict/",
    blocks: 16384,
  };
}

function mockEngine() {
  return {
    on_device_lost: vi.fn<EncoderEngine["on_device_lost"]>(),
    load_stem: vi.fn<EncoderEngine["load_stem"]>(),
    load_layer: vi.fn<EncoderEngine["load_layer"]>(),
    load_calibration: vi.fn<EncoderEngine["load_calibration"]>(),
    free: vi.fn<EncoderEngine["free"]>(),
  };
}

describe("loadEncoderEngine", () => {
  it("loads stem, all dynamic encoder layers, and calibration in order", async () => {
    const engine = mockEngine();
    const release = mockRelease(3);
    const loader = {
      cacheHits: 0,
      bytes: vi.fn(async (_file: unknown, onProgress?: (n: number) => void) => {
        loader.cacheHits++;
        onProgress?.(4);
        return new Uint8Array(4);
      }),
    };
    const assets = loader as unknown as AssetLoader;
    const loadedEvents: string[] = [];

    const result = await loadEncoderEngine({
      release,
      assets,
      onDeviceLost: vi.fn(),
      onFileLoaded: (event) =>
        loadedEvents.push(`${event.kind}:${event.index}:${event.receivedBytes}/${event.totalBytes}:hits=${event.cacheHits}`),
      initWasm: async () => {},
      createEngine: async () => engine,
      retryDelayMs: 0,
    });

    expect(result.engine).toBe(engine);
    expect(engine.load_stem).toHaveBeenCalledTimes(1);
    expect(engine.load_layer.mock.calls.map(([index]) => index)).toEqual([0, 1, 2]);
    expect(engine.load_calibration).toHaveBeenCalledTimes(1);
    expect(engine.free).not.toHaveBeenCalled();
    expect(loadedEvents).toEqual([
      "stem:0:4/20:hits=1",
      "layer:1:8/20:hits=2",
      "layer:2:12/20:hits=3",
      "layer:3:16/20:hits=4",
      "calibration:4:20/20:hits=5",
    ]);
  });

  it("retries transient adapter-unavailable errors before succeeding", async () => {
    const engine = mockEngine();
    let attempts = 0;
    const createEngine = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error("No adapter available: webgpu found no adapters");
      return engine;
    });
    const assets = { bytes: vi.fn(async () => new Uint8Array(4)) } as unknown as AssetLoader;

    const result = await loadEncoderEngine({
      release: mockRelease(1),
      assets,
      onDeviceLost: vi.fn(),
      initWasm: async () => {},
      createEngine,
      retryDelayMs: 0,
    });

    expect(result.engine).toBe(engine);
    expect(createEngine).toHaveBeenCalledTimes(3);
  });

  it("frees the created engine if downloading or loading a file fails", async () => {
    const engine = mockEngine();
    const failure = new Error("download failed");
    const assets = {
      bytes: vi.fn(async (file: { path: string }) => {
        if (file.path.includes("layer-01")) throw failure;
        return new Uint8Array(4);
      }),
    } as unknown as AssetLoader;

    await expect(
      loadEncoderEngine({
        release: mockRelease(2),
        assets,
        onDeviceLost: vi.fn(),
        initWasm: async () => {},
        createEngine: async () => engine,
        retryDelayMs: 0,
      }),
    ).rejects.toBe(failure);

    expect(engine.free).toHaveBeenCalledTimes(1);
  });
});
