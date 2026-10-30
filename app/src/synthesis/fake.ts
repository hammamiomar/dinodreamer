// Synthetic worker for fixture pages and protocol tests. It follows loading, apply,
// run, pause, restart, reseed and restore commands, but reports no DINO measurements.
// Response fields drift toward colours derived from their target codes; Appearance
// fields change only their synthetic loss. Optimizer stride and far view scale the
// convergence pace; pyramid scale is ignored.

import { pathCode, scaleCode, sameCodeTarget } from "../code-target";
import type { Code } from "../recipe";
import { CELLS, GRID, PATCH_SLOT_OFFSET, validateRecipe, type OptimizerStep, type Recipe } from "../recipe";
import { objectiveSpec, sameObjective } from "./objective";
import { cellPulls, paintedCodeLoss, syntheticAppearanceLoss } from "./fake-objective";
import type { SynthesisClient } from "./client";
import type { CodeMeasurement, Command, Event, Phase, TermMeasurement } from "./protocol";
import { seededRandom } from "../ui/seeded-random";

export interface FakeSynthesisOptions {
  /** Wall time of one update. */
  stepMs?: number;
  loadMs?: number;
  prepareMs?: number;
  /** Decodes a stored picture's PNG to 256 × 256 RGBA; the browser's decoder by default, a stub in tests. */
  decodePicture?: (png: Uint8Array) => Promise<Uint8ClampedArray>;
}

const SIZE = 256;
const PIXELS_PER_CELL = SIZE / GRID;
const FAKE_DOWNLOAD_BYTES = 168_000_000;
/** Steps for a synthetic code error to fall by a factor of e. */
const CONVERGENCE_STEPS = 60;
/** Fraction of the remaining colour distance an update covers. */
const IMAGE_RATE = 0.35;
/** Pace relative to step 0.05, from measured update counts to error 0.1: 46, 26.5, 18 and 14. */
const STEP_PACE: Record<OptimizerStep, number> = { 0.0125: 18 / 46, 0.025: 18 / 26.5, 0.05: 1, 0.1: 18 / 14 };
/** The far view needs about a quarter more updates: 32.5 against 26.5 to error 0.1. */
const ROBUST_VIEW_PACE = 26.5 / 32.5;

const DEFAULTS: Required<FakeSynthesisOptions> = { stepMs: 350, loadMs: 1200, prepareMs: 400, decodePicture: decodePictureInBrowser };

/** A PNG as 256 × 256 RGBA through the browser's decoder; rejects a picture of another size. */
async function decodePictureInBrowser(png: Uint8Array): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }));
  try {
    if (bitmap.width !== SIZE || bitmap.height !== SIZE) throw new Error(`The picture is ${bitmap.width} × ${bitmap.height}, not ${SIZE} × ${SIZE}.`);
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2-D canvas to read the picture.");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, SIZE, SIZE).data;
  } finally {
    bitmap.close();
  }
}

