import type { MaterialAnchor, MaterialRequest, StrengthBand } from "../recipe";
import type { Control, FigureLayer, FigureMaterialFile, FigureMethod, FigureTargetSet } from "../materials/material-file";
import type { KeptStage } from "./figure-recipe";
import type { CoSelection } from "./co-selection";
import type { ContinuationChange, ContinuationSource } from "./continuation";
import type { MaterialKind } from "./material-kind";
import type { ReleaseLocation } from "../synthesis/protocol";

/**
 * Whether an error is the browser answering the request for a GPU adapter with none. On an iPhone
 * 16 Pro Max this happened on the first page load after a run took the page down, and a reload
 * then had an adapter again (2026-10-30). wgpu reports it as "No adapter available ... webgpu
 * found no adapters".
 */
export function adapterUnavailable(message: string): boolean {
  return /no adapter available|found no adapters/i.test(message);
}

export interface GrowProgress {
  /** Which run of RUNS, 1-based; a run that did not fire is followed by the next seed. */
  run: number;
  completed: number;
  /** The run's last update: 1,000, or more after a Resume past it. */
  total: number;
  batch: 1 | 4;
  /** Sum of complete update calls, including their small readbacks. */
  trainingMs: number;
  /** Since the Grow click, including loading, the live grid and readings. */
  elapsedMs: number;
  updateMs: number;
  /** The method's loss plus 10 × overflow: what the update descends. */
  loss: number;
  method: FigureMethod;
  /** The method's own loss; for basis-group mean matching the same as codeLoss. */
  methodLoss: number;
  /** ‖mean code − k‖² / m², the basis-group mean loss; under a set method a reading only. */
  codeLoss: number;
  overflow: number;
  stateMax: number;
  /** Standard deviation of the training pictures (rgb_std), a contrast measure. */
  pictureContrast: number;
  learningRate: number;
  /** Reader chunks loaded so far, of 32; readings start when all are loaded. */
  readerChunks: number;
  usedBytes?: number;
  reservedBytes?: number;
}

/** "training": the live grid grows with the rule of the moment; "final": with the finished rule, from tick 0. */
export type LiveRule = "training" | "final";

export interface LiveFrame {
  pixels: Uint8ClampedArray;
  seed: number;
  tick: number;
  rule: LiveRule;
  completed: number;
}

export interface LiveReading {
  /**
   * The group's code of each of the 64 patches, row-major on the 8 × 8 grid, patch t at [3t, 3t + 3): the
   * calibrated token projected on the group's frame, not divided by a gate, as the group map's cloud codes.
   */
  patchCodes: Float32Array;
  /** Mean over the read patches of u·c_t / m: all 64, or the central 4 × 4 for a seeded start. */
  strength: number;
  band: StrengthBand;
  winnerFraction: number;
  /** Per patch of the 8 × 8 grid, all 64, 1 where the requested group is selected: the panel's map (selection-map.ts). */
  selectedPatches: Uint8Array;
  /** The co-selected basis groups of the read patches (co-selection.ts). */
  coSelection: CoSelection;
  seed: number;
  tick: number;
  rule: LiveRule;
  completed: number;
  elapsedMs: number;
  readMs: number;
}

/**
 * Every CHECKPOINT_EVERY updates: the rule of the moment grown from tick 0 to 600 and read; when
 * that fires, the same grid grows on to HOLD_TICK and is read again (`hold`).
 */
export interface Checkpoint {
  run: number;
  completed: number;
  strength: number;
  band: StrengthBand;
  winnerFraction: number;
  tick: number;
  readMs: number;
  hold: { tick: number; strength: number; winnerFraction: number } | null;
  /** False when the grid left the finite range: such a checkpoint counts as not fired. */
  finite: boolean;
}

