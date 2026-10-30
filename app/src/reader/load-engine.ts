import { BrowserEngine } from "dinodreamer-engine";
import { initializeEngine } from "../app/engine-wasm";
import { AssetLoader, fetchModelRelease, type ModelRelease } from "../synthesis/assets";
import type { ReleaseLocation } from "../synthesis/protocol";
import { decodeReaderIndex } from "./assets";

export interface LoadedReader {
  engine: BrowserEngine;
  dictionaryId: string;
  release: ModelRelease;
  assets: AssetLoader;
}

/**
 * A fresh engine with the encoder, the calibration and all 16,384 dictionary frames: what reading a
 * picture needs (the picture page's reader worker, How's worker). Files come through the asset
 * cache, so a second load reads no network.
 */
export async function loadReaderEngine(
  location: ReleaseLocation,
  progress: (message: string, done: number, total: number) => void,
  onDeviceLost: (message: string) => void,
): Promise<LoadedReader> {
  const release = await fetchModelRelease(location);
  const assets = new AssetLoader(location.baseUrl);
  await assets.open();
  let indexBytes: Uint8Array;
  try { indexBytes = await assets.bytes(`${release.dictionary}reader.json`); }
  catch (error) { throw new Error(`The full basis collection for the response selector is unavailable. ${String(error)}`); }
  const index = decodeReaderIndex(JSON.parse(new TextDecoder().decode(indexBytes)), release);
  const total = release.encoder.length + 1 + index.files.length;
  let done = 0;
  const step = (message: string) => progress(message, ++done, total);
  await initializeEngine();
  const engine = await BrowserEngine.create();
  try {
    engine.on_device_lost(onDeviceLost);
    engine.load_stem(await assets.bytes(release.encoder[0]));
    step("Loading the image analyzer");
    for (let layer = 0; layer < 12; layer++) {
      engine.load_layer(layer, await assets.bytes(release.encoder[layer + 1]));
      step("Loading the image analyzer");
    }
    engine.load_calibration(await assets.bytes(release.calibration));
    step("Loading the basis collection");
    for (const chunk of index.files) {
      engine.load_reader_chunk(chunk.firstBlock, chunk.blocks, await assets.bytes(chunk));
      step("Loading the basis collection");
    }
    return { engine, dictionaryId: index.dictionaryId, release, assets };
  } catch (error) {
    engine.free();
    throw error;
  }
}
