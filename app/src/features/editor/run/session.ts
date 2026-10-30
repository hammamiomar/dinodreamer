// The editor's view of the synthesis worker: what it has acknowledged, what it
// last measured, and which command to send next.
//
// The worker owns the applied recipe and the image. This session records only
// what the worker reported, plus the visitor's wishes (run, pause, step, restart).
// `planCommand` turns the two into at most one command at a time; the hook in
// use-run.ts sends it and records it with a `sent` action. All of this is pure.

import { validateRecipe, type Recipe } from "../../../recipe";
import { sameTarget } from "../model";
import { codeMasses, meanCode, type Code } from "../readout/readout";
import { MOVEMENT_SERIES, frameMovement, meanMovement, type MovementRecord } from "./movement";
import type {
  CodeMeasurement,
  Command,
  Event,
  Phase,
  ReleaseLocation,
  TermMeasurement,
} from "../../../synthesis/protocol";

/** How many recent frames the term sparklines keep. */
export const HISTORY_STEPS = 200;
/** How many recent step durations the rate readout averages. */
const RATE_WINDOW = 10;
/** How many recent mean codes the code-space trail shows per request. */
export const MEAN_TRAIL = 30;

/** One re-seed the Noise tool asked for: the painted cells and the seed drawn for the stroke. */
export interface Reseed {
  cells: boolean[];
  seed: number;
}

/**
 * One operation of the run sequence that a replay must repeat for the same image: the
 * fresh start from a seed, and every re-seed since with its cells, seed and step.
 */
export type SequenceEvent =
  | { type: "start"; seed: number }
  /** The image began as a stored picture at `step`: a replay starts from the same PNG. */
  | { type: "restore"; step: number; picture: Uint8Array }
  | { type: "reseed"; step: number; seed: number; cells: boolean[] };

/**
 * An opened creation's picture to continue from: sent once the applied revision is at
 * least `afterRevision` (the opened recipe's), before anything else acts on the image.
 * `opened` is the editor's generation of the creation, so the stage knows whose picture it is.
 */
export interface RestoreRequest {
  picture: Uint8Array;
  step: number;
  afterRevision: number;
  opened: number;
  sent: boolean;
}

/** The editor's latest recipe: what the worker should apply next. */
export interface DesiredRecipe {
  revision: number;
  recipe: Recipe;
}

export interface FrameRecord {
  revision: number;
  /** Updates completed before the pictured image. */
  step: number;
  views: number;
  loss: number;
  terms: TermMeasurement[];
  pixels: Uint8ClampedArray;
  elapsedMs: number;
  /** GPU pool counters after the update, when the backend exposes them. */
  gpu?: { usedBytes: number; reservedBytes: number };
  /** performance.now() when the event arrived, for the measurement age. */
  receivedAt: number;
}

export interface MeasurementRecord {
  revision: number;
  step: number;
  terms: TermMeasurement[];
  codes: CodeMeasurement[];
  pixels: Uint8ClampedArray;
  receivedAt: number;
}

/** The objective the worker acknowledged, with the recipe the app sent for that revision. */
export interface AppliedObjective {
  revision: number;
  recipe: Recipe;
  /** Completed-update count when the objective was installed. */
  step: number;
  resetAdam: boolean;
  rebased: boolean;
}

/** Recent weighted values of one term, oldest first. */
export interface TermSeries {
  steps: number[];
  values: number[];
}

/** The total loss is kept under this key next to the term ids. */
export const TOTAL_SERIES = "total";

export interface RunState {
  phase: Phase;
  phaseMessage?: string;
  /** The last phase outside preparation: whether the worker is stepping between applies. */
  settledPhase: "idle" | "ready" | "running" | "paused";
  capabilities?: { webgpu: boolean; adapter?: string; reason?: string };
  progress?: { bytesDone: number; bytesTotal: number; cacheHits: number; message: string };
  error?: { message: string; fatal: boolean };

  /** The visitor pressed Play and has not paused since. */
  wantsRunning: boolean;
  stepRequested: boolean;
  /** A restart the visitor asked for and the app has not sent yet. */
  restartSeed?: number;
  /** The opened creation's picture, from the request until the worker restores or refuses it. */
  restore?: RestoreRequest;
  /** How the last restore of a generation ended: restored, or dropped (refused, or a Reset replaced it). */
  restoreOutcome?: { opened: number; result: "restored" | "dropped" };
  /** Re-seeds the visitor painted and the app has not sent yet, oldest first. */
  reseedQueue: Reseed[];
  /** Re-seeds sent and not yet acknowledged, oldest first; the acknowledgement carries no cells. */
  reseedsSent: Reseed[];

