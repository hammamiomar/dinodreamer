import { BrowserEngine, type BrowserFigure, type BrowserFigureGrid, type BrowserFigureSet } from "dinodreamer-engine";
import { initializeEngine } from "../app/engine-wasm";
import { ENGINE_BUILD_NAME } from "../app/config";
import { AssetLoader, blockPath, fetchModelRelease, type ModelRelease } from "../synthesis/assets";
import { decodeReaderIndex, type ReaderChunk } from "../reader/assets";
import { LOOK_CLOUDS_PATH, decodeLookSummary } from "../library/look-cloud";
import { openLibrary } from "../library/library";
import { methodNeedsSet, type FigureReading, type FigureTargetSet } from "../materials/material-file";
import {
  CHECKPOINT_EVERY, HOLD_TICK, LIVE_SEED, READING_LADDER, READING_TICK, RESUME_UPDATES, RUNS, afterRun, continuedInput, engineRequest, figureInput,
  figureMaterial, fired, firstFire, firstFireCondition, plannedRuns, readPatches, readingStep, strengthBand, type FigureInput, type FigureObjective,
  type KeptStage, type LadderReading,
} from "./figure-recipe";
import { fetchSetPictures, targetSetRecord } from "./target-set";
import { keepRule } from "./train-method";
import { LIVE_LOOP_STEPS, LIVE_LOOP_STEPS_PER_UPDATE, loopTurn } from "./live-loop";
import { coSelection, type CoSelectedColumns } from "./co-selection";
import type { MaterialKind } from "./material-kind";
import { adapterUnavailable, type Checkpoint, type GrowCommand, type GrowEvent, type GrowProgress, type LiveReading, type LiveRule } from "./protocol";

/** Live ticks per training update: the material visibly forms while the rule trains. */
const LIVE_TICKS_PER_UPDATE = 8;
/** Updates between readings while training, once the reader is loaded. */
const READ_EVERY = 10;
/** The least time between two readings of the shown grid for the live map while training (the "map" event). */
const MAP_EVERY_MS = 1000;
/**
 * The live map's greatest share of the training time (nara, 17 November 2026). A reading for the map
 * waits until the time since the last reading is its cost divided by this share, so the map costs at
 * most 3 % on any device. Measured on the Alienware's RTX 2080 Super at a fixed 1 s: 110 to 120 ms
 * a reading, 5.6 to 6.9 % of the training time; the rule then spaces them about 4 s apart there.
 */
const MAP_TIME_SHARE = 0.03;

/** The time to wait after a reading that took `readMs` before the next reading for the map. */
function mapInterval(readMs: number): number {
  return Math.max(MAP_EVERY_MS, readMs / MAP_TIME_SHARE);
}
/** Ticks per frame after training, and the time between readings then. */
const LIVE_TICKS_PER_FRAME = 4;
const LIVE_READ_MS = 2000;
const FRAME_MS = 33;
/** Further adapter requests, and the wait before each, when the browser has no adapter at first (adapterUnavailable). */
const ADAPTER_RETRIES = 2;
const ADAPTER_RETRY_MS = 1500;

const send = (event: GrowEvent, transfer: Transferable[] = []) => self.postMessage(event, { transfer });
let currentPhase: Extract<GrowEvent, { type: "phase" }>["phase"] = "loading";
const phase = (state: typeof currentPhase, message: string) => {
  currentPhase = state;
  send({ type: "phase", phase: state, message });
};
let busy = false;
/** The person asked to stop the current run's training now; its trainer is held and its rule kept. */
let stopping = false;
/** What the person chose while the live grid grows a held rule (liveLoop): Resume, or after a run that did not meet the target, the next seed or this rule. */
type Decision = "resume-training" | "restart" | "keep";
let decision: Decision | null = null;
/** A step of the held run's ladder the person chose to keep its automaton at (keep-at-step); applied by liveLoop. */
let pendingStep: number | null = null;
/** Brush stamps for the live grid, applied before its next frame. None while a kept reading grows. */
const stamps: [number, number, number][] = [];
let brushOpen = true;
/** When the latest brush stamps arrived: a set method's loop waits for the brush before it starts again (live-loop.ts). */
let lastStroke: number | null = null;
let engine: BrowserEngine | undefined;

