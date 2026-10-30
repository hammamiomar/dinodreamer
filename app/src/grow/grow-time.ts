import { SITE_WORDS, fill } from "../app/site-words";
import { FIGURE_UPDATES, RESUME_UPDATES } from "./figure-recipe";
import type { MaterialKind } from "./material-kind";

// Reference estimates use block 12002 at batch 4 on an Apple M1 Max in Chrome 155. Update costs
// are paired medians for the four kinds. First-fire updates come from one run per kind, so they
// are estimates, not predictions for another block or seed. After MEASURED_AFTER updates, the
// estimate uses this device's measured mean time per update.

interface Reference {
  /** Median milliseconds per update on the reference device. */
  msPerUpdate: number;
  /** The update of the first fire on 12002. */
  firstFire: number;
}

const REFERENCE: Record<MaterialKind["rule"], Record<MaterialKind["start"], Reference>> = {
  cell: { noise: { msPerUpdate: 395, firstFire: 250 }, "centre-disc": { msPerUpdate: 386, firstFire: 625 } },
  pyramid: { noise: { msPerUpdate: 603, firstFire: 250 }, "centre-disc": { msPerUpdate: 641, firstFire: 450 } },
};

/** Updates before the device's own rate replaces the reference: the first checkpoint. */
export const MEASURED_AFTER = 25;

export interface GrowTime {
  updates: number;
  seconds: number;
  /** True when the seconds come from this device's updates, false when from the reference device. */
  measured: boolean;
}

/** Before a run: the whole run (1,000 updates), or the typical first fire when the run stops there. */
export function timeBefore(kind: MaterialKind, stopAtFirstFire: boolean, fromUpdate = 0): GrowTime {
  const reference = REFERENCE[kind.rule][kind.start];
  // A continuation trains on from its definition's update: to 1,000, or RESUME_UPDATES past it.
  const left = fromUpdate < FIGURE_UPDATES ? FIGURE_UPDATES - fromUpdate : RESUME_UPDATES;
  const updates = stopAtFirstFire ? Math.min(reference.firstFire, left) : left;
  return { updates, seconds: updates * reference.msPerUpdate / 1000, measured: false };
}

/**
 * During a run, or after Stop: the updates left and their time. A run that stops at the first fire
 * aims at the typical first fire; once it has passed that update without a fire, at most the run's
 * last update (`total`: 1,000, or more after a Resume past it) remains.
 */
export function timeLeft(kind: MaterialKind, stopAtFirstFire: boolean, progress: { completed: number; total: number; trainingMs: number }, fromUpdate = 0): GrowTime {
  const reference = REFERENCE[kind.rule][kind.start];
  const trained = progress.completed - fromUpdate;
  const firstFire = Math.min(fromUpdate + reference.firstFire, progress.total);
  const end = stopAtFirstFire && progress.completed < firstFire ? firstFire : progress.total;
  const updates = Math.max(end - progress.completed, 0);
  const measured = trained >= MEASURED_AFTER;
  const msPerUpdate = measured ? progress.trainingMs / trained : reference.msPerUpdate;
  return { updates, seconds: updates * msPerUpdate / 1000, measured };
}

/** After a run: the updates it trained and the training time they took. */
export function timeTaken(progress: { completed: number; trainingMs: number }, fromUpdate = 0): GrowTime {
  return { updates: progress.completed - fromUpdate, seconds: progress.trainingMs / 1000, measured: true };
}

/** "40 s" under a minute and a half, "6.6 min" under ten minutes, "12 min" after. */
export function durationText(seconds: number): string {
  if (seconds < 90) return fill(SITE_WORDS.grow.seconds, { seconds: Math.max(1, Math.round(seconds)) });
  const minutes = seconds / 60;
  return fill(SITE_WORDS.grow.minutes, { minutes: minutes < 10 ? minutes.toFixed(1) : Math.round(minutes) });
}
