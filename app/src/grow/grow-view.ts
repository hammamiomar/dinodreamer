import { methodNeedsSet, type FigureMethod } from "../materials/material-file";
import type { PublishState } from "../features/gallery/publish-records";
import type { CoSelection } from "./co-selection";
import { RESUME_UPDATES, type KeptStage } from "./figure-recipe";
import type { GrowEvent, StartupProgress } from "./protocol";

// The Grow page's states, all shown in one layout. The panel
// records what the worker reported (GrowRecord); growState names the state, and the functions
// under it decide what each region shows in that state. Words are in site-words.ts.

/** One kept file of the current Grow, as the page shows it. */
export interface GrowOutcome {
  id: string;
  run: number;
  stage: KeptStage;
  fired: boolean;
  /** True once Keep has saved it on this device. */
  saved: boolean;
  updates: number;
  /** The step its reading and picture were taken at: 600, or a set method's own step (figure-recipe.ts readingStep). */
  tick: number;
}

/** What the panel heard from the worker for the current Grow. */
export interface GrowRecord {
  /** The worker exists: loading, training, held between runs, or growing the kept material live. */
  active: boolean;
  phase: Extract<GrowEvent, { type: "phase" }>["phase"] | null;
  phaseMessage: string;
  /** The current run, of how many, and its method. */
  run: { run: number; runs: number; method: FigureMethod } | null;
  /** The latest update: its count, the run's last, the training time, the reader's loaded parts, and the method's own loss. */
  progress: { completed: number; total: number; trainingMs: number; readerChunks: number; methodLoss: number } | null;
  /** The latest reading: the mean strength in m, the share of patches the block wins, which patches (the map), and the co-selected groups. */
  reading: { strength: number; winnerFraction: number; selectedPatches: Uint8Array; coSelection: CoSelection } | null;
  outcomes: GrowOutcome[];
  failure: string;
  /** The model's download while the run starts; null once the run trains, and before. */
  startup: StartupProgress | null;
}

export const NO_RECORD: GrowRecord = {
  active: false, phase: null, phaseMessage: "", run: null, progress: null, reading: null, outcomes: [], failure: "", startup: null,
};

/** The record after one worker event. A new run starts without progress or a reading. */
export function recordEvent(record: GrowRecord, event: GrowEvent): GrowRecord {
  switch (event.type) {
    case "phase":
      return { ...record, phase: event.phase, phaseMessage: event.message };
    case "startup":
      return { ...record, startup: event.startup };
    case "run":
      return { ...record, startup: null, run: { run: event.run, runs: event.runs, method: event.method }, progress: null, reading: null };
    case "progress": {
      const { completed, total, trainingMs, readerChunks, methodLoss } = event.progress;
      return { ...record, progress: { completed, total, trainingMs, readerChunks, methodLoss } };
    }
    case "reading": {
      const { strength, winnerFraction, selectedPatches, coSelection } = event.reading;
      return { ...record, reading: { strength, winnerFraction, selectedPatches, coSelection } };
    }
    case "material": {
      // A file kept again under its id (a set method kept at another step of its ladder) replaces its outcome.
      const outcome: GrowOutcome = {
        id: event.file.id, run: event.run, stage: event.stage, fired: event.fired, saved: false, updates: event.file.training.updates,
        tick: event.file.reading.tick,
      };
      const others = record.outcomes.filter((each) => each.id !== outcome.id);
      return { ...record, outcomes: [...others, outcome] };
    }
    case "error":
      return { ...record, failure: event.message };
    case "input":
    case "checkpoint":
    case "live":
    case "map":
    case "set":
    case "ladder":
      // The input and the checkpoints serve the worker; the live pixels go to the canvas, the map's and the set's codes to the store's map.
      return record;
  }
}

/**
 * Whether the user can override a held set-method run's reading step from its ladder:
 * only while its file has not been sent to the gallery ("awaiting" or "published" locks the step).
 */
export function stepChoiceOpen(publish: PublishState): boolean {
  return publish === "idle";
}

/** Keep saved the file on this device. */
export function markSaved(record: GrowRecord, id: string): GrowRecord {
  return { ...record, outcomes: record.outcomes.map((outcome) => (outcome.id === id ? { ...outcome, saved: true } : outcome)) };
}

/**
 * "stopped": the person's Stop holds the run; "done": the run has ended. In both the live grid grows
 * its rule and Resume trains it on. "retry": the run's last update did not meet the selection target;
 * its final rule grows while the person restarts from the next seed or keeps it.
 */
