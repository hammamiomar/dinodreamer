import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineWasmUrl } from "./engine-wasm";

describe("the engine's .wasm", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("comes from the library bucket in a production build", () => {
    vi.stubEnv("ASSET_BASE_URL", "https://library.computervision.vision");
    vi.stubEnv("ASSET_ENGINE_WASM", "app/e2eb988c1c0aa25f/dinodreamer_engine_bg.wasm");
    expect(engineWasmUrl()?.href).toBe("https://library.computervision.vision/app/e2eb988c1c0aa25f/dinodreamer_engine_bg.wasm");
  });

  it("is the file Vite bundles when the build names none", () => {
    vi.stubEnv("ASSET_ENGINE_WASM", "");
    expect(engineWasmUrl()).toBeUndefined();
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
