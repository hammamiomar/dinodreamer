// Per-run control state and figure_update payload validation for grow.worker.ts.
// Keeping all mutable run state inside a RunControl created per `start` guarantees
// a clean slate on every run and deterministic disposal in `finally` after errors.

import { decodeNumber, decodeObject } from "../decode";
import { FIGURE_METHODS, type FigureMethod } from "../materials/material-file";
import type { GrowCommand, GrowEvent } from "./protocol";

export type GrowPhase = Extract<GrowEvent, { type: "phase" }>["phase"];

/** User choice accepted while the live grid holds a stopped or finished rule. */
export type RunDecision = "resume-training" | "restart" | "keep";

export interface DisposableEngine {
  free(): void;
}

export interface FigureUpdateMetrics {
  loss: number;
  method: FigureMethod;
  methodLoss: number;
  codeLoss: number;
  overflow: number;
  stateMax: number;
  pictureContrast: number;
  learningRate: number;
  usedBytes?: number;
  reservedBytes?: number;
}

/** Validate and decode the JSON returned by BrowserEngine.figure_update(). */
export function decodeFigureUpdate(raw: string): FigureUpdateMetrics {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid figure_update payload: expected JSON.");
  }
  const record = decodeObject(parsed, "figure_update");
  if (!(FIGURE_METHODS as readonly unknown[]).includes(record.method)) {
    throw new Error(`figure_update.method: expected one of ${FIGURE_METHODS.join(", ")}`);
  }
  const usedBytes = record.usedBytes === undefined ? undefined : decodeNumber(record.usedBytes, "figure_update.usedBytes");
  const reservedBytes = record.reservedBytes === undefined ? undefined : decodeNumber(record.reservedBytes, "figure_update.reservedBytes");
  return {
    loss: decodeNumber(record.loss, "figure_update.loss"),
    method: record.method as FigureMethod,
    methodLoss: decodeNumber(record.methodLoss, "figure_update.methodLoss"),
    codeLoss: decodeNumber(record.codeLoss, "figure_update.codeLoss"),
    overflow: decodeNumber(record.overflow, "figure_update.overflow"),
    stateMax: decodeNumber(record.stateMax, "figure_update.stateMax"),
    pictureContrast: decodeNumber(record.pictureContrast, "figure_update.pictureContrast"),
    learningRate: decodeNumber(record.learningRate, "figure_update.learningRate"),
    ...(usedBytes !== undefined ? { usedBytes } : {}),
    ...(reservedBytes !== undefined ? { reservedBytes } : {}),
  };
}

export interface RunControl<TEngine extends DisposableEngine = DisposableEngine> {
  readonly phase: GrowPhase;
  readonly stopping: boolean;
  readonly brushOpen: boolean;
  readonly lastStroke: number | null;
  readonly engine: TEngine | undefined;
  setPhase(next: GrowPhase, message: string): void;
  setEngine(engine: TEngine | undefined): void;
  handleCommand(command: Exclude<GrowCommand, { type: "start" }>, now?: number): void;
  /** Consume and return the pending decision when accepted; clear any unmatched decision. */
  takeDecision(accepts: readonly RunDecision[]): RunDecision | null;
  clearDecision(): void;
  /** Consume a pending stop when entering or leaving a stopped hold. */
  clearStop(): void;
  /** Consume and return any pending reading-ladder step choice. */
  takePendingStep(): number | null;
  clearPendingStep(): void;
  /** Drain queued brush stamps to apply before the next live frame. */
  drainStamps(): [number, number, number][];
  /** Enable or disable brush input; disabling discards queued stamps so kept readings stay clean. */
  setBrushOpen(open: boolean): void;
  /** Release the GPU engine and reset all mutable fields. Idempotent. */
  dispose(): void;
}

export function createRunControl<TEngine extends DisposableEngine>(
  send: (event: GrowEvent) => void,
): RunControl<TEngine> {
  let currentPhase: GrowPhase = "loading";
  let stopping = false;
  let decision: RunDecision | null = null;
  let pendingStep: number | null = null;
  const stamps: [number, number, number][] = [];
  let brushOpen = true;
  let lastStroke: number | null = null;
  let engine: TEngine | undefined;

  return {
    get phase() {
      return currentPhase;
    },
    get stopping() {
      return stopping;
    },
    get brushOpen() {
      return brushOpen;
    },
    get lastStroke() {
      return lastStroke;
    },
    get engine() {
      return engine;
    },
    setPhase(next, message) {
      currentPhase = next;
      send({ type: "phase", phase: next, message });
    },
    setEngine(next) {
      engine = next;
    },
    handleCommand(command, now = performance.now()) {
      switch (command.type) {
        case "stop":
          stopping = true;
          return;
        case "resume-training":
        case "restart":
        case "keep":
          decision = command.type;
          return;
        case "keep-at-step":
          pendingStep = command.step;
          return;
        case "brush":
          if (brushOpen) {
            stamps.push(...command.stamps);
            lastStroke = now;
          }
          break;
      }
    },
    takeDecision(accepts) {
      const current = decision;
      decision = null;
      return current !== null && accepts.includes(current) ? current : null;
    },
    clearDecision() {
      decision = null;
    },
    clearStop() {
      stopping = false;
    },
    takePendingStep() {
      const step = pendingStep;
      pendingStep = null;
      return step;
    },
    clearPendingStep() {
      pendingStep = null;
    },
    drainStamps() {
      return stamps.splice(0);
    },
    setBrushOpen(open) {
      brushOpen = open;
      if (!open) stamps.length = 0;
    },
    dispose() {
      engine?.free();
      engine = undefined;
      stopping = false;
      decision = null;
      pendingStep = null;
      stamps.length = 0;
      brushOpen = false;
      lastStroke = null;
    },
  };
}