async function png(pixels: Uint8ClampedArray, side: number): Promise<string> {
  const canvas = new OffscreenCanvas(side, side);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), side, side), 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:image/png;base64,${btoa(binary)}`;
}

/** The dictionary reader loads one chunk between updates, so training starts at once. */
class ReaderLoad {
  private next = 0;
  constructor(private chunks: ReaderChunk[], private assets: AssetLoader) {}
  get loaded() { return this.next; }
  get ready() { return this.next === this.chunks.length; }
  async step() {
    if (this.ready) return;
    const chunk = this.chunks[this.next];
    engine!.load_reader_chunk(chunk.firstBlock, chunk.blocks, await this.assets.bytes(chunk));
    this.next++;
  }
  async finish() { while (!this.ready) await this.step(); }
}

/** The engine, asking again for an adapter when the browser had none to give at first. */
async function createEngine(): Promise<BrowserEngine> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await BrowserEngine.create();
    } catch (error) {
      if (attempt >= ADAPTER_RETRIES || !adapterUnavailable(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, ADAPTER_RETRY_MS));
    }
  }
}

async function loadModel(release: ModelRelease, assets: AssetLoader, block: number) {
  phase("loading", "Preparing graphics on this device…");
  await initializeEngine();
  engine = await createEngine();
  engine.on_device_lost((message: string) => send({ type: "error", message, deviceLost: true }));
  const files = [...release.encoder, release.calibration];
  for (const [index, file] of files.entries()) {
    phase("loading", `Loading the training models · ${index + 1}/${files.length}`);
    const bytes = await assets.bytes(file);
    if (index === 0) engine.load_stem(bytes);
    else if (index < files.length - 1) engine.load_layer(index - 1, bytes);
    else engine.load_calibration(bytes);
  }
  phase("loading", "Loading the basis group…");
  engine.load_frame(block, await assets.bytes(blockPath(release, block)));
}

async function read(live: BrowserFigureGrid, input: FigureInput, rule: LiveRule, completed: number, began: number): Promise<LiveReading> {
  const started = performance.now();
  const result = await engine!.figure_reading(live, input.block, new Float32Array(input.direction), input.medianNorm) as
    { strength: number; winnerFraction: number; selectedPatches: Uint8Array; patchCodes: Float32Array; tick: number; seed: number } & CoSelectedColumns;
  return {
    patchCodes: result.patchCodes, strength: result.strength, winnerFraction: result.winnerFraction, selectedPatches: result.selectedPatches, coSelection: coSelection(result, input.block),
    tick: result.tick, seed: result.seed, band: strengthBand(result.strength, input), rule, completed,
    elapsedMs: performance.now() - began, readMs: performance.now() - started,
  };
}

/**
 * Read a grid, or null when its state has left the finite range. A rule can diverge on a long
 * replay; the reader cannot read such a picture, and the caller decides what that means.
 */
async function readIfFinite(grid: BrowserFigureGrid, input: FigureInput, rule: LiveRule, completed: number, began: number) {
  return await grid.finite() ? read(grid, input, rule, completed, began) : null;
}

/** A replay grid of the kind's rule and start, on the Keep replay contract with seed LIVE_SEED. */
function replayGrid(kind: MaterialKind) {
  return engine!.create_figure_grid(LIVE_SEED, kind.rule, kind.start);
}

/** The live grid starts again from the seed's start, keeping its rule; the training is unaffected. */
function restartLive(live: BrowserFigureGrid) {
  const tick = live.tick();
  live.restart(LIVE_SEED);
  phase(currentPhase, `The live grid left the finite range at simulation step ${tick.toLocaleString("en-US")}; it starts again.`);
}

/** Transfer a copy of the advanced grid to the page; the caller keeps the pixels for saving. */
async function showLive(live: BrowserFigureGrid, ticks: number, rule: LiveRule, completed: number) {
  for (const [x, y, radius] of stamps.splice(0)) live.damage(x, y, radius);
  const pixels = await live.advance(ticks);
  const shown = pixels.slice();
  send({ type: "live", frame: { pixels: shown, seed: live.seed(), tick: live.tick(), rule, completed } }, [shown.buffer]);
  return pixels;
}

/**
 * The rule of the moment grown from tick 0 to 600 on its own replay grid and read, as at keeping;
 * if it fires, grown on to tick 2,000 and read again. Returns the tick-600 reading and picture,
 * and whether this is a first fire; null when the grid left the finite range by tick 600.
 */
async function checkpoint(values: Float32Array, input: FigureInput, run: number, completed: number, began: number) {
  const grid = replayGrid(input.kind);
  try {
    grid.set_rule(values);
    const pixels = await grid.advance(READING_TICK);
    const reading = await readIfFinite(grid, input, "training", completed, began);
    if (!reading) {
      send({ type: "checkpoint", checkpoint: { run, completed, strength: 0, band: "barely", winnerFraction: 0, tick: READING_TICK,
        readMs: 0, hold: null, finite: false } });
      return null;
    }
    let hold: Checkpoint["hold"] = null;
    let finite = true;
    if (fired(reading)) {
      await grid.advance(HOLD_TICK - READING_TICK);
      const later = await readIfFinite(grid, input, "training", completed, began);
      finite = later !== null;
      hold = later ? { tick: later.tick, strength: later.strength, winnerFraction: later.winnerFraction }
        : { tick: HOLD_TICK, strength: 0, winnerFraction: 0 };
    }
    send({ type: "checkpoint", checkpoint: { run, completed, strength: reading.strength, band: reading.band,
      winnerFraction: reading.winnerFraction, tick: reading.tick, readMs: reading.readMs, hold, finite } });
    return { reading, pixels, first: firstFire(input.kind, reading, hold) };
  } finally { grid.free(); }
}

/**
 * One run's trainer and what the worker knows of it. It is held after Stop and after the run ends,
 * so Resume can train on; a new run or the end of the worker frees it.
 */
interface Session {
  training: BrowserFigure;
  input: FigureInput;
  run: number;
  /** Whether the run keeps its first fire (keepRule): basis-group mean matching does, a set method does not. */
  keepsFirstFire: boolean;
  /** A set method's prepared set, kept after the run for the reading ladder (ownLossLadder); null for basis-group mean. */
  set: BrowserFigureSet | null;
  /** A set method's live grid loop (live-loop.ts); null for basis-group mean, whose live grid grows on. */
  loop: LoopGrid | null;
  /** A held set-method run's reading ladder, read at its last keep; null while it trains and for basis-group mean. */
  ladder: HeldLadder | null;
  /** Sum of complete update calls, over every Resume. */
  trainingMs: number;
  firstKept: boolean;
  /** The run's last kept final file: its update and its reading. */
  kept: { update: number; reading: FigureReading } | null;
}

/** One step of a set method's reading ladder: the method's own loss, the reading and the picture there, and the picture as a PNG. */
interface LadderStep {
  tick: number;
  loss: number;
  reading: LiveReading | null;
  pixels: Uint8ClampedArray;
  picture: string;
}

/** A held set-method run's ladder (decision 12): the rule it was read from, at which update, and its steps. */
interface HeldLadder {
  values: Float32Array;
  completed: number;
  trainingMs: number;
  steps: LadderStep[];
}

/** A set method's live grid on its loop: the step it grows to, and when the hold of that step's picture began. */
interface LoopGrid {
  end: number;
  heldSince: number | null;
}

/**
 * One turn of a set method's live grid on its loop (live-loop.ts loopTurn): grow up to `steps` toward the
 * loop's end, and on reaching it read the picture there, the loop's one reading, when `canRead`; or hold
 * that picture, with the brush's stamps; or start again from the live seed's start. The reading, or null.
 */
async function turnLoop(live: BrowserFigureGrid, loop: LoopGrid, steps: number, input: FigureInput, rule: LiveRule, completed: number,
  began: number, canRead: boolean): Promise<LiveReading | null> {
  const turn = loopTurn(live.tick(), loop.end, steps, loop.heldSince, lastStroke, performance.now());
  if (turn.kind === "restart") {
    live.restart(LIVE_SEED);
    loop.heldSince = null;
    await showLive(live, 0, rule, completed);
    return null;
  }
  if (turn.kind === "hold") {
    loop.heldSince ??= performance.now();
    await showLive(live, 0, rule, completed);
    return null;
  }
  await showLive(live, turn.steps, rule, completed);
  if (!turn.reachesEnd) return null;
  loop.heldSince = performance.now();
  // A grid that left the finite range gives no reading; the loop starts it again after the hold.
  return canRead ? readIfFinite(live, input, rule, completed, began) : null;
}

/** How a stretch of training ended: at the run's target update, by the person's Stop, or at its first fire (`stopAtFirstFire`). */
type TrainingEnd = "target" | "stop" | "first fire";

/** How a set method trained, for the kept note: its loss, its layers and its set; nothing for basis-group mean matching. */
function objectiveNote({ method, layers, set }: FigureObjective): string {
  if (!set) return "";
  const where = layers.length > 0 ? ` at ${layers.join(", ")}` : "";
  const source = set.source === "selection" ? "the visitor's selection" : "the group's public sample";
  return `; trained by ${method}${where} toward ${set.pictures.length} pictures, the strongest of ${source}, the ${set.neighbourhood} tokens around each patch`;
}

/**
 * A kept file from a rule and its reading at `tick` on the replay grid (null: the grid left the finite
 * range); a set method's `ladder` names the steps it was read at and why this one (readingStep).
 */
async function material(input: FigureInput, run: number, stage: KeptStage, values: Float32Array, reading: LiveReading | null,
  pixels: Uint8ClampedArray, completed: number, trainingMs: number, tick: number, ladder?: readonly LadderReading[]) {
  const step = ladder ? `, the step of the lowest own loss of the steps ${READING_LADDER[0]} to ${READING_LADDER.at(-1)!.toLocaleString("en-US")}` : "";
  const where = `replay grid of 128 cells, seed ${LIVE_SEED}, tick ${tick}${step}, one pixel per cell`;
  const kept: FigureReading = reading ? {
    status: "measured", strength: reading.strength, winnerFraction: reading.winnerFraction,
    side: 128, seed: reading.seed, tick: reading.tick,
    note: `${stage === "first fire" ? "First fire" : "Final rule"}: update ${completed} of run ${run} (training seed ${input.seed})`
      + (stage === "first fire" ? `, the first checkpoint whose rule ${firstFireCondition(input.kind)}` : "")
      + objectiveNote(input.objective)
      + `; ${where}, the 8-bit picture untransformed; ${readPatches(input.kind)}; strength = mean u·c/m, u the training target's direction; wins: fewer than 32 of 16,384 blocks stronger.`
      + (fired(reading) ? "" : " Did not fire: wins below 90 %."),
  } : {
    status: "unmeasured", strength: null, winnerFraction: null, side: 128, seed: LIVE_SEED, tick,
    note: `Final rule: update ${completed} of run ${run} (training seed ${input.seed}); the ${where}, left the finite range before tick ${tick}. Did not fire.`,
  };
  return figureMaterial(input, {
    run, stage, values, reading: kept, preview: await png(pixels, 128), updates: completed, trainingMs, engine: ENGINE_BUILD_NAME,
    ...(ladder ? { ladder } : {}),
  });
}

