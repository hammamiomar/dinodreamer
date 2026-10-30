import { beforeEach, expect, it, vi } from "vitest";
import { loadReaderEngine } from "./load-engine";

const { engine, download } = vi.hoisted(() => ({
  engine: {
    on_device_lost: vi.fn(), load_stem: vi.fn(), load_layer: vi.fn(),
    load_calibration: vi.fn(), load_reader_chunk: vi.fn(), free: vi.fn(),
  },
  download: vi.fn(),
}));
vi.mock("dinodreamer-engine", () => ({ BrowserEngine: { create: async () => engine } }));
vi.mock("../app/engine-wasm", () => ({ initializeEngine: async () => {} }));
vi.mock("../synthesis/assets", () => ({
  fetchModelRelease: async () => ({ dictionary: "model/test/", encoder: Array.from({ length: 13 }, (_, layer) => ({ path: `layer-${layer}` })), calibration: { path: "calibration" } }),
  AssetLoader: class {
    open = async () => {};
    bytes = download;
  },
}));
vi.mock("./assets", () => ({ decodeReaderIndex: () => ({ dictionaryId: "test", files: [{ firstBlock: 0, blocks: 16384 }] }) }));
const location = { baseUrl: "https://library.example/", manifestPath: "release.json" };

beforeEach(() => {
  vi.clearAllMocks();
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
  const result = await loadReaderEngine(location, vi.fn(), vi.fn());
  expect(result.engine).toBe(engine);
  expect(engine.free).not.toHaveBeenCalled();
});