export function createFakeSynthesisClient(options: FakeSynthesisOptions = {}): SynthesisClient {
  const settings = { ...DEFAULTS, ...options };
  const listeners = new Set<(event: Event) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  let phase: Phase = "idle";
  let loaded = false;
  let preparing = false;
  let running = false;
  let applied: { revision: number; recipe: Recipe } | undefined;
  let image: FakeImage | undefined;
  let stepTimer: ReturnType<typeof setTimeout> | undefined;

  function emit(event: Event) {
    // Workers answer asynchronously; so does the fake.
    later(0, () => listeners.forEach((listener) => listener(event)));
  }

  function later(ms: number, action: () => void) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      action();
    }, ms);
    timers.add(timer);
    return timer;
  }

  function setPhase(next: Phase, message?: string) {
    phase = next;
    emit({ type: "phase", phase: next, message });
  }

  function settledPhase(): Phase {
    if (running) return "running";
    return image ? "paused" : "ready";
  }

  function load() {
    if (loaded || phase === "loading") return;
    setPhase("loading", "Downloading the vision model (fake)");
    emit({ type: "capabilities", webgpu: true, adapter: "fake worker" });
    const ticks = 6;
    for (let tick = 1; tick <= ticks; tick++) {
      later((settings.loadMs * tick) / ticks, () => {
        const bytesDone = Math.round((FAKE_DOWNLOAD_BYTES * tick) / ticks);
        emit({ type: "progress", bytesDone, bytesTotal: FAKE_DOWNLOAD_BYTES, cacheHits: 0, message: "encoder (fake)" });
        if (tick === ticks) {
          loaded = true;
          setPhase("ready");
        }
      });
    }
  }

  function apply(revision: number, recipe: Recipe) {
    if (!loaded) {
      emit({ type: "rejected", revision, message: "The worker is not loaded." });
      return;
    }
    const problems = validateRecipe(recipe);
    if (problems.length > 0) {
      emit({ type: "rejected", revision, message: problems.join("; ") });
      return;
    }
    const objectiveUnchanged = applied !== undefined && sameFakeObjective(applied.recipe, recipe);
    const install = () => {
      preparing = false;
      const rebased = applied !== undefined && !sameBooleans(applied.recipe.protect, recipe.protect);
      if (!image) image = createImage(recipe.seed);
      if (rebased) image.base = image.pixels.slice();
      applied = { revision, recipe };
      emit({ type: "applied", revision, step: image.step, resetAdam: !objectiveUnchanged, rebased });
      setPhase(settledPhase());
      if (!running) emitMeasurement();
    };
    if (objectiveUnchanged) {
      install();
      return;
    }
    preparing = true;
    setPhase("preparing", "Encoding reference pictures (fake)");
    later(settings.prepareMs, install);
  }

  function update() {
    if (!applied || !image) return;
    const started = performance.now();
    const before = measure(image, applied.recipe);
    advance(image, applied.recipe, pace(applied.recipe));
    emit({
      type: "frame",
      revision: applied.revision,
      step: before.step,
      views: 2,
      loss: before.terms.reduce((sum, term) => sum + term.weighted, 0),
      terms: before.terms,
      pixels: before.pixels,
      elapsedMs: settings.stepMs + (performance.now() - started),
    });
    // The measurement that follows a frame describes the same image, as in the real worker.
    emit({ type: "measurement", revision: applied.revision, ...before, pixels: before.pixels.slice() });
  }

  function emitMeasurement() {
    if (!applied || !image) return;
    const measured = measure(image, applied.recipe);
    emit({ type: "measurement", revision: applied.revision, ...measured });
  }

  function scheduleStep() {
    stepTimer = later(settings.stepMs, () => {
      stepTimer = undefined;
      if (!running) return;
      // During preparation the previous objective keeps stepping.
      update();
      scheduleStep();
    });
  }

  /** Why a run or step cannot be honored, or undefined when it can. */
  function refusal(): string | undefined {
    if (!applied || !image) return "No image-editing configuration is applied yet.";
    if (applied.recipe.protect.every(Boolean)) return "Every cell is protected: nothing can change.";
    if (measure(image, applied.recipe).terms.length === 0) return "Nothing to optimize: every term is off or has weight 0.";
    return undefined;
  }

  function stopStepping() {
    running = false;
    if (stepTimer !== undefined) {
      clearTimeout(stepTimer);
      timers.delete(stepTimer);
      stepTimer = undefined;
    }
  }

  // A restore decodes its picture asynchronously; commands sent meanwhile wait behind it, as
  // the real worker handles commands in order.
  let restoring: Promise<void> | null = null;

  function send(command: Command) {
    if (restoring || command.type === "restore") {
      const next: Promise<void> = (restoring ?? Promise.resolve()).then(() => handle(command));
      restoring = next;
      void next.finally(() => {
        if (restoring === next) restoring = null;
      });
      return;
    }
    handle(command);
  }

  /** Makes a stored picture the image and the base at its step, or refuses it with the image unchanged. */
  async function restore(picture: Uint8Array, step: number): Promise<void> {
    if (!applied) return emit({ type: "refused", command: "restore", message: "No image-editing configuration is applied yet." });
    let rgba: Uint8ClampedArray;
    try {
      rgba = await settings.decodePicture(picture);
      if (rgba.length !== SIZE * SIZE * 4) throw new Error("The picture is not 256 × 256.");
    } catch (error) {
      return emit({ type: "refused", command: "restore", message: error instanceof Error ? error.message : String(error) });
    }
    if (!applied) return;
    const pixels = new Float32Array(SIZE * SIZE * 3);
    for (let pixel = 0; pixel < SIZE * SIZE; pixel++) {
      for (let channel = 0; channel < 3; channel++) pixels[pixel * 3 + channel] = rgba[pixel * 4 + channel] / 255;
    }
    const random = seededRandom(step + 1);
    const offsets_N3 = image?.offsets_N3 ?? createImage(1).offsets_N3;
    image = { pixels, base: pixels.slice(), step, progress: step, offsets_N3, random };
    emit({ type: "restored", revision: applied.revision, step });
    emitMeasurement();
  }

  function handle(command: Command): void | Promise<void> {
    if (command.type === "restore") return restore(command.picture, command.step);
    switch (command.type) {
      case "load":
        load();
        return;
      case "apply":
        apply(command.revision, command.recipe);
        return;
      case "run": {
        const reason = refusal();
        if (reason) return emit({ type: "refused", command: "run", message: reason });
        if (running) return;
        running = true;
        if (!preparing) setPhase("running");
        scheduleStep();
        return;
      }
      case "pause":
        // Pause has priority: during preparation the phase stays "preparing" and the
        // install reports "paused" with its measurement.
        stopStepping();
        if (loaded && !preparing) {
          setPhase(settledPhase());
          emitMeasurement();
        }
        return;
      case "step": {
        const reason = refusal();
        if (reason) return emit({ type: "refused", command: "step", message: reason });
        // One update, then remain paused: no running phase in between.
        stopStepping();
        if (phase !== "paused") setPhase("paused");
        later(settings.stepMs, () => {
          update();
          // The frame's measurement shows the image before the update; a stopped image is measured as it is now.
          emitMeasurement();
        });
        return;
      }
      case "restart":
        if (!applied) return;
        image = createImage(command.seed);
        emit({ type: "restarted", revision: applied.revision, seed: command.seed });
        emitMeasurement();
        return;
      case "reseed":
        if (!applied || !image) return emit({ type: "refused", command: "reseed", message: "No image-editing configuration is applied yet." });
        reseedCells(image, command.cells, applied.recipe.protect, command.seed);
        emit({ type: "reseeded", revision: applied.revision, step: image.step, seed: command.seed });
        emitMeasurement();
        return;
      case "measure":
        emitMeasurement();
        return;
      case "dispose":
        dispose();
        return;
    }
  }

  function dispose() {
    stopStepping();
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    listeners.clear();
  }

  return {
    send,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose,
  };
}