/**
 * A set method's final rule grown on its own replay grid of the live seed through READING_LADDER: at each
 * step, the method's own loss on the picture against the run's set (figure_own_loss; decision 12), the
 * reading and the picture, so the automaton can be kept at any step at once (keptAtStep). A grid that
 * leaves the finite range ends the ladder there. The reader must be loaded.
 */
async function readLadder(values: Float32Array, input: FigureInput, set: BrowserFigureSet, completed: number, began: number): Promise<LadderStep[]> {
  const grid = replayGrid(input.kind);
  const request = JSON.stringify(engineRequest(input));
  const steps: LadderStep[] = [];
  try {
    grid.set_rule(values);
    for (const tick of READING_LADDER) {
      const pixels = await grid.advance(tick - grid.tick());
      if (!(await grid.finite())) break;
      const loss = await engine!.figure_own_loss(grid, request, set);
      const reading = await read(grid, input, "final", completed, began);
      steps.push({ tick, loss, reading, pixels, picture: await png(pixels, 128) });
    }
  } finally {
    grid.free();
  }
  return steps;
}

/**
 * The held set-method run's file kept at `tick` of its ladder: that step's reading, picture and poster,
 * under the same id as at any other step. Tells the page the kept step. Null when the ladder has no such step.
 */
async function keptAtStep(session: Session, tick: number) {
  const ladder = session.ladder;
  const step = ladder?.steps.find((each) => each.tick === tick);
  if (!ladder || !step) return null;
  const losses: LadderReading[] = ladder.steps.map(({ tick: at, loss }) => ({ tick: at, loss }));
  const file = await material(session.input, session.run, "final", ladder.values, step.reading, step.pixels, ladder.completed, ladder.trainingMs, tick, losses);
  session.kept = { update: ladder.completed, reading: file.reading };
  send({ type: "ladder", ladder: { steps: ladder.steps.map(({ tick: at, loss, picture }) => ({ tick: at, loss, picture })), kept: tick } });
  if (step.reading) send({ type: "reading", reading: step.reading });
  return file;
}

