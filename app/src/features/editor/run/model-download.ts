// The first Play in a browser offers Load the model. Only Create starts the download;
// the dock offers Play after a load. The browser remembers a successful load, while
// the worker still checks for a usable WebGPU adapter. The fake engine needs neither.

import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";
import { modelLoaded, type RunState } from "./session";

/**
 * The download, rounded: 343 MB of DINOv3 and dictionary files in the pass-003 release
 * manifest, plus the 30 MB engine.
 */
export const MODEL_DOWNLOAD_MB = 370;

export const MODEL_LINE = fill(CREATE_TEXT.model.line, { mb: MODEL_DOWNLOAD_MB });

const LOADED_KEY = "dinodreamer.modelLoaded";

/** The storage the flag lives in; tests pass their own. */
export type FlagStore = Pick<Storage, "getItem" | "setItem">;

function localFlagStore(): FlagStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Whether the model was loaded in this browser before. Blocked storage counts as never: Canvas asks again. */
export function modelLoadedBefore(store: FlagStore | null = localFlagStore()): boolean {
  try {
    return store?.getItem(LOADED_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberModelLoaded(store: FlagStore | null = localFlagStore()): void {
  try {
    store?.setItem(LOADED_KEY, "1");
  } catch {
    // Blocked storage: the next visit asks again.
  }
}

/** What stands before a run: asking to load the model, a browser that cannot paint, or nothing. */
export type ModelGate = "ask" | "unsupported" | null;

/**
 * Without WebGPU (no navigator.gpu, or the worker found no adapter) nothing can run. A
 * browser that has not loaded the model, before this session asks the worker to load
 * it, asks first. Otherwise nothing stands before a run.
 */
export function modelGate(session: RunState, loadedBefore: boolean, hasWebGPU: boolean): ModelGate {
  if (!hasWebGPU || session.capabilities?.webgpu === false) return "unsupported";
  if (loadedBefore || session.loadSent || modelLoaded(session)) return null;
  return "ask";
}

/** navigator.gpu is there: the browser offers WebGPU. Whether it has an adapter only the worker's load finds out. */
export function browserHasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && navigator.gpu !== undefined;
}

/**
 * The gate for the run's engine (`engine` is RunHandle.engine). The fake engine
 * (?engine=fake, the fixture release) downloads nothing and needs no WebGPU, so nothing
 * stands before it and a check without a GPU can step it.
 */
export function runGate(engine: string, session: RunState, loadedBefore: boolean): ModelGate {
  if (engine === "fake") return null;
  return modelGate(session, loadedBefore, browserHasWebGPU());
}
