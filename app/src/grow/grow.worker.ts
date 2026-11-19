import type { BrowserEngine, BrowserFigure, BrowserFigureGrid, BrowserFigureSet } from "dinodreamer-engine";
import { encodeBase64 } from "../base64";
import { ENGINE_BUILD_NAME } from "../app/config";
import { MAX_CODE_BLOCKS } from "../recipe";
import { AssetLoader, blockPath, fetchModelRelease, type ModelRelease } from "../synthesis/assets";
import { loadEncoderEngine } from "../synthesis/load-encoder";
import { decodeReaderIndex, type ReaderChunk } from "../reader/assets";
import { LOOK_CLOUDS_PATH, decodeLookSummary } from "../library/look-cloud";
import { openLibrary } from "../library/library";
import { FIRES, methodNeedsSet, type FigureReading, type FigureTargetSet } from "../materials/material-file";
import {
  CHECKPOINT_EVERY, HOLD_TICK, LIVE_SEED, READING_LADDER, READING_TICK, RESUME_UPDATES, RUNS, SIDE, afterRun, continuedInput, engineRequest,
  figureInput, figureMaterial, fired, firstFire, firstFireCondition, plannedRuns, readPatches, readingStep, strengthBand, type FigureInput,
  type FigureObjective, type KeptStage, type LadderReading,
} from "./figure-recipe";
import { fetchSetPictures, targetSetRecord } from "./target-set";
import { keepRule } from "./train-method";
import { LIVE_LOOP_STEPS, LIVE_LOOP_STEPS_PER_UPDATE, loopTurn } from "./live-loop";
import { coSelection, type CoSelectedColumns } from "./co-selection";
import type { MaterialKind } from "./material-kind";
import type { Checkpoint, GrowCommand, GrowEvent, GrowProgress, LiveReading, LiveRule } from "./protocol";
import { createRunControl, decodeFigureUpdate, type RunControl, type RunDecision } from "./run-control";

/** Live ticks per training update: the automaton visibly forms while the rule trains. */
const LIVE_TICKS_PER_UPDATE = 8;
/** Updates between readings while training, once the reader is loaded. */
const READ_EVERY = 10;
/** Minimum interval between live-map readings during training. */
const MAP_EVERY_MS = 1000;
/**
 * Maximum share of training time spent on live-map readings. After a reading taking `readMs`,
 * the next map reading waits at least `readMs / MAP_TIME_SHARE` so live map overhead stays
 * within 3 % across GPUs.
 */
const MAP_TIME_SHARE = 0.03;

/** Wait interval after a map reading taking `readMs`. */
function mapInterval(readMs: number): number {
  return Math.max(MAP_EVERY_MS, readMs / MAP_TIME_SHARE);
}

/** Ticks per frame after training, and the interval between readings then. */
const LIVE_TICKS_PER_FRAME = 4;
const LIVE_READ_MS = 2000;
const FRAME_MS = 33;
/** Minimum interval between model download progress reports so fast connections do not flood the page. */
const STARTUP_REPORT_MS = 250;

const send = (event: GrowEvent, transfer: Transferable[] = []) => self.postMessage(event, { transfer });
let activeRun: RunControl<BrowserEngine> | null = null;

async function png(pixels: Uint8ClampedArray, side: number): Promise<string> {
  const canvas = new OffscreenCanvas(side, side);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), side, side), 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  return `data:image/png;base64,${encodeBase64(bytes)}`;
}

/** Loads dictionary reader chunks one per training update so training starts immediately. */
class ReaderLoad {
  private next = 0;
  constructor(private engine: BrowserEngine, private chunks: ReaderChunk[], private assets: AssetLoader) {}
  get loaded() { return this.next; }
  get ready() { return this.next === this.chunks.length; }
  async step() {
    if (this.ready) return;
    const chunk = this.chunks[this.next];
    this.engine.load_reader_chunk(chunk.firstBlock, chunk.blocks, await this.assets.bytes(chunk));
    this.next++;
  }
  async finish() { while (!this.ready) await this.step(); }
}