/**
 * Train the session's run from its held update to its target (update 1,000, or more after a Resume
 * past it), or until the person stops it. The first fire is kept at once, from its checkpoint's own
 * replay grid, so the live view is not disturbed. With `stopAtFirstFire` the run ends there, and
 * that rule is the run's only material.
 */
async function train(session: Session, live: BrowserFigureGrid, reader: ReaderLoad, began: number, stopAtFirstFire: boolean): Promise<TrainingEnd> {
  const { training, input, run } = session;
  stopping = false;
  // A set method's loop grows to LIVE_LOOP_STEPS while it trains; a grid past it (after a hold at the kept step) holds, then starts again.
  if (session.loop) session.loop.end = LIVE_LOOP_STEPS;
  // A ladder belongs to the rule it was read from; training changes the rule.
  session.ladder = null;
  // When the shown grid was last read, by a reading or for the live map, and the wait that reading earns.
  let lastMap = performance.now();
  let mapWait = MAP_EVERY_MS;
  while (training.completed() < training.target() && !stopping) {
    const started = performance.now();
    const result = JSON.parse(await engine!.figure_update(training));
    const updateMs = performance.now() - started;
    session.trainingMs += updateMs;
    const update = training.completed();
    const progress: GrowProgress = {
      run, completed: update, total: training.target(), batch: input.batch, trainingMs: session.trainingMs, updateMs,
      elapsedMs: performance.now() - began, loss: result.loss, method: result.method, methodLoss: result.methodLoss, codeLoss: result.codeLoss,
      overflow: result.overflow,
      stateMax: result.stateMax, pictureContrast: result.pictureContrast, learningRate: result.learningRate, readerChunks: reader.loaded,
      usedBytes: result.usedBytes, reservedBytes: result.reservedBytes,
    };
    send({ type: "progress", progress });
    await reader.step();
    const values = await training.values();
    live.set_rule(values);
    if (session.loop) {
      // A set method's live grid loops to LIVE_LOOP_STEPS and is read there once a loop; no reading falls mid-loop.
      const reading = await turnLoop(live, session.loop, LIVE_LOOP_STEPS_PER_UPDATE, input, "training", update, began, reader.ready);
      if (reading) send({ type: "reading", reading });
    } else {
      // Basis-group mean's live grid grows on, read every READ_EVERY updates and, between, for the live map.
      await showLive(live, LIVE_TICKS_PER_UPDATE, "training", update);
      if (reader.ready && update % READ_EVERY === 0) {
        const reading = await readIfFinite(live, input, "training", update, began);
        if (reading) {
          send({ type: "reading", reading });
          lastMap = performance.now();
          mapWait = mapInterval(reading.readMs);
        } else {
          restartLive(live);
        }
      } else if (reader.ready && update % CHECKPOINT_EVERY !== 0 && performance.now() - lastMap >= mapWait) {
        // Between the readings, the live map's reading of the shown grid; never in an update that runs a checkpoint.
        const reading = await readIfFinite(live, input, "training", update, began);
        lastMap = performance.now();
        if (reading) {
          mapWait = mapInterval(reading.readMs);
          const { patchCodes, selectedPatches, tick, readMs } = reading;
          send({ type: "map", patchCodes, selectedPatches, tick, completed: update, readMs });
        }
      }
    }
    // The target update's checkpoint is the final reading.
    if (update % CHECKPOINT_EVERY === 0 && update < training.target()) {
      await reader.finish();
      const point = await checkpoint(values, input, run, update, began);
      if (point?.first && session.keepsFirstFire && !session.firstKept) {
        session.firstKept = true;
        const file = await material(input, run, "first fire", values, point.reading, point.pixels, update, session.trainingMs, READING_TICK);
        send({ type: "material", file, run, stage: "first fire", fired: true });
        if (stopAtFirstFire) return "first fire";
        phase("training", `First accepted checkpoint saved at update ${update}. Training goes on to update ${training.target().toLocaleString("en-US")}: `
          + "the automaton is still improving. Stop now saves the cellular model of that moment as the final one.");
      }
    }
    // Let a Stop message run between GPU updates.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return stopping ? "stop" : "target";
}

/** Whether the held rule differs from the run's last kept final file: Stop right after Resume trains nothing new. */
function unkept(session: Session): boolean {
  const completed = session.training.completed();
  return completed > 0 && session.kept?.update !== completed;
}

/**
 * The final rule grows from the live seed's start; its reading at its step goes into the kept file:
 * tick 600 for basis-group mean matching, and for a set method the step of the lowest own loss of
 * READING_LADDER (readingStep; tick 600 when no step has a finite loss).
 */
async function keepFinal(session: Session, live: BrowserFigureGrid, reader: ReaderLoad, began: number) {
  const { training, input, run, trainingMs } = session;
  const completed = training.completed();
  // The kept reading is the undisturbed replay; the brush waits until it is read.
  brushOpen = false;
  stamps.length = 0;
  const values = await training.values();
  await reader.finish();
  if (session.set) {
    // A set method keeps its automaton at the step of the lowest own loss of its ladder; the live grid then loops to it.
    phase("finishing", `Reading the final cellular model of run ${run} at steps ${READING_LADDER[0]} to ${READING_LADDER.at(-1)!.toLocaleString("en-US")}`);
    pendingStep = null;
    const steps = await readLadder(values, input, session.set, completed, began);
    session.ladder = { values, completed, trainingMs, steps };
    const tick = readingStep(steps);
    const file = tick === null ? null : await keptAtStep(session, tick);
    if (file) {
      brushOpen = true;
      live.restart(LIVE_SEED);
      live.set_rule(values);
      if (session.loop) session.loop.heldSince = null;
      return file;
    }
  }
  const tick = READING_TICK;
  phase("finishing", `Running the final cellular model of run ${run} to simulation step ${tick} and measuring it`);
  live.restart(LIVE_SEED);
  live.set_rule(values);
  let pixels = await showLive(live, 0, "final", completed);
  while (live.tick() < tick) pixels = await showLive(live, Math.min(20, tick - live.tick()), "final", completed);
  const reading = await readIfFinite(live, input, "final", completed, began);
  if (reading) send({ type: "reading", reading });
  brushOpen = true;
  send({ type: "checkpoint", checkpoint: { run, completed, strength: reading?.strength ?? 0, band: reading?.band ?? "barely",
    winnerFraction: reading?.winnerFraction ?? 0, tick, readMs: reading?.readMs ?? 0, hold: null, finite: reading !== null } });
  const file = await material(input, run, "final", values, reading, pixels, completed, trainingMs, tick);
  session.kept = { update: completed, reading: file.reading };
  return file;
}

/** Keep the held rule as the run's final file unless it is kept already. */
async function keepUnkept(session: Session, live: BrowserFigureGrid, reader: ReaderLoad, began: number) {
  if (!unkept(session)) return;
  const file = await keepFinal(session, live, reader, began);
  send({ type: "material", file, run: session.run, stage: "final", fired: fired(file.reading) });
}

/**
 * Train the run to its target or its first fire. Each Stop keeps the rule of that moment, holds the
 * run while the live grid grows it, and Resume trains on from the next update, so the run goes on
 * as if it had not stopped: the same updates, then the same first fire, target and retry.
 */
async function trainWithStops(session: Session, live: BrowserFigureGrid, reader: ReaderLoad, began: number,
  stopAtFirstFire: boolean): Promise<Exclude<TrainingEnd, "stop">> {
  for (;;) {
    const end = await train(session, live, reader, began, stopAtFirstFire);
    if (end !== "stop") return end;
    // A Stop before the run's first update keeps nothing; the live grid grows the untrained rule.
    if (session.training.completed() === 0) live.set_rule(await session.training.values());
    await keepUnkept(session, live, reader, began);
    const completed = session.training.completed();
    phase("stopped", `Stopped at optimizer update ${completed.toLocaleString("en-US")}. Resume trains on from here.`);
    await liveLoop(live, session, completed, began, ["resume-training"]);
    phase("training", session.firstKept ? "Still improving after the first accepted checkpoint" : "Training on this device");
  }
}

/**
 * A held set-method run's loop: to the automaton's own step, the kept file's reading step (readingStep),
 * or LIVE_LOOP_STEPS before anything is kept. Null for basis-group mean.
 */
function heldLoop(session: Session): LoopGrid | null {
  if (!session.loop) return null;
  session.loop.end = session.kept?.reading.tick ?? LIVE_LOOP_STEPS;
  return session.loop;
}

/**
 * The live grid grows the held rule until the person decides one of `accepts`: Resume after a Stop
 * or a run's end, the next seed or this rule after a run that did not meet the target. The caller
 * names the hold's phase first. `completed`: the update of the held rule.
 */
async function liveLoop(live: BrowserFigureGrid, held: Session, completed: number, began: number, accepts: readonly Decision[]): Promise<Decision> {
  const { input } = held;
  const loop = heldLoop(held);
  decision = null;
  let lastRead = performance.now();
  for (;;) {
    if (decision !== null && accepts.includes(decision)) return decision;
    decision = null;
    // A set method's automaton kept at another step of its ladder: its file again, and the loop grows to that step.
    if (pendingStep !== null) {
      const step = pendingStep;
      pendingStep = null;
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
      // A set method's held grid loops to its own step, read there once a loop.
      const reading = await turnLoop(live, loop, LIVE_TICKS_PER_FRAME, input, "final", completed, began, true);
      if (reading) send({ type: "reading", reading });
    } else {
      await showLive(live, LIVE_TICKS_PER_FRAME, "final", completed);
    }
    if (!loop && performance.now() - lastRead >= LIVE_READ_MS) {
      const reading = await readIfFinite(live, input, "final", completed, began);
      if (reading) send({ type: "reading", reading });
      else restartLive(live);
      lastRead = performance.now();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, FRAME_MS - (performance.now() - started))));
  }
}