export type GrowCommand =
  /**
   * `stopAtFirstFire`: end a run at its first fire; otherwise train on to update 1,000 and keep the final rule too.
   * `method` and a token method's `layers` (train-method.ts). `set`: a set method's target set as the page resolved
   * and shows it (target-set.ts), which the worker fetches and prepares; null for basis-group mean matching and for a
   * continuation, which prepares its definition's own (`continuation.source.objective`).
   */
  | { type: "start"; request: MaterialRequest; release: ReleaseLocation; kind: MaterialKind; method: FigureMethod; layers: FigureLayer[];
    set: FigureTargetSet | null; batch: 1 | 4; stopAtFirstFire: boolean;
    /** Train on from a saved definition (Train resume, case 2): one run from its rule, not new seeds. */
    continuation?: { source: ContinuationSource; change: ContinuationChange } }
  /** Stop the current run's training now: keep its rule as the final one and hold its trainer. */
  | { type: "stop" }
  /** Train the held run on from its update, or RESUME_UPDATES past its last update when it has reached it. */
  | { type: "resume-training" }
  /** After a run whose last update did not meet the selection target: train the next seed. */
  | { type: "restart" }
  /** After such a run: hold its final rule as the result instead, as a run that has ended. */
  | { type: "keep" }
  /** A held set-method run: keep its automaton at this step of its ladder instead (decision 12's override; same file id). */
  | { type: "keep-at-step"; step: number }
  /** Brush stamps on the live grid, [x, y, radius] in cells (the Keep runtime's damage brush). */
  | { type: "brush"; stamps: [number, number, number][] };

/**
 * A held set-method run's reading ladder (figure-recipe.ts READING_LADDER): for each step the grid reached
 * in the finite range, the 128 px picture there as a PNG data URL (the poster of a file kept at that step)
 * and the method's own loss on it; and the step the automaton is kept at.
 */
export interface TrainLadder {
  steps: { tick: number; loss: number; picture: string }[];
  kept: number;
}

/** The start command's fields, as the store gives them to the client. */
export type GrowStart = Omit<Extract<GrowCommand, { type: "start" }>, "type">;

/**
 * The model's download at a start: the model file being loaded (1-based) of the release's files (the
 * encoder's stem and layers, then the calibration), and the bytes received of all of them against the
 * total the release lists. A cached file counts whole at once.
 */
export interface StartupProgress {
  file: number;
  files: number;
  receivedBytes: number;
  totalBytes: number;
}

export type GrowEvent =
  /**
   * "live": the run has ended and its rule grows; "stopped": the person's Stop holds the run there;
   * "retry": the run's last update did not meet the selection target, and its final rule grows while
   * the person restarts from the next seed or keeps it.
   */
  | { type: "phase"; phase: "loading" | "training" | "finishing" | "retry" | "live" | "stopped"; message: string }
  | { type: "input"; anchor: MaterialAnchor; medianNorm: number; direction: Control; batch: 1 | 4 }
  /** The model's download while the run starts, at most every STARTUP_REPORT_MS and at each file's end. */
  | { type: "startup"; startup: StartupProgress }
  | { type: "run"; run: number; runs: number; seed: number; method: FigureMethod }
  | { type: "checkpoint"; checkpoint: Checkpoint }
  | { type: "progress"; progress: GrowProgress }
  | { type: "live"; frame: LiveFrame }
  | { type: "reading"; reading: LiveReading }
  /**
   * The grid the page shows, read while training for the live map: at most once a second and within 3 % of the
   * training time (grow.worker.ts mapInterval), never in an update that runs a checkpoint; the patches' codes and
   * which select the group. Readings feed the map too (train-run.ts). `readMs`: the reading's time.
   */
  | { type: "map"; patchCodes: Float32Array; selectedPatches: Uint8Array; tick: number; completed: number; readMs: number }
  /**
   * A set method's prepared set, once per run (new or continued): each token's code in the patchCodes space
   * (N × 3, token n at [3n, 3n + 3), picture-major in set order) and each token's picture index in the set.
   * A picture brings 9 tokens, or 4 or 6 where its 3 × 3 meets its window's edge. The live map's target.
   */
  | { type: "set"; codes: Float32Array; tokenPictures: Uint16Array }
  /** A set method's reading ladder at a keep (decision 12): each step's picture and own loss, and the kept step. */
  | { type: "ladder"; ladder: TrainLadder }
  | { type: "material"; file: FigureMaterialFile; run: number; stage: KeptStage; fired: boolean }
  /** `deviceLost`: WebGPU lost the device, which on a device without room for the run means out of memory. */
  | { type: "error"; message: string; deviceLost?: boolean };
