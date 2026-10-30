import type {
  BenchmarkEvent,
  BenchmarkSettings,
  BrowserResult,
  FrameBreakdown,
  ProductTiming,
  Mode,
  ModeResult,
  Request,
  StepReply,
  StepSample,
} from "./protocol.ts";

export interface MeasurementWorker {
  call<T>(request: Request): Promise<T>;
}

async function measuredStep(
  worker: MeasurementWorker,
  mode: Mode,
): Promise<StepSample> {
  const start = performance.now();
  const { frame, ...sample } = await worker.call<StepReply>({
    type: "step",
    mode,
  });
  const round_trip_ms = performance.now() - start;
  if (mode === "frame" && !frame) {
    throw new Error("Frame mode did not deliver preview pixels.");
  }
  if (
    frame &&
    (frame.pixels.length !== 4 * 256 * 256 || !Number.isFinite(frame.loss))
  ) {
    throw new Error("Invalid preview delivery.");
  }
  return { ...sample, round_trip_ms };
}

async function runMode(
  worker: MeasurementWorker,
  mode: Mode,
  settings: BenchmarkSettings,
  onEvent: (event: BenchmarkEvent) => void,
): Promise<ModeResult> {
  await worker.call({ type: "restart", seed: settings.seed });
  const count = mode === "profile" ? settings.profileSteps : settings.steps;
  const warmup: StepSample[] = [];
  const samples: StepSample[] = [];
  for (let index = 0; index < settings.warmup + count; index++) {
    const sample = await measuredStep(worker, mode);
    if (sample.step !== index)
      throw new Error(
        `${mode}: expected step ${index}, received ${sample.step}`,
      );
    const warming = index < settings.warmup;
    (warming ? warmup : samples).push(sample);
    onEvent({ type: "sample", mode, sample, warmup: warming });
  }
  const final = await worker.call<{ step: number; loss: number }>({
    type: "measure",
  });
  if (final.step !== settings.warmup + count || !Number.isFinite(final.loss)) {
    throw new Error(`${mode}: invalid final readout`);
  }
  return { first: warmup[0], warmup, samples, final };
}

/** Restart each mode from the same seed. Never call the WASM timestamp fallback. */
export async function runMeasurements(
  worker: MeasurementWorker,
  settings: BenchmarkSettings,
  timestamps: boolean,
  result: BrowserResult,
  onEvent: (event: BenchmarkEvent) => void,
): Promise<void> {
  for (const mode of ["compute", "frame", "profile"] as const) {
    if (mode === "profile" && !timestamps) {
      result.profileUnavailable =
        "No timestamp-query. Completion wall times remain valid.";
      continue;
    }
    onEvent({ type: "phase", message: `${mode}: updates (no asset requests)` });
    result.modes[mode] = await runMode(worker, mode, settings, onEvent);
  }
  onEvent({ type: "phase", message: "matrix products: time per call" });
  result.products = await worker.call<ProductTiming[]>({ type: "products" });
  onEvent({ type: "phase", message: "frame updates: time split" });
  result.frameBreakdown = [];
  for (let index = 0; index < 16; index++) {
    const waitFirst = index % 2 === 0;
    result.frameBreakdown.push(await worker.call<FrameBreakdown>({ type: "frame-breakdown", waitFirst }));
  }
}