/**
 * The last run after it has ended: the live grid grows its rule until the person resumes. Resume
 * trains RESUME_UPDATES past the target, or on to it after a stop at the first fire.
 */
async function holdRun(session: Session, live: BrowserFigureGrid, reader: ReaderLoad, began: number, stopAtFirstFire: boolean): Promise<never> {
  for (;;) {
    phase("live", "The automaton keeps running here.");
    await liveLoop(live, session, session.training.completed(), began, ["resume-training"]);
    if (session.training.completed() >= session.training.target()) session.training.extend(RESUME_UPDATES);
    phase("training", session.firstKept ? "Still improving after the first accepted checkpoint" : "Training on this device");
    const end = await trainWithStops(session, live, reader, began, stopAtFirstFire);
    if (end === "first fire") live.restart(LIVE_SEED);
    else await keepUnkept(session, live, reader, began);
  }
}

/**
 * The trainer of one run: from the random initialization of the input's seed, or, for a continuation,
 * from the saved definition's rule with a fresh optimizer and pool, RESUME_UPDATES on when the
 * definition was saved at or past its last update. A set method trains on its prepared set.
 */
function createTraining(input: FigureInput, command: Extract<GrowCommand, { type: "start" }>, set: BrowserFigureSet | null): BrowserFigure {
  const request = JSON.stringify(engineRequest(input));
  if (!command.continuation) return set ? engine!.create_figure_on_set(request, set) : engine!.create_figure(request);
  const { source } = command.continuation;
  const training = set
    ? engine!.create_figure_continued_on_set(request, set, source.values, source.fromUpdate)
    : engine!.create_figure_continued(request, source.values, source.fromUpdate);
  if (training.completed() >= training.target()) training.extend(RESUME_UPDATES);
  return training;
}