// ---------------------------------------------------------------------------
// The synthetic image and its invented measurements

interface FakeImage {
  /** RGB in [0, 1], [256, 256, 3] row-major. */
  pixels: Float32Array;
  /** The pixels protected cells keep. */
  base: Float32Array;
  step: number;
  /** How far the synthetic codes have converged, in updates at step 0.05 and full pace. */
  progress: number;
  /** Per-cell code offsets [256, 3] that shrink as the image converges. */
  offsets_N3: Float32Array;
  random: () => number;
}

function createImage(seed: number): FakeImage {
  const random = seededRandom(seed);
  const pixels = new Float32Array(SIZE * SIZE * 3);
  for (let index = 0; index < pixels.length; index++) pixels[index] = 0.35 + 0.3 * random();
  const offsets_N3 = new Float32Array(CELLS * 3);
  for (let index = 0; index < offsets_N3.length; index++) offsets_N3[index] = (random() - 0.5) * 1.6;
  return { pixels, base: pixels.slice(), step: 0, progress: 0, offsets_N3, random };
}

/** The pace of one update under the recipe's run settings, against step 0.05 without the far view. */
function pace(recipe: Recipe): number {
  const { step, robustView } = recipe.optimizer;
  return STEP_PACE[step] * (robustView ? ROBUST_VIEW_PACE : 1);
}