async function loadModel(
  control: RunControl<BrowserEngine>,
  release: ModelRelease,
  assets: AssetLoader,
  block: number,
): Promise<BrowserEngine> {
  control.setPhase("loading", "Preparing graphics on this device…");
  let toldAt = Number.NEGATIVE_INFINITY;
  const tell = (file: number, files: number, receivedBytes: number, totalBytes: number, always = false) => {
    if (!always && performance.now() - toldAt < STARTUP_REPORT_MS) return;
    toldAt = performance.now();
    send({ type: "startup", startup: { file, files, receivedBytes, totalBytes } });
  };
  const { engine } = await loadEncoderEngine({
    release,
    assets,
    onDeviceLost: (message: string) => send({ type: "error", message, deviceLost: true }),
    onFileStart: ({ index, files, receivedBytes, totalBytes }) => {
      control.setPhase("loading", `Loading the training models · ${index + 1}/${files}`);
      tell(index + 1, files, receivedBytes, totalBytes, true);
    },
    onFileProgress: ({ index, files, receivedBytes, totalBytes }) => {
      tell(index + 1, files, receivedBytes, totalBytes);
    },
    onFileLoaded: ({ index, files, receivedBytes, totalBytes }) => {
      tell(index + 1, files, receivedBytes, totalBytes, true);
    },
  });
  control.setEngine(engine);
  control.setPhase("loading", "Loading the basis group…");
  engine.load_frame(block, await assets.bytes(blockPath(release, block)));
  return engine;
}

async function read(
  engine: BrowserEngine,
  live: BrowserFigureGrid,
  input: FigureInput,
  rule: LiveRule,
  completed: number,
  began: number,
): Promise<LiveReading> {
  const started = performance.now();
  const result = await engine.figure_reading(live, input.block, new Float32Array(input.direction), input.medianNorm) as
    { strength: number; winnerFraction: number; selectedPatches: Uint8Array; patchCodes: Float32Array; tick: number; seed: number } & CoSelectedColumns;
  return {
    patchCodes: result.patchCodes, strength: result.strength, winnerFraction: result.winnerFraction, selectedPatches: result.selectedPatches, coSelection: coSelection(result, input.block),
    tick: result.tick, seed: result.seed, band: strengthBand(result.strength, input), rule, completed,
    elapsedMs: performance.now() - began, readMs: performance.now() - started,
  };
}

/**
 * Read a grid, or return null when its state has left the finite range.
 * Divergent rules cannot be read; callers decide whether to restart or mark unmeasured.
 */
async function readIfFinite(
  engine: BrowserEngine,
  grid: BrowserFigureGrid,
  input: FigureInput,
  rule: LiveRule,
  completed: number,
  began: number,
) {
  return await grid.finite() ? read(engine, grid, input, rule, completed, began) : null;
}

/** Create a replay grid using the standard replay contract and LIVE_SEED. */
function replayGrid(engine: BrowserEngine, kind: MaterialKind) {
  return engine.create_figure_grid(LIVE_SEED, kind.rule, kind.start);
}

/** Restart the live grid from LIVE_SEED while keeping its current rule; training is unaffected. */
function restartLive(control: RunControl<BrowserEngine>, live: BrowserFigureGrid) {
  const tick = live.tick();
  live.restart(LIVE_SEED);
  control.setPhase(control.phase, `The live grid left the finite range at simulation step ${tick.toLocaleString("en-US")}; it starts again.`);
}

/** Advance the live grid, transfer a copy of its pixels to the page, and return the pixels for saving. */
async function showLive(
  control: RunControl<BrowserEngine>,
  live: BrowserFigureGrid,
  ticks: number,
  rule: LiveRule,
  completed: number,
) {
  for (const [x, y, radius] of control.drainStamps()) live.damage(x, y, radius);
  const pixels = await live.advance(ticks);
  const shown = pixels.slice();
  send({ type: "live", frame: { pixels: shown, seed: live.seed(), tick: live.tick(), rule, completed } }, [shown.buffer]);
  return pixels;
}

/**
 * Evaluate the current rule from tick 0 to READING_TICK on an isolated replay grid;
 * if it fires, continue to HOLD_TICK to test stability. Returns null when non-finite.
 */
