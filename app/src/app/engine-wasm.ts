import init from "dinodreamer-engine";
import { assetBase } from "../synthesis/assets";

// Where every worker loads the engine's .wasm from. The file (about 40 MB) is too large for the
// app's static hosting (Workers assets stop at 25 MiB), so a production build names it in the
// library bucket: ASSET_ENGINE_WASM, relative to ASSET_BASE_URL, set by gallery/deploy.ts, which
// also keeps *.wasm out of the static assets. Without it (dev, fixtures) wasm-bindgen loads the
// file Vite bundles beside the worker.

/** The engine's .wasm in the library bucket, or undefined for the bundled file. */
export function engineWasmUrl(): URL | undefined {
  const env = import.meta.env as ImportMetaEnv & { ASSET_ENGINE_WASM?: string };
  return env.ASSET_ENGINE_WASM ? new URL(env.ASSET_ENGINE_WASM, assetBase(env.ASSET_BASE_URL)) : undefined;
}

/** Instantiate the engine module in this worker, from `engineWasmUrl`. */
export async function initializeEngine(): Promise<void> {
  const wasm = engineWasmUrl();
  await init(wasm ? { module_or_path: wasm } : undefined);
}
