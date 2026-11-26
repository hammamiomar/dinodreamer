import type { BrowserEngine } from "dinodreamer-engine";
import { AssetLoader, fetchModelRelease, type ModelRelease } from "../synthesis/assets";
import { loadEncoderEngine, type EncoderFileEvent } from "../synthesis/load-encoder";
import type { ReleaseLocation } from "../synthesis/protocol";
import { decodeReaderIndex } from "./assets";

export interface LoadedReader {
  engine: BrowserEngine;
  dictionaryId: string;
  release: ModelRelease;
  assets: AssetLoader;
}

const MEGABYTE = 1024 * 1024;
/** Minimum streaming byte delta between progress messages so the worker avoids flooding the main thread. */
const BYTE_PROGRESS_STEP = 256 * 1024;

function formatMegabytes(bytes: number): string {
  return (bytes / MEGABYTE).toFixed(1);
}

function sumKnownBytes(files: readonly { bytes?: number }[]): number {
  return files.reduce((sum, file) => sum + (Number.isFinite(file.bytes) ? file.bytes! : 0), 0);
}

function formatEncoderProgress(event: EncoderFileEvent, initialCacheHits: number, totalBytes: number): string {
  const receivedMb = formatMegabytes(event.receivedBytes);
  const totalMb = formatMegabytes(totalBytes);
  const encoderCacheHits = event.cacheHits - initialCacheHits;
  if (encoderCacheHits === event.index + 1) {
    return `Loading cached DINOv3 encoder (${receivedMb} / ${totalMb} MB)`;
  }
  if (event.kind === "stem") {
    return `Downloading DINOv3 stem · ${receivedMb} / ${totalMb} MB`;
  }
  if (event.kind === "layer") {
    return `Downloading DINOv3 layer ${event.index} of ${event.files - 2} · ${receivedMb} / ${totalMb} MB`;
  }
  return `Downloading basis calibration · ${receivedMb} / ${totalMb} MB`;
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

  const encoderBytes = sumKnownBytes([...release.encoder, release.calibration]);
  const dictBytes = sumKnownBytes(index.files);
  const totalBytes = encoderBytes + dictBytes;
  const trackBytes = totalBytes > 0;

  const totalFiles = release.encoder.length + 1 + index.files.length;
  let doneFiles = 0;
  const stepFile = (message: string) => progress(message, ++doneFiles, totalFiles);

  const initialCacheHits = Number.isFinite(assets.cacheHits) ? assets.cacheHits : 0;
  let encoderStarted = false;
  let lastReportedBytes = -1;
  let lastReportedMessage = "";
  const reportBytes = (message: string, bytes: number, force = false) => {
    const clamped = Math.min(totalBytes, Math.max(0, bytes));
    if (clamped === lastReportedBytes && message === lastReportedMessage) return;
    if (!force && lastReportedBytes >= 0 && clamped - lastReportedBytes < BYTE_PROGRESS_STEP) return;
    lastReportedBytes = clamped;
    lastReportedMessage = message;
    progress(message, clamped, totalBytes);
  };

  if (trackBytes) {
    reportBytes("Starting WebGPU engine…", 0, true);
  }

  const { engine } = await loadEncoderEngine({
    release,
    assets,
    onDeviceLost,
    onStage: trackBytes
      ? () => {
          if (!encoderStarted) reportBytes("Starting WebGPU engine…", 0, true);
        }
      : undefined,
    onFileStart: trackBytes
      ? (event) => {
          encoderStarted = true;
          reportBytes(formatEncoderProgress(event, initialCacheHits, totalBytes), event.receivedBytes, true);
        }
      : undefined,
    onFileProgress: trackBytes
      ? (event) => {
          reportBytes(formatEncoderProgress(event, initialCacheHits, totalBytes), event.receivedBytes, false);
        }
      : undefined,
    onFileLoaded: trackBytes
      ? (event) => {
          reportBytes(formatEncoderProgress(event, initialCacheHits, totalBytes), event.receivedBytes, true);
        }
      : (event) => stepFile(event.kind === "calibration" ? "Loading the basis collection" : "Loading the image analyzer"),
  });

  try {
    let dictDoneBytes = 0;
    for (const [chunkIdx, chunk] of index.files.entries()) {
      const chunkStart = encoderBytes + dictDoneBytes;
      const chunkMessage = (doneBytes: number) =>
        `Loading 16,384 basis matrices (${chunkIdx + 1}/${index.files.length}) · ${formatMegabytes(doneBytes)} / ${formatMegabytes(totalBytes)} MB`;

      if (trackBytes) {
        reportBytes(chunkMessage(chunkStart), chunkStart, true);
      }
      const chunkBytes = await assets.bytes(
        chunk,
        trackBytes ? (received) => reportBytes(chunkMessage(chunkStart + received), chunkStart + received, false) : undefined,
      );
      engine.load_reader_chunk(chunk.firstBlock, chunk.blocks, chunkBytes);

      if (trackBytes) {
        const chunkSize = Number.isFinite(chunk.bytes) && chunk.bytes > 0 ? chunk.bytes : chunkBytes.length;
        dictDoneBytes += chunkSize;
        reportBytes(chunkMessage(encoderBytes + dictDoneBytes), encoderBytes + dictDoneBytes, true);
      } else {
        stepFile("Loading the basis collection");
      }
    }
    return { engine, dictionaryId: index.dictionaryId, release, assets };
  } catch (error) {
    engine.free();
    throw error;
  }
}