async function checkpoint(
  engine: BrowserEngine,
  values: Float32Array,
  input: FigureInput,
  run: number,
  completed: number,
  began: number,
) {
  const grid = replayGrid(engine, input.kind);
  try {
    grid.set_rule(values);
    const pixels = await grid.advance(READING_TICK);
    const reading = await readIfFinite(engine, grid, input, "training", completed, began);
    if (!reading) {
      send({ type: "checkpoint", checkpoint: { run, completed, strength: 0, band: "barely", winnerFraction: 0, tick: READING_TICK,
        readMs: 0, hold: null, finite: false } });
      return null;
    }
    let hold: Checkpoint["hold"] = null;
    let finite = true;
    if (fired(reading)) {
      await grid.advance(HOLD_TICK - READING_TICK);
      const later = await readIfFinite(engine, grid, input, "training", completed, began);
      finite = later !== null;
      hold = later ? { tick: later.tick, strength: later.strength, winnerFraction: later.winnerFraction }
        : { tick: HOLD_TICK, strength: 0, winnerFraction: 0 };
    }
    send({ type: "checkpoint", checkpoint: { run, completed, strength: reading.strength, band: reading.band,
      winnerFraction: reading.winnerFraction, tick: reading.tick, readMs: reading.readMs, hold, finite } });
    return { reading, pixels, first: firstFire(input.kind, reading, hold) };
  } finally {
    grid.free();
  }
}

/**
 * One run's trainer and worker-side metadata. Held after Stop or completion so Resume
 * can continue training; a subsequent run or worker teardown frees it.
 */
interface Session {
  engine: BrowserEngine;
  blocks: number;
  training: BrowserFigure;
  input: FigureInput;
  run: number;
  /** True for basis-group mean matching, false for set methods (keepRule). */
  keepsFirstFire: boolean;
  /** Prepared target set retained for reading-ladder evaluation; null for basis-group mean. */
  set: BrowserFigureSet | null;
  /** Live-grid loop state for set methods (live-loop.ts); null for continuous basis-group mean. */
  loop: LoopGrid | null;
  /** Reading ladder measured at the last keep for a held set-method run; null while training. */
  ladder: HeldLadder | null;
  /** Cumulative update duration across all resumes. */
  trainingMs: number;
  firstKept: boolean;
  /** Latest kept final file's update count and reading. */
  kept: { update: number; reading: FigureReading } | null;
}

/** One step of a set method's reading ladder. */
interface LadderStep {
  tick: number;
  loss: number;
  reading: LiveReading | null;
  pixels: Uint8ClampedArray;
  picture: string;
}

/** Reading ladder stored for a held set-method run so the user can switch kept steps immediately. */
interface HeldLadder {
  values: Float32Array;
  completed: number;
  trainingMs: number;
  steps: LadderStep[];
}

/** Loop state for a set method's live grid: target end step and when the hold began. */
interface LoopGrid {
  end: number;
  heldSince: number | null;
}

/** Advance, hold, or restart a set method's live grid on its replay loop. */
async function turnLoop(
  control: RunControl<BrowserEngine>,
  engine: BrowserEngine,
  live: BrowserFigureGrid,
  loop: LoopGrid,
  steps: number,
  input: FigureInput,
  rule: LiveRule,
  completed: number,
  began: number,
  canRead: boolean,
): Promise<LiveReading | null> {
  const turn = loopTurn(live.tick(), loop.end, steps, loop.heldSince, control.lastStroke, performance.now());
  if (turn.kind === "restart") {
    live.restart(LIVE_SEED);
    loop.heldSince = null;
    await showLive(control, live, 0, rule, completed);
    return null;
  }
  if (turn.kind === "hold") {
    loop.heldSince ??= performance.now();
    await showLive(control, live, 0, rule, completed);
    return null;
  }
  await showLive(control, live, turn.steps, rule, completed);
  if (!turn.reachesEnd) return null;
  loop.heldSince = performance.now();
  // A non-finite grid produces no reading; the loop restarts it after the hold.
  return canRead ? readIfFinite(engine, live, input, rule, completed, began) : null;
}

type TrainingEnd = "target" | "stop" | "first fire";

