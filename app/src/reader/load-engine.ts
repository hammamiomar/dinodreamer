import type { BrowserEngine } from "dinodreamer-engine";
import { AssetLoader, fetchModelRelease, type ModelRelease } from "../synthesis/assets";
import { loadEncoderEngine } from "../synthesis/load-encoder";
import type { ReleaseLocation } from "../synthesis/protocol";
import { decodeReaderIndex } from "./assets";

export interface LoadedReader {
  engine: BrowserEngine;
  dictionaryId: string;
  release: ModelRelease;
  assets: AssetLoader;
}

/**
 * Create an engine loaded with the encoder, calibration, and all 16,384 dictionary frames
 * required to read a picture. Files flow through the asset cache, so subsequent loads
 * avoid network traffic.
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
  try {
    indexBytes = await assets.bytes(`${release.dictionary}reader.json`);
  } catch (error) {
    throw new Error(`The full basis collection for the response selector is unavailable. ${String(error)}`);
  }
  const index = decodeReaderIndex(JSON.parse(new TextDecoder().decode(indexBytes)), release);
  const total = release.encoder.length + 1 + index.files.length;
  let done = 0;
  const step = (message: string) => progress(message, ++done, total);
  const { engine } = await loadEncoderEngine({
    release,
    assets,
    onDeviceLost,
    onFileLoaded: (event) => step(event.kind === "calibration" ? "Loading the basis collection" : "Loading the image analyzer"),
  });
  try {
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
