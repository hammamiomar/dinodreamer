// The synthesis worker: owns the WASM engine, the GPU device, the applied recipe and the run loop.
//
// Commands are queued and run one at a time, between updates, so a mutable engine
// call never overlaps another. Running means: when the queue is empty, take one update.
// Pause, apply and every other command therefore wait for the in-flight update.

import { openLibrary, type Library } from "../library/library";
import { regionCodes, regionSource } from "../code-target";
import type { Code } from "../recipe";
import { BrowserEngine } from "dinodreamer-engine";
import { initializeEngine } from "../app/engine-wasm";
import { validateRecipe, type Recipe } from "../recipe";
import { AssetLoader, blockPath, fetchModelRelease, previewPath, type ModelRelease } from "./assets";
import { endsSession } from "./failure";
import {
  editableCells,
  foldAddressTerms,
  neededBlocks,
  neededImages,
  objectiveSpec,
  probeSpecs,
  sameEditable,
  sameObjective,
  sameProbes,
  type ObjectiveSpec,
  type ProbeSpec,
} from "./objective";
import { optimizerSpec, sameOptimizer, type OptimizerSpec } from "./objective";
import { transferables, type Command, type Event, type Phase, type ReleaseLocation, type TermMeasurement } from "./protocol";

/** What `BrowserEngine.step` and `measure` return; see engine/src/web.rs. */
interface Evaluation {
  step: number;
  views: number;
  ids: string[];
  weights: Float32Array;
  /** [terms, views] row-major. */
  raws: Float32Array;
  probes: { requestId: number; slots: Uint16Array; codes: Float32Array; errors: Float32Array; normalizers: Float32Array }[];
  pixels: Uint8ClampedArray;
  /** GPU memory-pool bytes after the update, when the backend reports them. */
  gpuUsedBytes?: number;
  gpuReservedBytes?: number;
}

interface Applied {
  revision: number;
  objective: ObjectiveSpec;
  probes: ProbeSpec[];
  editable: Uint8Array;
  /** The recipe's zoom per update, applied by the engine after every update. */
  zoomPerUpdate: number;
  /** The recipe's optimizer settings: the step, where the change goes, the robust view. */
  optimizer: OptimizerSpec;
}

interface Loaded {
  engine: BrowserEngine;
  release: ModelRelease;
  assets: AssetLoader;
  baseUrl: string;
  library?: Library;
}

/** A command that cannot run in the current state. Reported, never fatal. */
class CommandError extends Error {}

const worker = self as unknown as DedicatedWorkerGlobalScope;
let loaded: Loaded | undefined;
let applied: Applied | undefined;
let phase: Phase = "idle";
/** The latest control command: true after run, false after pause, step or a refused run. */
let wantRun = false;
/** A pause waiting for its acknowledgement (phase and measurement); it goes before queued work. */
let pauseRequested = false;
let busy = false;
/** Commands that touch the engine, in arrival order. Run and pause are controls, not queued. */
const queue: Command[] = [];

function emit(event: Event): void {
  worker.postMessage(event, transferables(event));
}

function setPhase(next: Phase, message?: string): void {
  phase = next;
  emit({ type: "phase", phase: next, message });
}

// --- Events from one evaluation -------------------------------------------------

/** The engine's terms, with each request's blocks folded into its one Code term (objective.ts). */
function termMeasurements(evaluation: Evaluation, view: number | "mean"): TermMeasurement[] {
  const views = evaluation.views;
  const terms = evaluation.ids.map((id, term) => {
    const row = evaluation.raws.subarray(term * views, (term + 1) * views);
    const raw = view === "mean" ? row.reduce((sum, value) => sum + value, 0) / views : row[view];
    return { id, raw, weighted: evaluation.weights[term] * raw };
  });
  return foldAddressTerms(terms);
}

