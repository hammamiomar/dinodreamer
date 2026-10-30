// The only boundary between the app and the numerical engine.
//
// The app owns the desired recipe and its revision. The worker owns the applied
// recipe, the image, Adam, the RNG and the GPU device. The worker acknowledges
// what it applied; the app never assumes. One apply may be pending at a time;
// the app coalesces edits into the latest desired recipe. The worker finishes the
// in-flight step before installing a recipe or pausing. On a failed apply it
// retains the last applied recipe and image.
//
// Pause has priority: the app may send it at any time, including while an apply is pending, and
// the worker stops taking updates after the in-flight one. When a pending apply later installs,
// updates resume only if the latest control command was run. A run or step the worker cannot
// honor is answered with `refused`, never with a silent phase change.

import type { Recipe } from "../recipe";

export type Phase = "idle" | "loading" | "ready" | "preparing" | "running" | "paused" | "failed";

export interface ReleaseLocation {
  /** ASSET_BASE_URL, the public data bucket. */
  baseUrl: string;
  /** e.g. "releases/pass-003.json" */
  manifestPath: string;
}

export type Command =
  /** Fetch the manifest, encoder and calibration through the asset cache; report capabilities and progress. */
  | { type: "load"; release: ReleaseLocation }
  /** Fetch the block bases and reference views this recipe needs, prepare the objective, install it at a step boundary. */
  | { type: "apply"; revision: number; recipe: Recipe }
  | { type: "run" }
  | { type: "pause" }
  /** One update, then remain paused. */
  | { type: "step" }
  /**
   * Fresh noise image, Adam and RNG from this seed; keeps the applied recipe. The seed is not part
   * of the objective: an apply whose only change is the seed is acknowledged without preparation.
   */
  | { type: "restart"; seed: number }
  /**
   * The Noise tool: re-seed the image under the painted cells (row-major 16 × 16, true = re-seed)
   * from `seed`, a 32-bit seed drawn per stroke, and zero Adam's state there; protected cells are
   * left alone. Handled between updates in queue order, like restart; the step count does not
   * change. Answered with `reseeded` and the measurement that follows, or `refused` with nothing
   * applied. The seed feeds only this operation, so a replay of the same sequence is deterministic.
   */
  | { type: "reseed"; cells: boolean[]; seed: number }
  /**
   * Open a stored creation: continue from its picture, the PNG bytes of a 256 × 256 8-bit
   * RGB or opaque RGBA image saved after `step` updates. Sent after the applied event of the
   * opened recipe's revision and before run or step, like a queued restart. The picture becomes
   * the image and the base that protected cells show; Adam starts fresh; the update count
   * continues from `step`. Answered with `restored` and the measurement that follows, whose
   * pixels equal the picture, or `refused` with the image unchanged: nothing applied yet, or a
   * PNG that does not decode or is not 256 × 256 8-bit RGB or opaque RGBA (fall back to the seed).
   */
  | { type: "restore"; picture: Uint8Array; step: number }
  /** Explicit refresh of the unshifted readout (the image measured with no jitter); not needed after frames, apply, pause, step, restart, reseed or restore. */
  | { type: "measure" }
  | { type: "dispose" };

/**
 * ids: "request:<id>:respond", "request:<id>:look", "rules:tv", "rules:l2".
 * `raw` is the term's value, measured over its painted area.
 * `weighted` is the user's weight times `raw`; the total loss is their sum.
 */
export interface TermMeasurement {
  id: string;
  raw: number;
  weighted: number;
}

export interface CodeMeasurement {
  requestId: number;
  /** Token slots that were measured: 0 CLS, 1–4 storage, 5–260 patches. */
  slots: Uint16Array;
  /** [P, 3] measured codes, one row per slot. */
  codes: Float32Array;
  /** [P] squared distance to the cell target, or nearest region target. */
  errors: Float32Array;
  /** Squared target length per slot; region RMS about the origin. Absent in older saved readouts. */
  normalizers?: Float32Array;
}

export type Event =
  | { type: "phase"; phase: Phase; message?: string }
  /** `limits` are the adapter's WebGPU limits that the engine's kernels and buffers are measured against. */
  | { type: "capabilities"; webgpu: boolean; adapter?: string; reason?: string; limits?: Record<string, number> }
  | { type: "progress"; bytesDone: number; bytesTotal: number; cacheHits: number; message: string }
  /** The recipe at `revision` is now the applied objective. `step` is the completed-update count at install. */
  | { type: "applied"; revision: number; step: number; resetAdam: boolean; rebased: boolean }
  /** The image, Adam and RNG were replaced from `seed`; the step count is 0 again. */
  | { type: "restarted"; revision: number; seed: number }
  /** The painted cells were re-seeded from `seed` at `step`, which is unchanged; a measurement of the re-seeded image follows. */
  | { type: "reseeded"; revision: number; step: number; seed: number }
  /** The stored picture is the image at `step`; a measurement of it follows, its pixels equal to the picture. */
  | { type: "restored"; revision: number; step: number }
  /**
   * The recipe at `revision` could not be prepared; the previous applied recipe, image, Adam and
   * revision are untouched. Preparation never installs a partial recipe.
   */
  | { type: "rejected"; revision: number; message: string }
  /** A run, step, reseed or restore was not honored, for example nothing to optimize or no recipe applied; the phase is unchanged. */
  | { type: "refused"; command: "run" | "step" | "reseed" | "restore"; message: string }
  /**
   * One completed update. `loss` and `terms` describe the image before the update, over `views`
   * shifted views. `pixels` is that image as 256 × 256 RGBA.
   * `step` is the number of updates completed before that image: the first frame of a fresh
   * image has step 0. `elapsedMs` is the wall time of this one update.
   */
  | {
      type: "frame";
      revision: number;
      step: number;
      views: number;
      loss: number;
      terms: TermMeasurement[];
      pixels: Uint8ClampedArray;
      elapsedMs: number;
      /** GPU pool counters after this update, when the backend exposes them. Pool values, not an exact peak. */
      gpu?: { usedBytes: number; reservedBytes: number };
    }
  /**
   * The unshifted readout requested by `measure` or emitted at an update or command boundary.
   * `step` is the completed-update count of the measured image, so a measurement and a
   * frame with the same step describe the same pixels.
   */
  | {
      type: "measurement";
      revision: number;
      step: number;
      terms: TermMeasurement[];
      codes: CodeMeasurement[];
      pixels: Uint8ClampedArray;
    }
  /** `fatal` means a WASM trap or lost device: the session is unusable and must be disposed and recreated. */
  | { type: "error"; message: string; fatal: boolean };

/** Buffers in these events are transferred, not copied. */
export function transferables(event: Event): Transferable[] {
  switch (event.type) {
    case "frame":
      return [event.pixels.buffer];
    case "measurement":
      return [event.pixels.buffer, ...event.codes.flatMap((c) => [c.slots.buffer, c.codes.buffer, c.errors.buffer, ...(c.normalizers ? [c.normalizers.buffer] : [])])];
    default:
      return [];
  }
}