function objectiveNote({ method, layers, set }: FigureObjective): string {
  if (!set) return "";
  const where = layers.length > 0 ? ` at ${layers.join(", ")}` : "";
  const source = set.source === "selection" ? "the visitor's selection" : "the group's public sample";
  return `; trained by ${method}${where} toward ${set.pictures.length} pictures, the strongest of ${source}, the ${set.neighbourhood} tokens around each patch`;
}

/** Build a format-4 material file from a rule and its measurement at `tick`. */
async function material(
  input: FigureInput,
  blocks: number,
  run: number,
  stage: KeptStage,
  values: Float32Array,
  reading: LiveReading | null,
  pixels: Uint8ClampedArray,
  completed: number,
  trainingMs: number,
  tick: number,
  ladder?: readonly LadderReading[],
) {
  const step = ladder ? `, the step of the lowest own loss of the steps ${READING_LADDER[0]} to ${READING_LADDER.at(-1)!.toLocaleString("en-US")}` : "";
  const where = `replay grid of ${SIDE} cells, seed ${LIVE_SEED}, tick ${tick}${step}, one pixel per cell`;
  const kept: FigureReading = reading ? {
    status: "measured", strength: reading.strength, winnerFraction: reading.winnerFraction,
    side: SIDE, seed: reading.seed, tick: reading.tick,
    note: `${stage === "first fire" ? "First fire" : "Final rule"}: update ${completed} of run ${run} (training seed ${input.seed})`
      + (stage === "first fire" ? `, the first checkpoint whose rule ${firstFireCondition(input.kind)}` : "")
      + objectiveNote(input.objective)
      + `; ${where}, the 8-bit picture untransformed; ${readPatches(input.kind)}; strength = mean u·c/m, u the training target's direction; wins: fewer than ${MAX_CODE_BLOCKS} of ${blocks.toLocaleString("en-US")} blocks stronger.`
      + (fired(reading) ? "" : ` Did not fire: wins below ${Math.round(FIRES * 100)} %.`),
  } : {
    status: "unmeasured", strength: null, winnerFraction: null, side: SIDE, seed: LIVE_SEED, tick,
    note: `Final rule: update ${completed} of run ${run} (training seed ${input.seed}); the ${where}, left the finite range before tick ${tick}. Did not fire.`,
  };
  return figureMaterial(input, {
    run, stage, values, reading: kept, preview: await png(pixels, SIDE), updates: completed, trainingMs, engine: ENGINE_BUILD_NAME,
    ...(ladder ? { ladder } : {}),
  });
}

/**
 * Evaluate a set method's final rule across READING_LADDER on an isolated replay grid,
 * computing own loss, reading, and preview PNG at each finite step.
 */
async function readLadder(
  engine: BrowserEngine,
  values: Float32Array,
  input: FigureInput,
  set: BrowserFigureSet,
  completed: number,
  began: number,
): Promise<LadderStep[]> {
  const grid = replayGrid(engine, input.kind);
  const request = JSON.stringify(engineRequest(input));
  const steps: LadderStep[] = [];
  try {
    grid.set_rule(values);
    for (const tick of READING_LADDER) {
      const pixels = await grid.advance(tick - grid.tick());
      if (!(await grid.finite())) break;
      const loss = await engine.figure_own_loss(grid, request, set);
      const reading = await read(engine, grid, input, "final", completed, began);
      steps.push({ tick, loss, reading, pixels, picture: await png(pixels, SIDE) });
    }
  } finally {
    grid.free();
  }
  return steps;
}

/** Emit and return the held set-method run's material file at `tick` of its reading ladder. */
async function keptAtStep(session: Session, tick: number) {
  const ladder = session.ladder;
  const step = ladder?.steps.find((each) => each.tick === tick);
  if (!ladder || !step) return null;
  const losses: LadderReading[] = ladder.steps.map(({ tick: at, loss }) => ({ tick: at, loss }));
  const file = await material(
    session.input, session.blocks, session.run, "final", ladder.values, step.reading, step.pixels, ladder.completed, ladder.trainingMs, tick, losses,
  );
  session.kept = { update: ladder.completed, reading: file.reading };
  send({ type: "ladder", ladder: { steps: ladder.steps.map(({ tick: at, loss, picture }) => ({ tick: at, loss, picture })), kept: tick } });
  if (step.reading) send({ type: "reading", reading: step.reading });
  return file;
}