/** Probe codes are always read from view 0, the unshifted image, so they belong to the measurement. */
function measurementEvent(evaluation: Evaluation, revision: number, pixels: Uint8ClampedArray): Event {
  return {
    type: "measurement",
    revision,
    step: evaluation.step,
    terms: termMeasurements(evaluation, 0),
    codes: evaluation.probes,
    pixels,
  };
}

/** One update yields its frame (terms over both views) and, from view 0, a free measurement. */
function emitUpdate(evaluation: Evaluation, revision: number, elapsedMs: number): void {
  const terms = termMeasurements(evaluation, "mean");
  emit({
    type: "frame",
    revision,
    step: evaluation.step,
    views: evaluation.views,
    loss: terms.reduce((sum, term) => sum + term.weighted, 0),
    terms,
    pixels: evaluation.pixels.slice(),
    elapsedMs,
    gpu:
      evaluation.gpuUsedBytes === undefined || evaluation.gpuReservedBytes === undefined
        ? undefined
        : { usedBytes: evaluation.gpuUsedBytes, reservedBytes: evaluation.gpuReservedBytes },
  });
  emit(measurementEvent(evaluation, revision, evaluation.pixels));
}

async function emitMeasurement({ engine }: Loaded): Promise<void> {
  const evaluation = (await engine.measure()) as Evaluation;
  emit(measurementEvent(evaluation, applied?.revision ?? 0, evaluation.pixels));
}

// --- Commands ----------------------------------------------------------------------

/** The adapter's limits the engine is measured against: buffers, bindings and workgroups. */
const LIMIT_NAMES = [
  "maxBufferSize",
  "maxStorageBufferBindingSize",
  "maxStorageBuffersPerShaderStage",
  "maxComputeWorkgroupStorageSize",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupSizeY",
  "maxComputeWorkgroupSizeZ",
  "maxComputeWorkgroupsPerDimension",
] as const;

/** What the adapter said, for the failure messages of the load and the first apply. */
let adapterReport = "no adapter";