export type GrowState = "idle" | "loading" | "training" | "fired" | "retry" | "stopped" | "done" | "failed";

/** A held run: its training has ended or stopped, its rule grows, and its trainer waits for Resume. */
export function isHeld(state: GrowState): boolean {
  return state === "stopped" || state === "done";
}

/** The row of the state table the record is in. */
export function growState(record: GrowRecord): GrowState {
  if (record.failure) return "failed";
  if (!record.active) return "idle";
  if (record.phase === "retry") return "retry";
  if (record.phase === "stopped") return "stopped";
  if (record.phase === "live") return "done";
  // The first GPU update can compile shaders after the model loads. Keep startup visible until it finishes.
  if (!record.run || (record.run.run === 1 && record.progress === null)) return "loading";
  return firstFireOfRun(record) ? "fired" : "training";
}

/** The current run's kept first fire, if it had one. */
export function firstFireOfRun(record: GrowRecord): GrowOutcome | undefined {
  return record.outcomes.find((outcome) => outcome.run === record.run?.run && outcome.stage === "first fire" && outcome.fired);
}

/**
 * The material a stopped or finished Grow offers to open and publish: the last run's latest final
 * rule when it fired (after repeated Stops, the rule the held trainer is at), else that run's first
 * fire, else the last file kept (a rule that did not fire).
 */
export function resultOutcome(record: GrowRecord): GrowOutcome | undefined {
  const last = record.outcomes.at(-1);
  if (!last) return undefined;
  const ofRun = record.outcomes.filter((outcome) => outcome.run === last.run);
  const latestFinal = ofRun.filter((outcome) => outcome.stage === "final").at(-1);
  if (latestFinal?.fired) return latestFinal;
  return ofRun.find((outcome) => outcome.stage === "first fire" && outcome.fired) ?? last;
}

/** Whether the material has fired in this Grow: the frame and lit selection-map cells take the sampled colour. */
export function hasFired(state: GrowState, record: GrowRecord): boolean {
  if (state === "fired") return true;
  return isHeld(state) && resultOutcome(record)?.fired === true;
}

/** Whether the current run trains by a set method, which keeps its final rule whatever its selection (train-method.ts keepRule). */
export function setMethodRun(record: GrowRecord): boolean {
  return record.run !== null && methodNeedsSet(record.run.method);
}

/**
 * The Kept mark lights once a fired file of this Grow is saved on this device; after a set method's
 * run, once its final file is saved, fired or not: that rule is the run's result.
 */
export function keptMark(state: GrowState, record: GrowRecord): boolean {
  const outcome = isHeld(state) ? resultOutcome(record) : firstFireOfRun(record);
  const result = hasFired(state, record) || (isHeld(state) && setMethodRun(record));
  return result && outcome?.saved === true;
}

/**
 * The one primary: Grow when nothing runs; Stop while a run trains; Resume after Stop; Restart from
 * the next seed after a run that did not meet the target (Keep is the word beside it); when done,
 * Open in Playground. Another kind after Stop or when done grows something new: the same kind again
 * trains the same seeds, so it would give the same material.
 */
export function primaryAction(state: GrowState, kindChanged: boolean): "grow" | "stop" | "resume" | "restart" | "open" {
  if (state === "idle" || state === "failed") return "grow";
  if (state === "retry") return "restart";
  if (state === "stopped") return kindChanged ? "grow" : "resume";
  if (state === "done") return kindChanged ? "grow" : "open";
  return "stop";
}

/**
 * What Stop does. While a run trains, the worker stops it, keeps the rule of that moment as the
 * final one and holds the trainer for Resume. While the model loads,
 * no trainer is held yet, so the worker ends and the page returns to its start.
 */
export function stopAction(state: GrowState): "end" | "stop" {
  return state === "training" || state === "fired" ? "stop" : "end";
}

/** The updates a Resume trains: on to the run's last update, or RESUME_UPDATES past it once reached. */
export function resumeUpdates(progress: { completed: number; total: number }): number {
  return progress.completed < progress.total ? progress.total - progress.completed : RESUME_UPDATES;
}

/**
 * The co-selected basis groups the panel lists: the latest measurement's, in the place of the Rule
 * and Start choices while those are fixed (a run trains or waits); none before the first measurement.
 */
export function shownCoSelection(state: GrowState, record: GrowRecord): CoSelection | null {
  if (choicesOpen(state) || !record.reading) return null;
  return record.reading.coSelection;
}

/** The Rule and Start choices are fixed while a run trains or waits. */
export function choicesOpen(state: GrowState): boolean {
  return state === "idle" || state === "failed" || isHeld(state);
}