  loadSent: boolean;
  /** Run or pause sent and not yet confirmed by a phase event. */
  controlSent: "run" | "pause" | null;
  /** The apply sent and not yet answered. At most one. */
  pending?: DesiredRecipe;
  applied?: AppliedObjective;
  rejected?: { revision: number; message: string };
  /** The worker's answer to the last run or step it could not honor, until the visitor asks again. */
  refused?: { command: "run" | "step"; message: string };

  frame?: FrameRecord;
  /** What the latest update did to the image (movement.ts); none for the first frame after an apply, a restart or a re-seed. */
  movement?: MovementRecord;
  /** A re-seed landed since the last frame: the next frame shows it, not an update. */
  reseededSinceFrame: boolean;
  /** The operations a replay of this image must repeat, in order (SequenceEvent). */
  sequence: SequenceEvent[];
  measurement?: MeasurementRecord;
  /** Recent values per term id, plus the total loss (TOTAL_SERIES) and the mean movement (MOVEMENT_SERIES). */
  history: Record<string, TermSeries>;
  /** Mean measured code per request id, oldest first, from recent measurements. */
  meanTrail: Record<number, Code[]>;
  recentStepMs: number[];
}

export function createRunState(): RunState {
  return {
    phase: "idle",
    settledPhase: "idle",
    wantsRunning: false,
    stepRequested: false,
    loadSent: false,
    controlSent: null,
    reseedQueue: [],
    reseedsSent: [],
    reseededSinceFrame: false,
    sequence: [],
    history: {},
    meanTrail: {},
    recentStepMs: [],
  };
}

export type RunAction =
  /** The client was disposed and recreated after a fatal error; the visitor asked to run again. */
  | { type: "clientReplaced" }
  | { type: "requestRun" }
  | { type: "requestPause" }
  | { type: "requestStep" }
  | { type: "requestRestart"; seed: number }
  /** An opened creation continues from its picture; replaces any restore not yet answered. */
  | { type: "requestRestore"; restore: Omit<RestoreRequest, "sent"> }
  /** The Noise tool: a finished stroke's cells with the seed drawn for it. */
  | { type: "requestReseed"; cells: boolean[]; seed: number }
  | { type: "sent"; command: Command }
  | { type: "event"; event: Event; receivedAt: number };

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "clientReplaced":
      return { ...createRunState(), wantsRunning: true };
    case "requestRun":
      return { ...state, wantsRunning: true, refused: undefined, error: state.error?.fatal ? state.error : undefined };
    case "requestPause":
      return { ...state, wantsRunning: false, stepRequested: false };
    case "requestStep":
      return { ...state, wantsRunning: false, stepRequested: true, refused: undefined };
    case "requestRestart": {
      // A Reset (or a creation opened without a picture) replaces a restore not yet answered.
      const dropped = dropRestore(state);
      // Before the first apply there is no image to replace: the recipe's seed starts it.
      return dropped.applied ? { ...dropped, restartSeed: action.seed } : dropped;
    }
    case "requestRestore":
      // Kept even before the first apply: a creation reopened on load continues from its picture once the worker is up.
      return { ...dropRestore(state), restartSeed: undefined, restore: { ...action.restore, sent: false } };
    case "requestReseed":
      // Before the first apply there is no image to re-seed; the stroke is dropped.
      return state.applied ? { ...state, reseedQueue: [...state.reseedQueue, { cells: action.cells, seed: action.seed }] } : state;
    case "sent":
      return recordSent(state, action.command);
    case "event":
      return receiveEvent(state, action.event, action.receivedAt);
  }
}

// ---------------------------------------------------------------------------
// Which command to send next

const LOADED_PHASES: ReadonlySet<Phase> = new Set(["ready", "preparing", "running", "paused"]);

/** The worker holds the model: it has loaded it, whatever it does now. */
export function modelLoaded(state: RunState): boolean {
  return LOADED_PHASES.has(state.phase);
}

/**
 * The next command, or null. Order: load once the visitor first asks for steps;
 * pause, which has priority and may go while an apply is pending; apply the latest
 * valid recipe when nothing is pending; then re-seeds in the order painted, restart,
 * step and run, which wait for the pending apply. An invalid recipe is never sent;
 * the cards show its problems instead. The worker measures after every frame, apply,
 * pause, step, restart and re-seed, so the plan never needs `measure`; that command
 * is only an explicit refresh.
 */