/**
 * Train the session's run from its current update to its target, or until stopped or first fire.
 * Honors any stop that arrived before entry (for example during model or target-set loading).
 */
async function train(
  control: RunControl<BrowserEngine>,
  session: Session,
  live: BrowserFigureGrid,
  reader: ReaderLoad,
  began: number,
  stopAtFirstFire: boolean,
): Promise<TrainingEnd> {
  const { engine, training, input, run } = session;
  if (session.loop) session.loop.end = LIVE_LOOP_STEPS;
  session.ladder = null;
  let lastMap = performance.now();
  let mapWait = MAP_EVERY_MS;
  while (training.completed() < training.target() && !control.stopping) {
    const started = performance.now();
    const result = decodeFigureUpdate(await engine.figure_update(training));
    const updateMs = performance.now() - started;
    session.trainingMs += updateMs;
    const update = training.completed();
    const progress: GrowProgress = {
      run, completed: update, total: training.target(), batch: input.batch, trainingMs: session.trainingMs, updateMs,
      elapsedMs: performance.now() - began, loss: result.loss, method: result.method, methodLoss: result.methodLoss, codeLoss: result.codeLoss,
      overflow: result.overflow, stateMax: result.stateMax, pictureContrast: result.pictureContrast, learningRate: result.learningRate,
      readerChunks: reader.loaded, usedBytes: result.usedBytes, reservedBytes: result.reservedBytes,
    };
    send({ type: "progress", progress });
    await reader.step();
    const values = await training.values();
    live.set_rule(values);
    if (session.loop) {
      const reading = await turnLoop(control, engine, live, session.loop, LIVE_LOOP_STEPS_PER_UPDATE, input, "training", update, began, reader.ready);
      if (reading) send({ type: "reading", reading });
    } else {
      await showLive(control, live, LIVE_TICKS_PER_UPDATE, "training", update);
      if (reader.ready && update % READ_EVERY === 0) {
        const reading = await readIfFinite(engine, live, input, "training", update, began);
        if (reading) {
          send({ type: "reading", reading });
          lastMap = performance.now();
          mapWait = mapInterval(reading.readMs);
        } else {
          restartLive(control, live);
        }
      } else if (reader.ready && update % CHECKPOINT_EVERY !== 0 && performance.now() - lastMap >= mapWait) {
        const reading = await readIfFinite(engine, live, input, "training", update, began);
        lastMap = performance.now();
        if (reading) {
          mapWait = mapInterval(reading.readMs);
          const { patchCodes, selectedPatches, tick, readMs } = reading;
          send({ type: "map", patchCodes, selectedPatches, tick, completed: update, readMs });
        }
      }
    }
    if (update % CHECKPOINT_EVERY === 0 && update < training.target()) {
      await reader.finish();
      const point = await checkpoint(engine, values, input, run, update, began);
      if (point?.first && session.keepsFirstFire && !session.firstKept) {
        session.firstKept = true;
        const file = await material(input, session.blocks, run, "first fire", values, point.reading, point.pixels, update, session.trainingMs, READING_TICK);
        send({ type: "material", file, run, stage: "first fire", fired: true });
        if (stopAtFirstFire) return "first fire";
        control.setPhase("training", `First accepted checkpoint saved at update ${update}. Training goes on to update ${training.target().toLocaleString("en-US")}: `
          + "the automaton is still improving. Stop now saves the cellular model of that moment as the final one.");
      }
    }
    // Yield to the worker event loop so Stop commands can arrive between GPU updates.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return control.stopping ? "stop" : "target";
}

/** True when the trainer has completed updates since the last kept final file. */
function unkept(session: Session): boolean {
  const completed = session.training.completed();
  return completed > 0 && session.kept?.update !== completed;
}

/** Evaluate and package the session's final rule at READING_TICK or its best reading-ladder step. */
async function keepFinal(control: RunControl<BrowserEngine>, session: Session, live: BrowserFigureGrid, reader: ReaderLoad, began: number) {
  const { engine, training, input, run, trainingMs } = session;
  const completed = training.completed();
  control.setBrushOpen(false);
  try {
    const values = await training.values();
    await reader.finish();
    if (session.set) {
      control.setPhase("finishing", `Reading the final cellular model of run ${run} at steps ${READING_LADDER[0]} to ${READING_LADDER.at(-1)!.toLocaleString("en-US")}`);
      control.clearPendingStep();
      const steps = await readLadder(engine, values, input, session.set, completed, began);
      session.ladder = { values, completed, trainingMs, steps };
      const tick = readingStep(steps);
      const file = tick === null ? null : await keptAtStep(session, tick);
      if (file) {
        live.restart(LIVE_SEED);
        live.set_rule(values);
        if (session.loop) session.loop.heldSince = null;
        return file;
      }
    }
    const tick = READING_TICK;
    control.setPhase("finishing", `Running the final cellular model of run ${run} to simulation step ${tick} and measuring it`);
    live.restart(LIVE_SEED);
    live.set_rule(values);
    let pixels = await showLive(control, live, 0, "final", completed);
    while (live.tick() < tick) pixels = await showLive(control, live, Math.min(20, tick - live.tick()), "final", completed);
    const reading = await readIfFinite(engine, live, input, "final", completed, began);
    if (reading) send({ type: "reading", reading });
    send({ type: "checkpoint", checkpoint: { run, completed, strength: reading?.strength ?? 0, band: reading?.band ?? "barely",
      winnerFraction: reading?.winnerFraction ?? 0, tick, readMs: reading?.readMs ?? 0, hold: null, finite: reading !== null } });
    const file = await material(input, session.blocks, run, "final", values, reading, pixels, completed, trainingMs, tick);
    session.kept = { update: completed, reading: file.reading };
    return file;
  } finally {
    control.setBrushOpen(true);
  }
}

async function keepUnkept(control: RunControl<BrowserEngine>, session: Session, live: BrowserFigureGrid, reader: ReaderLoad, began: number) {
  if (!unkept(session)) return;
  const file = await keepFinal(control, session, live, reader, began);
  send({ type: "material", file, run: session.run, stage: "final", fired: fired(file.reading) });
}

/** Train until target or first fire, handling interactive Stop/Resume pauses along the way. */
async function trainWithStops(
  control: RunControl<BrowserEngine>,
  session: Session,
  live: BrowserFigureGrid,
  reader: ReaderLoad,
  began: number,
  stopAtFirstFire: boolean,
): Promise<Exclude<TrainingEnd, "stop">> {
  for (;;) {
    const end = await train(control, session, live, reader, began, stopAtFirstFire);
    if (end !== "stop") return end;
    control.clearStop();
    // A Stop before the first update keeps nothing; show the untrained rule live.
    if (session.training.completed() === 0) live.set_rule(await session.training.values());
    await keepUnkept(control, session, live, reader, began);
    const completed = session.training.completed();
    control.setPhase("stopped", `Stopped at optimizer update ${completed.toLocaleString("en-US")}. Resume trains on from here.`);
    await liveLoop(control, live, session, reader.ready, began, ["resume-training"]);
    control.clearStop();
    control.setPhase("training", session.firstKept ? "Still improving after the first accepted checkpoint" : "Training on this device");
  }
}

function heldLoop(session: Session): LoopGrid | null {
  if (!session.loop) return null;
  session.loop.end = session.kept?.reading.tick ?? LIVE_LOOP_STEPS;
  return session.loop;
}

/** Run the live replay grid while held until the visitor sends an accepted decision. */
async function liveLoop(
  control: RunControl<BrowserEngine>,
  live: BrowserFigureGrid,
  held: Session,
  readerReady: boolean,
  began: number,
  accepts: readonly RunDecision[],
): Promise<RunDecision> {
  const { engine, input } = held;
  const completed = held.training.completed();
  const loop = heldLoop(held);
  control.clearDecision();
  let lastRead = performance.now();
  for (;;) {
    const chosen = control.takeDecision(accepts);
    if (chosen !== null) return chosen;
    const step = control.takePendingStep();
    if (step !== null) {
      const file = await keptAtStep(held, step);
      if (file && loop) {
        send({ type: "material", file, run: held.run, stage: "final", fired: fired(file.reading) });
        loop.end = step;
        loop.heldSince = null;
        live.restart(LIVE_SEED);
      }
    }
    const started = performance.now();
    if (loop) {
      const reading = await turnLoop(control, engine, live, loop, LIVE_TICKS_PER_FRAME, input, "final", completed, began, readerReady);
      if (reading) send({ type: "reading", reading });
    } else {
      await showLive(control, live, LIVE_TICKS_PER_FRAME, "final", completed);
    }
    if (readerReady && !loop && performance.now() - lastRead >= LIVE_READ_MS) {
      const reading = await readIfFinite(engine, live, input, "final", completed, began);
      if (reading) send({ type: "reading", reading });
      else restartLive(control, live);
      lastRead = performance.now();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, FRAME_MS - (performance.now() - started))));
  }
}

