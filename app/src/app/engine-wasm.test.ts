import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeEngine } from "./engine-wasm";

const initializeWasm = vi.hoisted(() => vi.fn());
vi.mock("dinodreamer-engine", () => ({ default: initializeWasm }));

describe("the engine's .wasm", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    initializeWasm.mockClear();
  });

  it("comes from the library bucket in a production build", async () => {
    vi.stubEnv("ASSET_BASE_URL", "https://library.computervision.vision");
    vi.stubEnv("ASSET_ENGINE_WASM", "app/e2eb988c1c0aa25f/dinodreamer_engine_bg.wasm");
    await initializeEngine();
    expect(initializeWasm).toHaveBeenCalledExactlyOnceWith({
      module_or_path: new URL("https://library.computervision.vision/app/e2eb988c1c0aa25f/dinodreamer_engine_bg.wasm"),
    });
  });

  it("is the file Vite bundles when the build names none", async () => {
    vi.stubEnv("ASSET_ENGINE_WASM", "");
    await initializeEngine();
    expect(initializeWasm).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  // A worker that called wasm-bindgen's init() itself would load the bundled file, which a
  // production build leaves out of the static assets.
  it("is instantiated through initializeEngine in every worker", () => {
    const sources = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
    });
    const root = join(import.meta.dirname, "..");
    const direct = sources(root).filter((path) => /import\s+init\b[^;]*from\s+"dinodreamer-engine"/.test(readFileSync(path, "utf8")));
    expect(direct.map((path) => path.slice(root.length + 1))).toEqual(["app/engine-wasm.ts"]);
  });
});