export function planCommand(state: RunState, desired: DesiredRecipe, release: ReleaseLocation): Command | null {
  if (state.phase === "failed" || state.error?.fatal) return null;

  const wantsWorker = state.wantsRunning || state.stepRequested;
  if (!state.loadSent) return wantsWorker ? { type: "load", release } : null;
  if (!LOADED_PHASES.has(state.phase)) return null;

  // Running, or a run sent and not yet confirmed: the latest control must become pause.
  const mayBeRunning = state.settledPhase === "running" || state.controlSent === "run";
  if (!state.wantsRunning && mayBeRunning && state.controlSent !== "pause") return { type: "pause" };

  if (shouldApply(state, desired)) return { type: "apply", revision: desired.revision, recipe: desired.recipe };
  if (!state.applied || state.pending) return null;

  const stopped = state.settledPhase === "ready" || state.settledPhase === "paused";
  // An opened creation's picture goes first, once its recipe is applied; until then nothing acts on the image.
  const restore = state.restore;
  if (restore && !restore.sent) {
    if (state.applied.revision < restore.afterRevision) return null;
    return { type: "restore", picture: restore.picture, step: restore.step };
  }
  const reseed = state.reseedQueue[0];
  if (reseed) return { type: "reseed", cells: reseed.cells, seed: reseed.seed };
  if (state.restartSeed !== undefined) return { type: "restart", seed: state.restartSeed };
  if (state.stepRequested && stopped) return { type: "step" };
  if (state.wantsRunning && stopped && state.controlSent !== "run") return { type: "run" };
  return null;
}

function shouldApply(state: RunState, desired: DesiredRecipe): boolean {
  if (state.pending) return false;
  if (state.applied?.revision === desired.revision) return false;
  if (state.rejected?.revision === desired.revision) return false;
  return validateRecipe(desired.recipe).length === 0;
}

function recordSent(state: RunState, command: Command): RunState {
  switch (command.type) {
    case "load":
      return { ...state, loadSent: true };
    case "apply":
      return { ...state, pending: { revision: command.revision, recipe: command.recipe } };
    case "restart":
      return { ...state, restartSeed: undefined };
    case "reseed": {
      const [head, ...rest] = state.reseedQueue;
      if (!head) return state;
      return { ...state, reseedQueue: rest, reseedsSent: [...state.reseedsSent, head] };
    }
    case "step":
      return { ...state, stepRequested: false };
    case "run":
    case "pause":
      return { ...state, controlSent: command.type };
    case "restore":
      return state.restore ? { ...state, restore: { ...state.restore, sent: true } } : state;
    case "measure":
    case "dispose":
      return state;
  }
}

// ---------------------------------------------------------------------------
// What the worker reported