/**
 * The Noise tool on the fake: the painted, unprotected cells get fresh pixels from the
 * fresh-image distribution seeded by `seed`, in the image and in the Protect base alike.
 * The step count and the rest of the image are untouched.
 */
function reseedCells(image: FakeImage, cells: boolean[], protect: boolean[], seed: number) {
  const random = seededRandom(seed);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cell = Math.floor(y / PIXELS_PER_CELL) * GRID + Math.floor(x / PIXELS_PER_CELL);
      if (!cells[cell] || protect[cell]) continue;
      const offset = (y * SIZE + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const value = 0.35 + 0.3 * random();
        image.pixels[offset + channel] = value;
        image.base[offset + channel] = value;
      }
    }
  }
}

/**
 * One synthetic update at `speed` (1 at step 0.05): Respond like cells drift towards their
 * request's colour; protected cells keep their base. Then the zoom scales the image and its base alike.
 */
function advance(image: FakeImage, recipe: Recipe, speed: number) {
  const { colours_N3, pull_N } = cellPulls(recipe);
  const { pixels, base, random } = image;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cell = Math.floor(y / PIXELS_PER_CELL) * GRID + Math.floor(x / PIXELS_PER_CELL);
      const offset = (y * SIZE + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        if (recipe.protect[cell]) {
          pixels[offset + channel] = base[offset + channel];
          continue;
        }
        const target = colours_N3[cell * 3 + channel];
        const rate = Math.min(1, IMAGE_RATE * pull_N[cell] * speed);
        const noise = (random() - 0.5) * 0.04 * rate;
        pixels[offset + channel] += rate * (target - pixels[offset + channel]) + noise;
      }
    }
  }
  const zoom = recipe.motion.zoomPerUpdate;
  if (zoom > 0) {
    image.pixels = zoomAboutCentre(image.pixels, zoom);
    image.base = zoomAboutCentre(image.base, zoom);
  }
  image.step += 1;
  image.progress += speed;
}

/**
 * Scales a [256, 256, 3] image by (1 + zoom) about its centre with bilinear sampling,
 * keeping its size: the outer band leaves the frame, as in DeepDream's zoom.
 */