/**
 * A set method's target set (target-set.ts), as the page resolved it or the continued definition records
 * it: the pictures' previews fetched, a picture that cannot be fetched dropped, and the rest prepared by
 * the engine in one DINO pass. The record keeps the set's source and names the pictures it prepared, in
 * set order. The block's frame must be loaded.
 */
async function prepareTargetSet(input: FigureInput, given: FigureTargetSet, location: { baseUrl: string; release: string }) {
  phase("loading", "Finding the target set's pictures…");
  const library = await openLibrary(location);
  const { pictures } = given;
  const fetched = await fetchSetPictures(pictures, (imageId) => library.previewUrl(imageId), fetch,
    (answered) => phase("loading", `Fetching the target set's pictures · ${answered}/${pictures.length}`));
  if (fetched.pictures.length === 0) throw new Error("None of the target set's pictures could be fetched.");
  phase("loading", `Preparing the target set: ${fetched.pictures.length} pictures through DINO…`);
  const patches = Uint32Array.from(fetched.pictures, (picture) => picture.patch);
  const set = await engine!.prepare_figure_set(JSON.stringify(engineRequest(input)), fetched.pngs, patches);
  return { set, record: targetSetRecord(given.source, fetched.pictures) };
}

/**
 * Load once, then train runs until one fires (afterRun); Stop holds a run until Resume, and the last
 * run trains on when resumed. A continuation trains one run from its saved definition, with no retry.
 */