function receiveEvent(state: RunState, event: Event, receivedAt: number): RunState {
  switch (event.type) {
    case "phase":
      return receivePhase(state, event.phase, event.message);
    case "capabilities":
      return { ...state, capabilities: { webgpu: event.webgpu, adapter: event.adapter, reason: event.reason } };
    case "progress":
      return {
        ...state,
        progress: {
          bytesDone: event.bytesDone,
          bytesTotal: event.bytesTotal,
          cacheHits: event.cacheHits,
          message: event.message,
        },
      };
    case "applied":
      return receiveApplied(state, event);
    case "rejected":
      // The worker keeps its previous objective. With none applied there is nothing to run.
      return {
        ...state,
        pending: state.pending?.revision === event.revision ? undefined : state.pending,
        rejected: { revision: event.revision, message: event.message },
        wantsRunning: state.applied ? state.wantsRunning : false,
      };
    case "refused":
      // A refused re-seed is dropped: the stroke is gone, the image unchanged, nothing to ask again.
      if (event.command === "reseed") return { ...state, reseedsSent: state.reseedsSent.slice(1) };
      // A refused picture (one the worker cannot read) falls back to the recipe's seed image.
      if (event.command === "restore") {
        const seed = state.applied?.recipe.seed;
        return { ...dropRestore(state), ...(seed !== undefined ? { restartSeed: seed } : {}) };
      }
      // An explicit answer: stop asking for the refused command until the visitor asks again.
      return {
        ...state,
        refused: { command: event.command, message: event.message },
        controlSent: event.command === "run" && state.controlSent === "run" ? null : state.controlSent,
        wantsRunning: event.command === "run" ? false : state.wantsRunning,
      };
    case "restored": {
      // The stored picture is the image now, at its step: as after a restart, earlier frames,
      // measurements and sparklines describe another image.
      const restored = state.restore;
      return {
        ...state,
        restore: undefined,
        restoreOutcome: restored ? { opened: restored.opened, result: "restored" } : state.restoreOutcome,
        applied: state.applied ? { ...state.applied, step: event.step } : undefined,
        frame: undefined,
        movement: undefined,
        reseededSinceFrame: false,
        sequence: restored ? [{ type: "restore", step: event.step, picture: restored.picture }] : state.sequence,
        measurement: undefined,
        history: {},
        meanTrail: {},
        recentStepMs: [],
      };
    }
    case "restarted":
      // A fresh image: earlier frames, measurements and sparklines describe another image,
      // and the applied objective acts on it from step 0.
      return {
        ...state,
        applied: state.applied ? { ...state.applied, step: 0 } : undefined,
        frame: undefined,
        movement: undefined,
        reseededSinceFrame: false,
        sequence: [{ type: "start", seed: event.seed }],
        measurement: undefined,
        history: {},
        meanTrail: {},
        recentStepMs: [],
      };
    case "reseeded": {
      // The oldest sent re-seed is the one acknowledged; the record keeps its cells for a replay.
      const [sent, ...rest] = state.reseedsSent;
      const cells = sent?.cells ?? [];
      return {
        ...state,
        reseedsSent: rest,
        reseededSinceFrame: true,
        sequence: [...state.sequence, { type: "reseed", step: event.step, seed: event.seed, cells }],
      };
    }
    case "frame":
      return receiveFrame(state, event, receivedAt);
    case "measurement":
      return {
        ...state,
        // Only measurements of the applied objective extend its trails; an earlier one is in flight.
        meanTrail: event.revision === state.applied?.revision ? appendMeanTrail(state.meanTrail, event.codes, state.applied.recipe) : state.meanTrail,
        measurement: {
          revision: event.revision,
          step: event.step,
          terms: event.terms,
          codes: event.codes,
          pixels: event.pixels,
          receivedAt,
        },
      };
    case "error":
      return {
        ...state,
        error: { message: event.message, fatal: event.fatal },
        // The worker pauses after any error; resuming is the visitor's decision.
        wantsRunning: false,
      };
  }
}

/**
 * Run and pause are confirmed only by the matching phase; a phase event already on its
 * way when the command was sent does not count. A run the worker cannot honor is answered
 * with `refused`, not with a phase change.
 */
function receivePhase(state: RunState, phase: Phase, message?: string): RunState {
  const settled = phase === "ready" || phase === "running" || phase === "paused";
  const confirmed =
    (state.controlSent === "run" && phase === "running") ||
    (state.controlSent === "pause" && (phase === "paused" || phase === "ready"));
  return {
    ...state,
    phase,
    phaseMessage: message,
    settledPhase: settled ? phase : state.settledPhase,
    controlSent: confirmed ? null : state.controlSent,
    wantsRunning: phase === "failed" ? false : state.wantsRunning,
  };
}

function receiveApplied(state: RunState, event: Extract<Event, { type: "applied" }>): RunState {
  const pending = state.pending;
  if (!pending || pending.revision !== event.revision) {
    // Not the apply this session sent; without its recipe the panels cannot label it.
    return state;
  }
  return {
    ...state,
    pending: undefined,
    rejected: undefined,
    meanTrail: trailsForApplied(state.meanTrail, state.applied?.recipe, pending.recipe),
    // The first apply starts the image from the recipe's seed; later applies keep the image and its sequence.
    sequence: state.applied ? state.sequence : [{ type: "start", seed: pending.recipe.seed }],
    applied: {
      revision: event.revision,
      recipe: pending.recipe,
      step: event.step,
      resetAdam: event.resetAdam,
      rebased: event.rebased,
    },
  };
}

function receiveFrame(state: RunState, event: Extract<Event, { type: "frame" }>, receivedAt: number): RunState {
  const frame: FrameRecord = {
    revision: event.revision,
    step: event.step,
    views: event.views,
    loss: event.loss,
    terms: event.terms,
    pixels: event.pixels,
    elapsedMs: event.elapsedMs,
    gpu: event.gpu,
    receivedAt,
  };
  const movement = state.reseededSinceFrame ? undefined : movementBetween(state.frame, frame);
  return {
    ...state,
    frame,
    movement,
    reseededSinceFrame: false,
    history: appendHistory(state.history, frame, movement),
    recentStepMs: [...state.recentStepMs, frame.elapsedMs].slice(-RATE_WINDOW),
  };
}