/** Hold the finished run live, extending training by RESUME_UPDATES whenever resumed. */
async function holdRun(
  control: RunControl<BrowserEngine>,
  session: Session,
  live: BrowserFigureGrid,
  reader: ReaderLoad,
  began: number,
  stopAtFirstFire: boolean,
): Promise<never> {
  for (;;) {
    control.setPhase("live", "The automaton keeps running here.");
    await liveLoop(control, live, session, reader.ready, began, ["resume-training"]);
    control.clearStop();
    if (session.training.completed() >= session.training.target()) session.training.extend(RESUME_UPDATES);
    control.setPhase("training", session.firstKept ? "Still improving after the first accepted checkpoint" : "Training on this device");
    const end = await trainWithStops(control, session, live, reader, began, stopAtFirstFire);
    if (end === "first fire") live.restart(LIVE_SEED);
    else await keepUnkept(control, session, live, reader, began);
  }
}

function createTraining(
  engine: BrowserEngine,
  input: FigureInput,
  command: Extract<GrowCommand, { type: "start" }>,
  set: BrowserFigureSet | null,
): BrowserFigure {
  const request = JSON.stringify(engineRequest(input));
  if (!command.continuation) return set ? engine.create_figure_on_set(request, set) : engine.create_figure(request);
  const { source } = command.continuation;
  const training = set
    ? engine.create_figure_continued_on_set(request, set, source.values, source.fromUpdate)
    : engine.create_figure_continued(request, source.values, source.fromUpdate);
  if (training.completed() >= training.target()) training.extend(RESUME_UPDATES);
  return training;
}

