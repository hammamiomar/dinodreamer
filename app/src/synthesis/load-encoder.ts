// Shared WebAssembly and WebGPU encoder loader for synthesis, reader, and Train workers.
// Centralizes WASM initialization, transient adapter retry, dynamic encoder layer loading,
// and guaranteed engine.free() cleanup when loading fails after BrowserEngine.create().

import { BrowserEngine } from "dinodreamer-engine";
import { initializeEngine } from "../app/engine-wasm";
import { adapterUnavailable } from "../grow/protocol";
import { AssetLoader, fetchModelRelease, type ModelFile, type ModelRelease } from "./assets";
import type { ReleaseLocation } from "./protocol";

const ADAPTER_RETRIES = 2;
const ADAPTER_RETRY_MS = 1500;

export interface EncoderEngine {
  on_device_lost(callback: (message: string) => void): void;
  load_stem(bytes: Uint8Array): void;
  load_layer(index: number, bytes: Uint8Array): void;
  load_calibration(bytes: Uint8Array): void;
  free(): void;
}

export interface EncoderFileEvent {
  file: ModelFile;
  /** Zero-based index across [...release.encoder, release.calibration]. */
  index: number;
  files: number;
  kind: "stem" | "layer" | "calibration";
  receivedBytes: number;
  totalBytes: number;
  cacheHits: number;
}

export interface LoadEncoderOptions<TEngine extends EncoderEngine = BrowserEngine> {
  location?: ReleaseLocation;
  /** Pre-fetched model release; fetched from `location` when omitted. */
  release?: ModelRelease;
  /** Pre-opened asset loader; created and opened from `location.baseUrl` when omitted. */
  assets?: AssetLoader;
  onDeviceLost: (message: string) => void;
  onStage?: (stage: string) => void;
  onFileStart?: (event: EncoderFileEvent) => void;
  onFileProgress?: (event: EncoderFileEvent) => void;
  onFileLoaded?: (event: EncoderFileEvent) => void;
  /** Injectable hooks for unit tests. */
  initWasm?: () => Promise<void>;
  createEngine?: () => Promise<TEngine>;
  retryDelayMs?: number;
}

export interface LoadedEncoder<TEngine extends EncoderEngine = BrowserEngine> {
  engine: TEngine;
  release: ModelRelease;
  assets: AssetLoader;
}

/** Create the GPU engine, retrying transient adapter-unavailable errors. */
async function createEngineWithRetry<TEngine extends EncoderEngine>(
  create: () => Promise<TEngine>,
  retryDelayMs: number,
): Promise<TEngine> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await create();
    } catch (error) {
      if (attempt >= ADAPTER_RETRIES || !adapterUnavailable(String(error))) throw error;
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

/**
 * Initialize WASM, create a WebGPU engine, and load the encoder stem, all encoder layers
 * listed in `release.encoder`, and the calibration file. Frees the engine if any step after
 * creation throws.
 */
export async function loadEncoderEngine<TEngine extends EncoderEngine = BrowserEngine>(
  options: LoadEncoderOptions<TEngine>,
): Promise<LoadedEncoder<TEngine>> {
  const {
    location,
    onDeviceLost,
    onStage,
    onFileStart,
    onFileProgress,
    onFileLoaded,
    initWasm = () => initializeEngine().then(() => undefined),
    createEngine = () => BrowserEngine.create() as unknown as Promise<TEngine>,
    retryDelayMs = ADAPTER_RETRY_MS,
  } = options;

  let release = options.release;
  if (!release) {
    if (!location) throw new Error("A release or release location is required to load the encoder.");
    onStage?.("the release manifest");
    release = await fetchModelRelease(location);
  }

  let assets = options.assets;
  if (!assets) {
    if (!location) throw new Error("An asset loader or release location is required to load the encoder.");
    onStage?.("the asset cache");
    assets = new AssetLoader(location.baseUrl);
    await assets.open();
  }

  onStage?.("the engine module");
  await initWasm();

  onStage?.("the GPU device");
  const engine = await createEngineWithRetry(createEngine, retryDelayMs);

  try {
    engine.on_device_lost(onDeviceLost);
    const files = [...release.encoder, release.calibration];
    const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    let doneBytes = 0;

    for (const [index, file] of files.entries()) {
      const kind: EncoderFileEvent["kind"] = index === 0 ? "stem" : index < files.length - 1 ? "layer" : "calibration";
      const event = (receivedBytes: number): EncoderFileEvent => ({
        file,
        index,
        files: files.length,
        kind,
        receivedBytes,
        totalBytes,
        cacheHits: assets.cacheHits,
      });

      onStage?.(`the download of model file ${index + 1} of ${files.length} (${file.path})`);
      onFileStart?.(event(doneBytes));
      const bytes = await assets.bytes(
        file,
        onFileProgress ? (received) => onFileProgress(event(doneBytes + received)) : undefined,
      );

      onStage?.(`the engine's load of model file ${index + 1} of ${files.length} (${file.path})`);
      if (kind === "stem") engine.load_stem(bytes);
      else if (kind === "layer") engine.load_layer(index - 1, bytes);
      else engine.load_calibration(bytes);

      doneBytes += bytes.length;
      onFileLoaded?.(event(doneBytes));
    }

    return { engine, release, assets };
  } catch (error) {
    engine.free();
    throw error;
  }
}