async function gpuCapabilities(): Promise<{ adapter?: string; reason?: string; limits?: Record<string, number> }> {
  if (!("gpu" in navigator)) return { reason: "This browser does not provide WebGPU." };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return { reason: "No WebGPU adapter is available." };
  const info = adapter.info;
  if ((info as GPUAdapterInfo & { isFallbackAdapter?: boolean }).isFallbackAdapter) {
    return { reason: "Only a software WebGPU adapter is available; it is too slow for synthesis." };
  }
  const name = [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") || "WebGPU adapter";
  const limits = Object.fromEntries(LIMIT_NAMES.map((limit) => [limit, adapter.limits[limit]]));
  adapterReport = `${name}; limits ${LIMIT_NAMES.map((limit) => `${limit} ${limits[limit]}`).join(", ")}`;
  return { adapter: name, limits };
}

async function load(location: ReleaseLocation): Promise<void> {
  if (loaded) throw new CommandError("The model is already loaded.");
  setPhase("loading", "Checking WebGPU…");
  // The stage a failure names, so a report from another device says where the load stopped.
  let stage = "the WebGPU adapter";
  try {
    const gpu = await gpuCapabilities();
    emit({ type: "capabilities", webgpu: gpu.reason === undefined, adapter: gpu.adapter, reason: gpu.reason, limits: gpu.limits });
    if (gpu.reason) {
      setPhase("failed", gpu.reason);
      return;
    }
    stage = "the engine module";
    await initializeEngine();
    stage = "the GPU device";
    const engine = await BrowserEngine.create();
    engine.on_device_lost(deviceLost);
    stage = "the release manifest";
    const release = await fetchModelRelease(location);
    stage = "the asset cache";
    const assets = new AssetLoader(location.baseUrl);
    await assets.open();
    const files = [...release.encoder, release.calibration];
    const bytesTotal = files.reduce((sum, file) => sum + file.bytes, 0);
    let bytesDone = 0;
    for (const [index, file] of files.entries()) {
      stage = `the download of model file ${index + 1} of ${files.length} (${file.path})`;
      const bytes = await assets.bytes(file);
      stage = `the engine's load of model file ${index + 1} of ${files.length} (${file.path})`;
      if (index === 0) engine.load_stem(bytes);
      else if (index < files.length - 1) engine.load_layer(index - 1, bytes);
      else engine.load_calibration(bytes);
      bytesDone += file.bytes;
      emit({
        type: "progress",
        bytesDone,
        bytesTotal,
        cacheHits: assets.cacheHits,
        message: `Loaded ${index + 1} of ${files.length} model files`,
      });
    }
    loaded = { engine, release, assets, baseUrl: location.baseUrl };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new Error(`The load failed at ${stage}: ${describe(error)} (${adapterReport})`);
  }
  setPhase("ready");
}

/**
 * Download missing frames concurrently to avoid serial request latency: an apply can need
 * 128 frames of 12 kB. Install the downloaded frames in recipe order.
 */
async function loadBlocks({ engine, release, assets }: Loaded, blocks: number[]): Promise<void> {
  const missing = blocks.filter((block) => !engine.has_frame(block));
  const frames = await Promise.all(missing.map((block) => assets.bytes(blockPath(release, block))));
  missing.forEach((block, index) => engine.load_frame(block, frames[index]!));
}

/**
 * Encode each reference view the recipe needs and the cache lacks, keeping the others resident.
 * The previews download together; the encodes then run one at a time in the recipe's order.
 */
async function encodeReferences({ engine, release, assets }: Loaded, images: number[]): Promise<void> {
  const missing = engine.references_to_encode(new Float64Array(images));
  if (missing.length === 0) return;
  setPhase("preparing", `Downloading ${missing.length} reference ${missing.length === 1 ? "picture" : "pictures"}`);
  const previews = await Promise.all(Array.from(missing, (imageId) => assets.bytes(previewPath(release, imageId))));
  for (const [index, imageId] of missing.entries()) {
    setPhase("preparing", `Encoding reference ${index + 1} of ${missing.length}`);
    await engine.encode_reference(imageId, previews[index]);
  }
}

/** A trap or a lost device ends the session; any other failure only rejects one apply. */
function isFatal(error: unknown): boolean {
  return error instanceof WebAssembly.RuntimeError || phase === "failed";
}

/**
 * Install the parts of `recipe` that changed. An objective change resets Adam; a protect
 * change rebases the image; a probe or motion change does neither. Files and references are
 * loaded first; then the engine installs every changed part together or none of them.
 */
async function apply(context: Loaded, revision: number, recipe: Recipe): Promise<void> {
  const problems = validateRecipe(recipe, { blocks: context.release.blocks });
  if (recipe.release !== context.release.release) {
    problems.push(`the image-editing configuration names release ${recipe.release}, but ${context.release.release} is loaded`);
  }
  if (problems.length) {
    emit({ type: "rejected", revision, message: problems.join("; ") });
    return;
  }
  const { engine } = context;
  const regions = new Map<number, Code[]>();
  try {
    for (const request of recipe.requests) {
      const { target, radius } = request.respondLike;
      if (target.kind !== "region") continue;
      context.library ??= await openLibrary({ baseUrl: context.baseUrl, release: recipe.release });
      const record = await context.library.block(request.block);
      regions.set(request.id, regionCodes(target, regionSource(record.cloud).map((point) => point.code), radius));
    }
  } catch (error) {
    emit({ type: "rejected", revision, message: describe(error) });
    return;
  }
  const objective = objectiveSpec(recipe, regions);
  const probes = probeSpecs(recipe, regions);
  const editable = editableCells(recipe);
  const zoomPerUpdate = recipe.motion.zoomPerUpdate;
  const optimizer = optimizerSpec(recipe);
  const first = applied === undefined;
  const objectiveChanged = !applied || !sameObjective(applied.objective, objective);
  const probesChanged = !applied || !sameProbes(applied.probes, probes);
  const editableChanged = !applied || !sameEditable(applied.editable, editable);
  const motionChanged = !applied || applied.zoomPerUpdate !== zoomPerUpdate;
  // A changed optimizer keeps the image and Adam's moments; the engine applies it from the next update.
  const optimizerChanged = !applied || !sameOptimizer(applied.optimizer, optimizer);
  if (applied && !objectiveChanged && !probesChanged && !editableChanged && !motionChanged && !optimizerChanged) {
    applied = { ...applied, revision };
    emit({ type: "applied", revision, step: engine.steps(), resetAdam: false, rebased: false });
    if (!wantRun) await emitMeasurement(context);
    return;
  }
  const before = phase;
  setPhase("preparing", "Preparing the objective…");
  let stage = "loading the basis matrices of the basis groups";
  try {
    await loadBlocks(context, neededBlocks(objective, probes));
    if (objectiveChanged) {
      stage = "preparing the reference pictures";
      await encodeReferences(context, neededImages(objective));
    }
    stage = "installing the objective";
    engine.install(
      JSON.stringify({
        objective: objectiveChanged ? objective : null,
        probes: probesChanged ? probes : null,
        editable: first || editableChanged ? Array.from(editable, (cell) => cell === 1) : null,
        motion: motionChanged ? { zoomPerUpdate } : null,
        seed: first ? recipe.seed : null,
        optimizer: optimizerChanged ? optimizer : null,
      }),
    );
  } catch (error) {
    if (isFatal(error)) throw error;
    emit({ type: "rejected", revision, message: `${describe(error)} (while ${stage})` });
    setPhase(phaseAfterWork(before));
    if (!wantRun) await emitMeasurement(context);
    return;
  }
  applied = { revision, objective, probes, editable, zoomPerUpdate, optimizer };
  emit({
    type: "applied",
    revision,
    step: engine.steps(),
    resetAdam: objectiveChanged || editableChanged,
    rebased: editableChanged && !first,
  });
  setPhase(phaseAfterWork(before));
  if (!wantRun) await emitMeasurement(context);
}

/** After preparing: running if the latest control was run, else where it was, never still running. */
function phaseAfterWork(before: Phase): Phase {
  if (wantRun) return "running";
  return before === "running" ? "paused" : before;
}

function nothingToOptimize({ engine }: Loaded): string | undefined {
  if (!applied) return "Apply an image-editing configuration before running.";
  if (!engine.can_update()) return "Nothing to optimize: enable a term with a positive weight and leave a cell unprotected.";
  return undefined;
}

function refuse(command: "run" | "step" | "reseed" | "restore", message: string): void {
  emit({ type: "refused", command, message });
}

async function update(context: Loaded): Promise<void> {
  const started = performance.now();
  const evaluation = (await context.engine.step()) as Evaluation | null;
  if (!evaluation) return;
  emitUpdate(evaluation, applied?.revision ?? 0, performance.now() - started);
}

/** The run loop's turn: one update, or a refusal that ends the run. */
async function runOnce(context: Loaded): Promise<void> {
  const reason = nothingToOptimize(context);
  if (reason) {
    wantRun = false;
    refuse("run", reason);
    if (phase === "running") setPhase("paused", reason);
    return;
  }
  if (phase !== "running") setPhase("running");
  await update(context);
}

/** Pause has priority over queued work: it is acknowledged before the next queued command. */
async function acknowledgePause(context: Loaded): Promise<void> {
  if (phase === "running") setPhase("paused");
  if (applied) await emitMeasurement(context);
}

async function execute(command: Command): Promise<void> {
  if (command.type === "load") return load(command.release);
  if (command.type === "dispose") {
    wantRun = false;
    loaded?.engine.free();
    loaded = undefined;
    worker.close();
    return;
  }
  if (!loaded) {
    if (command.type === "apply") {
      emit({ type: "rejected", revision: command.revision, message: "The model is not loaded yet." });
      return;
    }
    if (command.type === "step" || command.type === "reseed" || command.type === "restore") {
      return refuse(command.type, "The model is not loaded yet.");
    }
    throw new CommandError("Load the model first.");
  }
  const context = loaded;
  switch (command.type) {
    case "apply":
      return apply(context, command.revision, command.recipe);
    case "step": {
      // One update, then remain paused, also when sent during a run.
      wantRun = false;
      const reason = nothingToOptimize(context);
      if (reason) return refuse("step", reason);
      await update(context);
      setPhase("paused");
      // The update's own measurement shows the image before it; show the updated image too.
      return emitMeasurement(context);
    }
    case "restart":
      context.engine.restart(command.seed);
      emit({ type: "restarted", revision: applied?.revision ?? 0, seed: command.seed });
      return emitMeasurement(context);
    case "reseed":
      // Noise brush: fresh noise under the painted cells, between updates; a run continues.
      if (!applied) return refuse("reseed", "Apply an image-editing configuration before painting noise.");
      context.engine.reseed(Uint8Array.from(command.cells, (painted) => (painted ? 1 : 0)), command.seed);
      emit({ type: "reseeded", revision: applied.revision, step: context.engine.steps(), seed: command.seed });
      return emitMeasurement(context);
    case "restore":
      // Open: the stored picture becomes the image; the engine refuses a bad PNG before changing anything.
      if (!applied) return refuse("restore", "Apply the image-editing configuration before restoring its picture.");
      try {
        context.engine.restore_picture(command.picture, command.step);
      } catch (error) {
        return refuse("restore", describe(error));
      }
      emit({ type: "restored", revision: applied.revision, step: context.engine.steps() });
      return emitMeasurement(context);
    case "measure":
      return emitMeasurement(context);
  }
}

/** An error's message, with its name when the name says something ("TypeError: Load failed" is Safari's fetch failure). */
function describe(error: unknown): string {
  if (error instanceof Error) return error.name === "Error" || !error.name ? error.message : `${error.name}: ${error.message}`;
  return String(error);
}

/** The engine and its GPU state are gone; an in-flight readback may never return. */
function deviceLost(message: string): void {
  if (phase === "failed") return;
  wantRun = false;
  pauseRequested = false;
  queue.length = 0;
  emit({ type: "error", message, fatal: true });
  setPhase("failed", message);
}

function fail(error: unknown): void {
  if (phase === "failed") return; // Already reported, e.g. by deviceLost.
  if (error instanceof CommandError) {
    emit({ type: "error", message: error.message, fatal: false });
    return;
  }
  wantRun = false;
  const fatal = endsSession(error, loaded !== undefined);
  emit({ type: "error", message: describe(error), fatal });
  if (fatal) {
    pauseRequested = false;
    queue.length = 0;
    setPhase("failed", describe(error));
  } else if (loaded) {
    setPhase("paused", describe(error));
  }
}

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    if (pauseRequested && loaded) {
      pauseRequested = false;
      await acknowledgePause(loaded);
    } else if (queue.length) {
      await execute(queue.shift()!);
    } else if (wantRun && loaded) {
      await runOnce(loaded);
    }
  } catch (error) {
    fail(error);
  } finally {
    busy = false;
    if (phase !== "failed" && ((pauseRequested && loaded) || queue.length || (wantRun && loaded))) setTimeout(pump, 0);
  }
}

worker.onmessage = ({ data }: MessageEvent<Command>) => {
  if (phase === "failed") {
    if (data.type === "run" || data.type === "step") refuse(data.type, "The session failed. Dispose it and create a new one.");
    if (data.type === "dispose") queue.splice(0, queue.length, data);
    else return;
  } else if (data.type === "run") {
    // Controls take effect at the next update boundary, after any queued apply.
    wantRun = true;
    pauseRequested = false;
  } else if (data.type === "pause") {
    wantRun = false;
    pauseRequested = true;
  } else if (data.type === "dispose") {
    wantRun = false;
    pauseRequested = false;
    queue.splice(0, queue.length, data);
  } else {
    queue.push(data);
  }
  void pump();
};