async function prepareTargetSet(
  control: RunControl<BrowserEngine>,
  engine: BrowserEngine,
  input: FigureInput,
  given: FigureTargetSet,
  location: { baseUrl: string; release: string },
) {
  control.setPhase("loading", "Finding the target set's pictures…");
  const library = await openLibrary(location);
  const { pictures } = given;
  const fetched = await fetchSetPictures(pictures, (imageId) => library.previewUrl(imageId), fetch,
    (answered) => control.setPhase("loading", `Fetching the target set's pictures · ${answered}/${pictures.length}`));
  if (fetched.pictures.length === 0) throw new Error("None of the target set's pictures could be fetched.");
  control.setPhase("loading", `Preparing the target set: ${fetched.pictures.length} pictures through DINO…`);
  const patches = Uint32Array.from(fetched.pictures, (picture) => picture.patch);
  const set = await engine.prepare_figure_set(JSON.stringify(engineRequest(input)), fetched.pngs, patches);
  return { set, record: targetSetRecord(given.source, fetched.pictures) };
}

/** Load models once, train runs according to the method's retry rule, then hold the result live. */
async function grow(control: RunControl<BrowserEngine>, command: Extract<GrowCommand, { type: "start" }>) {
  const began = performance.now();
  control.setPhase("loading", "Loading the training models on this device…");
  const release = await fetchModelRelease(command.release);
  const assets = new AssetLoader(command.release.baseUrl);
  await assets.open();
  const summary = decodeLookSummary(JSON.parse(new TextDecoder().decode(
    await assets.bytes(`${LOOK_CLOUDS_PATH}/summaries/${command.request.block}.json`))));
  if (summary.release !== release.release) throw new Error("The basis group summary belongs to a different release.");
  const dictionaryId = release.dictionary.replace(/^model\//, "").replace(/\/$/, "");
  const continuation = command.continuation;
  if (continuation && continuation.source.dictionaryId !== dictionaryId) {
    throw new Error("This automaton definition belongs to another basis collection than this release's.");
  }
  const chosen: FigureObjective = continuation?.source.objective ?? { method: command.method, layers: command.layers, set: command.set };
  let input = figureInput(command.request, summary, dictionaryId, command.kind, command.batch, 1, { ...chosen, set: null });
  send({ type: "input", anchor: input.anchor, medianNorm: input.medianNorm, direction: input.direction, batch: input.batch });
  const engine = await loadModel(control, release, assets, input.block);
  let set: BrowserFigureSet | null = null;
  let objective: FigureObjective = input.objective;
  let live: BrowserFigureGrid | null = null;
  let session: Session | null = null;
  try {
    if (methodNeedsSet(chosen.method)) {
      if (!chosen.set || chosen.set.pictures.length === 0) throw new Error("A set method needs a target set of one or more pictures.");
      const prepared = await prepareTargetSet(control, engine, input, chosen.set, { baseUrl: command.release.baseUrl, release: release.release });
      set = prepared.set;
      const codes = set.codes();
      const tokenPictures = set.token_pictures();
      send({ type: "set", codes, tokenPictures }, [codes.buffer, tokenPictures.buffer]);
      objective = { ...input.objective, set: prepared.record };
    }
    control.setPhase("loading", "Preparing the training grid…");
    const index = decodeReaderIndex(JSON.parse(new TextDecoder().decode(await assets.bytes(`${release.dictionary}reader.json`))), release);
    const reader = new ReaderLoad(engine, index.files, assets);
    live = replayGrid(engine, input.kind);
    const runs = plannedRuns(continuation !== undefined, objective.method);
    const rule = keepRule(objective.method, continuation !== undefined, RUNS);
    const stopAtFirstFire = command.stopAtFirstFire && rule.keepsFirstFire;
    for (let run = 1; run <= runs; run++) {
      input = figureInput(command.request, summary, dictionaryId, command.kind, command.batch, run, objective);
      if (continuation) input = continuedInput(input, continuation.source, continuation.change);
      send({ type: "run", run, runs, seed: input.seed, method: objective.method });
      control.setPhase("training", run === 1 ? "Preparing the first training update…" : "Training on this device");
      session?.training.free();
      session = null;
      const training = createTraining(engine, input, command, set);
      session = {
        engine, blocks: release.blocks, training, input, run, keepsFirstFire: rule.keepsFirstFire, set,
        loop: set ? { end: LIVE_LOOP_STEPS, heldSince: null } : null, ladder: null,
        trainingMs: 0, firstKept: false, kept: null,
      };
      const end = await trainWithStops(control, session, live, reader, began, stopAtFirstFire);
      if (end === "first fire") {
        live.restart(LIVE_SEED);
        break;
      }
      await keepUnkept(control, session, live, reader, began);
      const reading = session.kept!.reading;
      if (afterRun(run, runs, session.firstKept || fired(reading)) !== "retry") break;
      control.setPhase("retry", `Run ${run} did not meet the selection target (selection fraction ${Math.round((reading.winnerFraction ?? 0) * 100)} % at step ${READING_TICK}). `
        + "Restart from the next seed, or keep this automaton.");
      const choice = await liveLoop(control, live, session, reader.ready, began, ["restart", "keep"]);
      if (choice === "keep") break;
      live.restart(LIVE_SEED);
    }
    await holdRun(control, session!, live, reader, began, stopAtFirstFire);
  } finally {
    session?.training.free();
    set?.free();
    live?.free();
  }
}

self.onmessage = ({ data }: MessageEvent<GrowCommand>) => {
  if (data.type !== "start") {
    activeRun?.handleCommand(data);
    return;
  }
  if (activeRun !== null) return;
  const control = createRunControl<BrowserEngine>((event) => send(event));
  activeRun = control;
  void grow(control, data)
    .catch((error: unknown) => send({ type: "error", message: String(error) }))
    .finally(() => {
      control.dispose();
      if (activeRun === control) activeRun = null;
    });
};
