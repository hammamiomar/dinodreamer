import init, { BrowserEngine } from "../pkg-harness/dinodreamer_engine";
import { AssetLoader, blockPath, fetchModelRelease, previewPath, type ModelRelease } from "../../app/src/synthesis/assets";
import type { OptimizerSpec } from "../../app/src/synthesis/objective";
import type { BenchmarkEvent, Frame, Loaded, Request, StepReply } from "./protocol";

/** The workload: the evidence recipe as the app's worker installs it (tools/fixtures). */
interface Specs {
  objective: {
    requests: { look: { references: { imageId: number }[] } | null }[];
  };
  probes: { block: number }[];
  optimizer: OptimizerSpec;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
let engine: BrowserEngine;
let assets: AssetLoader;
let release: ModelRelease;
let specsText: string;
let specs: Specs;
let editable: Uint8Array;
let busy = false;

function emit(event: BenchmarkEvent): void {
  worker.postMessage({ event });
}

async function text(path: string): Promise<string> {
  const response = await fetch(new URL(path, location.href));
  if (!response.ok) throw new Error(`${path}: request failed (${response.status}).`);
  return response.text();
}

function referenceImages(): number[] {
  const looks = specs.objective.requests.map((request) => request.look);
  return [...new Set(looks.flatMap((look) => look?.references.map((reference) => reference.imageId) ?? []))];
}

/** Load the model and the evidence recipe through the public loading path, then install it. */
async function load(request: Extract<Request, { type: "load" }>): Promise<Loaded> {
  const start = performance.now();
  await init();
  const initialized = performance.now();
  engine = await BrowserEngine.create();
  const created = performance.now();
  const capabilities = JSON.parse(engine.harness_capabilities_json());
  if (capabilities.adapter.is_fallback) {
    throw new Error("Software WebGPU adapter. Hardware results are required.");
  }
  release = await fetchModelRelease({ baseUrl: request.releaseUrl, manifestPath: "releases/pass-003.json" });
  assets = new AssetLoader(request.releaseUrl);
  await assets.open();
  const files = [...release.encoder, release.calibration];
  for (const [index, file] of files.entries()) {
    const bytes = await assets.bytes(file);
    if (index === 0) engine.load_stem(bytes);
    else if (index < files.length - 1) engine.load_layer(index - 1, bytes);
    else engine.load_calibration(bytes);
    emit({ type: "phase", message: `Loaded ${index + 1}/${files.length} model files` });
  }
  specsText = await text("/fixture/evidence-specs.json");
  specs = JSON.parse(specsText);
  const recipe = JSON.parse(await text("/fixture/evidence-recipe.json"));
  editable = Uint8Array.from(recipe.protect as boolean[], (isProtected) => (isProtected ? 0 : 1));
  for (const block of new Set(specs.probes.map((probe) => probe.block))) {
    engine.load_frame(block, await assets.bytes(blockPath(release, block)));
  }
  for (const imageId of engine.references_to_encode(new Float64Array(referenceImages()))) {
    await engine.encode_reference(imageId, await assets.bytes(previewPath(release, imageId)));
  }
  const { objective, probes, optimizer } = specs;
  engine.install(JSON.stringify({
    objective,
    probes,
    optimizer,
    editable: Array.from(editable, (cell) => cell === 1),
    seed: request.settings.seed,
  }));
  await engine.harness_complete();
  const ready = performance.now();
  return {
    capabilities,
    manifestId: release.release,
    targetPath: "tools/fixtures/evidence-recipe.json",
    optimizer,
    startup: {
      wasm_ms: initialized - start,
      device_ms: created - initialized,
      assets_ms: ready - created,
      total_ms: ready - start,
    },
    cacheHits: assets.cacheHits,
    networkRequests: assets.networkRequests,
    networkBytes: assets.networkBytes,
  };
}

interface Evaluation {
  step: number;
  views: number;
  weights: Float32Array;
  raws: Float32Array;
  pixels: Uint8ClampedArray;
  gpuUsedBytes?: number;
  gpuReservedBytes?: number;
}

/** The weighted total over views, as the app's frame reports it. */
function frameOf(evaluation: Evaluation): Frame {
  let loss = 0;
  evaluation.weights.forEach((weight, term) => {
    const row = evaluation.raws.subarray(term * evaluation.views, (term + 1) * evaluation.views);
    loss += (weight * row.reduce((sum, value) => sum + value, 0)) / evaluation.views;
  });
  const { step, views, pixels, gpuUsedBytes, gpuReservedBytes } = evaluation;
  return { step, loss, views, pixels, gpuUsedBytes, gpuReservedBytes };
}

async function step(mode: "compute" | "frame" | "profile"): Promise<StepReply> {
  const before = JSON.parse(engine.harness_memory_json());
  const requestsBefore = assets.networkRequests;
  const start = performance.now();
  let result: Pick<StepReply, "step" | "stages" | "frame" | "loss">;
  if (mode === "compute") {
    result = JSON.parse(await engine.harness_compute_step());
  } else if (mode === "profile") {
    result = JSON.parse(await engine.harness_profile_step());
  } else {
    const frame = frameOf((await engine.step()) as Evaluation);
    await engine.harness_complete();
    result = { step: frame.step, frame, loss: frame.loss };
  }
  const worker_ms = performance.now() - start;
  if (assets.networkRequests !== requestsBefore) {
    throw new Error("An asset request occurred inside an update.");
  }
  return {
    ...result,
    worker_ms,
    before,
    after: JSON.parse(engine.harness_memory_json()),
  };
}

async function qualify(fixtureUrl: string): Promise<unknown> {
  const response = await fetch(fixtureUrl);
  if (!response.ok) throw new Error(`Fixture request failed (${response.status}).`);
  const reference = new Uint8Array(await response.arrayBuffer());
  const images = referenceImages();
  const previews = await Promise.all(images.map((imageId) => assets.bytes(previewPath(release, imageId))));
  return JSON.parse(
    await engine.harness_qualify(reference, specsText, editable, new Float64Array(images), previews, (json: string) => {
      emit({ type: "check", check: JSON.parse(json) });
    }),
  );
}

async function execute(request: Request): Promise<unknown> {
  switch (request.type) {
    case "load":
      return load(request);
    case "restart":
      engine.restart(request.seed);
      await engine.harness_complete();
      return null;
    case "qualify":
      return qualify(request.fixtureUrl);
    case "step":
      return step(request.mode);
    case "measure": {
      const frame = frameOf((await engine.measure()) as Evaluation);
      return { step: frame.step, loss: frame.loss };
    }
    case "products":
      return JSON.parse(await engine.harness_product_timings(40));
    case "frame-breakdown":
      return { waitFirst: request.waitFirst, ...JSON.parse(await engine.harness_frame_breakdown(request.waitFirst)) };
  }
}

worker.onmessage = async ({ data }: MessageEvent<{ id: number; request: Request }>) => {
  const { id, request } = data;
  if (busy) {
    worker.postMessage({ id, error: "Harness commands must be serialized." });
    return;
  }
  busy = true;
  try {
    const result = await execute(request);
    const frame = (result as StepReply | null)?.frame;
    worker.postMessage({ id, result }, frame ? [frame.pixels.buffer] : []);
  } catch (error) {
    worker.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    busy = false;
  }
};