export function zoomAboutCentre(pixels_HWC: Float32Array, zoom: number): Float32Array {
  const zoomed = new Float32Array(pixels_HWC.length);
  const centre = SIZE / 2;
  const at = (x: number, y: number, channel: number) => pixels_HWC[(y * SIZE + x) * 3 + channel];
  for (let y = 0; y < SIZE; y++) {
    // The source position of this pixel's centre, in pixel-index coordinates.
    const sourceY = Math.min(SIZE - 1, Math.max(0, (y + 0.5 - centre) / (1 + zoom) + centre - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(SIZE - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < SIZE; x++) {
      const sourceX = Math.min(SIZE - 1, Math.max(0, (x + 0.5 - centre) / (1 + zoom) + centre - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(SIZE - 1, x0 + 1);
      const fx = sourceX - x0;
      for (let channel = 0; channel < 3; channel++) {
        const top = at(x0, y0, channel) * (1 - fx) + at(x1, y0, channel) * fx;
        const bottom = at(x0, y1, channel) * (1 - fx) + at(x1, y1, channel) * fx;
        zoomed[(y * SIZE + x) * 3 + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return zoomed;
}

function measure(image: FakeImage, recipe: Recipe): {
  step: number;
  terms: TermMeasurement[];
  codes: CodeMeasurement[];
  pixels: Uint8ClampedArray;
} {
  const decay = Math.exp(-image.progress / CONVERGENCE_STEPS);
  const codes = recipe.requests.map((request) => measureCodes(request, image.offsets_N3, decay));
  const terms: TermMeasurement[] = [];
  const addTerm = (id: string, enabled: boolean, weight: number, raw: number) => {
    if (enabled && weight > 0) terms.push({ id, raw, weighted: weight * raw });
  };

  recipe.requests.forEach((request, index) => {
    const codeRaw = paintedCodeLoss(request, codes[index]);
    const lookRaw = syntheticAppearanceLoss(request, decay);
    addTerm(`request:${request.id}:respond`, request.respondLike.enabled, request.respondLike.weight, codeRaw);
    addTerm(`request:${request.id}:look`, request.lookLike.enabled, request.lookLike.weight, lookRaw);
  });
  addTerm("rules:tv", recipe.rules.tv.enabled, recipe.rules.tv.weight, 0.02 + 0.05 * decay);
  addTerm("rules:l2", recipe.rules.l2.enabled, recipe.rules.l2.weight, 0.1);

  return { step: image.step, terms, codes, pixels: toRgba(image.pixels) };
}

/**
 * The measured codes start off the requested code by the synthetic offsets times the code's
 * length, so the normalized error starts near 0.6 for any code, as an absent block's starts
 * near 1.
 */
function measureCodes(request: Recipe["requests"][number], offsets_N3: Float32Array, decay: number): CodeMeasurement {
  const source = request.respondLike.source;

  // The measured tokens: the Respond like area of a patch request, or a prefix request's own slot.
  const cells =
    source.role === "patch" ? request.respondLike.where.flatMap((inside, cell) => (inside ? [cell] : [])) : [source.slot];
  const slots = new Uint16Array(cells.map((cell) => (source.role === "patch" ? PATCH_SLOT_OFFSET + cell : cell)));
  const codes = new Float32Array(cells.length * 3);
  const errors = new Float32Array(cells.length);
  const normalizers = new Float32Array(cells.length);
  cells.forEach((cell, row) => {
    const { target, radius } = request.respondLike;
    // A region uses its centre only in this synthetic UI fixture, never as DINO evidence.
    const base = target.kind === "path" ? pathCode(target, cell) : target.kind === "region" ? target.centre : request.respondLike.code;
    const requested = scaleCode(base, radius);
    const length = Math.hypot(...requested);
    normalizers[row] = length * length;
    let error = 0;
    for (let axis = 0; axis < 3; axis++) {
      const difference = offsets_N3[(cell % CELLS) * 3 + axis] * decay * length;
      codes[row * 3 + axis] = requested[axis] + difference;
      error += difference * difference;
    }
    errors[row] = error;
  });
  return { requestId: request.id, slots, codes, errors, normalizers };
}

function toRgba(pixels: Float32Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let pixel = 0; pixel < SIZE * SIZE; pixel++) {
    rgba[pixel * 4] = pixels[pixel * 3] * 255;
    rgba[pixel * 4 + 1] = pixels[pixel * 3 + 1] * 255;
    rgba[pixel * 4 + 2] = pixels[pixel * 3 + 2] * 255;
    rgba[pixel * 4 + 3] = 255;
  }
  return rgba;
}

function sameBooleans(a: boolean[], b: boolean[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The fake has no recorded region data. Its centre stands in for the set for change accounting only. */
function fakeObjective(recipe: Recipe) {
  const regions = new Map<number, Code[]>();
  for (const request of recipe.requests) {
    const { target, radius } = request.respondLike;
    if (target.kind === "region") regions.set(request.id, [scaleCode(target.centre, radius)]);
  }
  return objectiveSpec(recipe, regions);
}


/** Inactive requests do not affect the objective; active targets match by request id. */
function sameFakeObjective(before: Recipe, after: Recipe): boolean {
  if (!sameObjective(fakeObjective(before), fakeObjective(after))) return false;
  return before.requests.every((request) => {
    if (!request.respondLike.enabled || request.respondLike.weight === 0) return true;
    const next = after.requests.find((candidate) => candidate.id === request.id);
    return next !== undefined && sameCodeTarget(request.respondLike.target, next.respondLike.target);
  });
}