/**
 * The movement from the previous delivered frame to this one, when both show the same
 * objective's image one or more updates apart. After an apply the revision differs and
 * after a restart there is no previous frame: the first frame has no movement. (After a
 * re-seed, receiveFrame skips it too: that frame shows the re-seed, not an update.)
 */
function movementBetween(previous: FrameRecord | undefined, frame: FrameRecord): MovementRecord | undefined {
  if (!previous || previous.revision !== frame.revision || frame.step <= previous.step) return undefined;
  const cells = frameMovement(previous.pixels, frame.pixels);
  if (!cells) return undefined;
  return { step: frame.step, cells, mean: meanMovement(cells) };
}

function appendHistory(history: Record<string, TermSeries>, frame: FrameRecord, movement?: MovementRecord): Record<string, TermSeries> {
  const next: Record<string, TermSeries> = { ...history };
  const samples: [string, number][] = [
    ...frame.terms.map((term): [string, number] => [term.id, term.weighted]),
    [TOTAL_SERIES, frame.loss],
    ...(movement ? [[MOVEMENT_SERIES, movement.mean] as [string, number]] : []),
  ];
  for (const [id, value] of samples) {
    const series = history[id] ?? { steps: [], values: [] };
    next[id] = {
      steps: [...series.steps, frame.step].slice(-HISTORY_STEPS),
      values: [...series.values, value].slice(-HISTORY_STEPS),
    };
  }
  return next;
}

/**
 * Trails follow a request's target, not only its id: removing the last request and
 * adding another reuses its id. A trail stays only for a request the new objective
 * still has with the same target (model.ts sameTarget).
 */
function trailsForApplied(trails: Record<number, Code[]>, previous: Recipe | undefined, next: Recipe): Record<number, Code[]> {
  const kept: Record<number, Code[]> = {};
  for (const request of next.requests) {
    const trail = trails[request.id];
    const before = previous?.requests.find((candidate) => candidate.id === request.id);
    if (trail && before && sameTarget(before, request)) kept[request.id] = trail;
  }
  return kept;
}

function appendMeanTrail(trail: Record<number, Code[]>, codes: CodeMeasurement[], applied: Recipe): Record<number, Code[]> {
  const next: Record<number, Code[]> = { ...trail };
  for (const measurement of codes) {
    const request = applied.requests.find((candidate) => candidate.id === measurement.requestId);
    if (!request) continue;
    const masses = codeMasses(measurement.slots, request.respondLike.where);
    const mean = meanCode(measurement.codes, masses);
    if (!mean) continue;
    next[measurement.requestId] = [...(trail[measurement.requestId] ?? []), mean].slice(-MEAN_TRAIL);
  }
  return next;
}

/** Ends a restore not yet answered as dropped, so the stage stops showing its picture. */
function dropRestore(state: RunState): RunState {
  if (!state.restore) return state;
  return { ...state, restore: undefined, restoreOutcome: { opened: state.restore.opened, result: "dropped" } };
}

// ---------------------------------------------------------------------------
// Readouts derived from the session

/** Steps per second over the recent window, or undefined before the first frame. */
export function stepsPerSecond(state: RunState): number | undefined {
  if (state.recentStepMs.length === 0) return undefined;
  const meanMs = state.recentStepMs.reduce((sum, ms) => sum + ms, 0) / state.recentStepMs.length;
  return meanMs > 0 ? 1000 / meanMs : undefined;
}

/**
 * The newest image the worker sent, with the terms measured on it. A measurement and a
 * frame with equal step show the same pixels; the measurement has no shift, so it wins a tie.
 * Every step label on screen is this image's step, so the label always names what is drawn.
 */
export interface ShownImage {
  kind: "frame" | "measurement";
  revision: number;
  step: number;
  terms: TermMeasurement[];
  pixels: Uint8ClampedArray;
  receivedAt: number;
}

export function latestShown(state: RunState): ShownImage | undefined {
  const { frame, measurement } = state;
  if (measurement && (!frame || measurement.step >= frame.step)) return { kind: "measurement", ...measurement };
  if (frame) return { kind: "frame", ...frame };
  return undefined;
}

/**
 * The step at which the image began: a restored picture's step, else 0 for an image
 * started from a seed. Only an image past this step carries an update of this session's run;
 * the restored picture, its measurements and a re-seed of it do not (the stored-picture rule,
 * app/creation-autosave.ts).
 */
export function imageStartStep(state: RunState): number {
  const first = state.sequence[0];
  return first?.type === "restore" ? first.step : 0;
}