async function grow(command: Extract<GrowCommand, { type: "start" }>) {
  const began = performance.now();
  phase("loading", "Loading the training models on this device…");
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
  // A continuation trains toward what its definition trained toward; a new run toward the chosen method.
  const chosen: FigureObjective = continuation?.source.objective ?? { method: command.method, layers: command.layers, set: command.set };
  let input = figureInput(command.request, summary, dictionaryId, command.kind, command.batch, 1, { ...chosen, set: null });
  send({ type: "input", anchor: input.anchor, medianNorm: input.medianNorm, direction: input.direction, batch: input.batch });
  await loadModel(release, assets, input.block);
  let set: BrowserFigureSet | null = null;
  let objective: FigureObjective = input.objective;
  if (methodNeedsSet(chosen.method)) {
    if (!chosen.set || chosen.set.pictures.length === 0) throw new Error("A set method needs a target set of one or more pictures.");
    const prepared = await prepareTargetSet(input, chosen.set, { baseUrl: command.release.baseUrl, release: release.release });
    set = prepared.set;
    // The live map's target: the set's tokens in the patches' code space.
    const codes = set.codes();
    const tokenPictures = set.token_pictures();
    send({ type: "set", codes, tokenPictures }, [codes.buffer, tokenPictures.buffer]);
    objective = { ...input.objective, set: prepared.record };
  }
  phase("loading", "Preparing the training grid…");
  const index = decodeReaderIndex(JSON.parse(new TextDecoder().decode(await assets.bytes(`${release.dictionary}reader.json`))), release);
  const reader = new ReaderLoad(index.files, assets);
  const live = replayGrid(input.kind);
  const runs = plannedRuns(continuation !== undefined, objective.method);
  const rule = keepRule(objective.method, continuation !== undefined, RUNS);
  // A set method trains to the end (keepRule): it never stops at a first fire.
  const stopAtFirstFire = command.stopAtFirstFire && rule.keepsFirstFire;
  let session: Session | null = null;
  try {
    for (let run = 1; run <= runs; run++) {
      input = figureInput(command.request, summary, dictionaryId, command.kind, command.batch, run, objective);
      if (continuation) input = continuedInput(input, continuation.source, continuation.change);
      send({ type: "run", run, runs, seed: input.seed, method: objective.method });
      phase("training", run === 1 ? "Preparing the first training update…" : "Training on this device");
      // A new run frees the run before it; cleared first, so the finally below never frees it twice.
      session?.training.free();
      session = null;
      const training = createTraining(input, command, set);
      session = {
        training, input, run, keepsFirstFire: rule.keepsFirstFire, set, loop: set ? { end: LIVE_LOOP_STEPS, heldSince: null } : null, ladder: null,
        trainingMs: 0, firstKept: false, kept: null,
      };
      const end = await trainWithStops(session, live, reader, began, stopAtFirstFire);
      if (end === "first fire") {
        // The live grid already grows the first-fire rule; it starts again from the seed's start.
        live.restart(LIVE_SEED);
        break;
      }
      // A Stop at the target update has kept this rule already.
      await keepUnkept(session, live, reader, began);
      const reading = session.kept!.reading;
      if (afterRun(run, runs, session.firstKept || fired(reading)) !== "retry") break;
      // The person chooses: the next seed, or this rule as the result, which holdRun grows.
      phase("retry", `Run ${run} did not meet the selection target (selection fraction ${Math.round((reading.winnerFraction ?? 0) * 100)} % at step ${READING_TICK}). `
        + `Restart from the next seed, or keep this automaton.`);
      const choice = await liveLoop(live, session, session.training.completed(), began, ["restart", "keep"]);
      if (choice === "keep") break;
      live.restart(LIVE_SEED);
    }
    await holdRun(session!, live, reader, began, stopAtFirstFire);
  } finally {
    session?.training.free();
    set?.free();
    live.free();
  }
}

self.onmessage = ({ data }: MessageEvent<GrowCommand>) => {
  if (data.type === "stop") { stopping = true; return; }
  if (data.type === "resume-training" || data.type === "restart" || data.type === "keep") { decision = data.type; return; }
  if (data.type === "keep-at-step") { pendingStep = data.step; return; }
  if (data.type === "brush") {
    if (brushOpen) {
      stamps.push(...data.stamps);
      lastStroke = performance.now();
    }
    return;
  }
  if (busy) return;
  busy = true;
  void grow(data).catch((error: unknown) => send({ type: "error", message: String(error) })).finally(() => {
    engine?.free(); engine = undefined; busy = false;
  });
};
