import type { MaterialAnchor, MaterialRequest, StrengthBand } from "../recipe";
import type { Control, FigureMaterialFile, FigureReading } from "../materials/material-file";
import { bandOfNorm, encodeRule, MEASUREMENT_DIRECTION } from "../materials/material-file";
import type { LookSummary } from "../library/look-cloud";
import type { ContinuationChange, ContinuationSource } from "./continuation";
import { firstFireHolds, readingRegion, recipeName, ruleLayout, savedNameKind, startField, type MaterialKind } from "./material-kind";

// Grow trains the figure recipe (engine/src/grow/figure.rs):
// the E18 mean arm, toward the request's anchor at the mean over patches, at pool 64, in
// one of four kinds (material-kind.ts).

/** The sweep trainer follows original_recipe.py's loop with pool 64; pyramid.py supplies the two-scale rule. */
export const FIGURE_SOURCE = "trainer.py of the recipe sweep (pyramid.py for the pyramid), E18 mean arm, as engine/src/grow/figure.rs";
export const FIGURE_SOURCE_SHA256 = "2abcf6a8b3020e1199a320e696367e92dd77adb3cf3b45d627c5838ba1a47e88";
export const FIGURE_UPDATES = 1000;
/** Updates added after a run reaches its target, at the schedule's final rate. */
export const RESUME_UPDATES = 500;
/** Run 1 trains from this + block, so one block's runs repeat; later runs add one each. */
export const FIGURE_SEED = 20261022;
/** The live grid's replay seed. A kept reading names it with its tick. */
export const LIVE_SEED = 9317;
/** E18 read its materials after 600 ticks on the 128-cell training grid. */
export const READING_TICK = 600;
/** Updates between the checkpoint readings of the rule of the moment (tick 600, seed LIVE_SEED). */
export const CHECKPOINT_EVERY = 25;
/** A checkpoint that fires at tick 600 grows on to this tick to see whether it holds. */
export const HOLD_TICK = 2000;

// Some seeds settle into a dim basin. Early statistics do not reliably distinguish these from
// late-firing runs, so retries wait for the finished rule's tick-600 reading.
export const RUNS = 3;

/** The runs a training plans: RUNS, or one for a continuation, which trains its saved definition on without a retry. */
export function plannedRuns(continued: boolean): number {
  return continued ? 1 : RUNS;
}
/** E18's criterion lives with the reading it judges (material-file.ts), so the gallery shares it. */
export { FIRES, fired } from "../materials/material-file";
import { FIRES, fired } from "../materials/material-file";

// Keep the first checkpoint that fires at tick 600 and, for noise starts, still fires at tick
// 2,000. Training continues to the target update and keeps the final rule too, unless stopped
// manually or by stopAtFirstFire.
export type KeptStage = "first fire" | "final";

export function firstFire(kind: MaterialKind, at600: { winnerFraction: number }, at2000: { winnerFraction: number } | null): boolean {
  if (!fired(at600)) return false;
  return !firstFireHolds(kind) || (at2000 !== null && fired(at2000));
}

/** The first fire's condition in words, for the kept note and the panel. */
export function firstFireCondition(kind: MaterialKind): string {
  return firstFireHolds(kind) ? `fires at tick ${READING_TICK} and still at tick ${HOLD_TICK.toLocaleString("en-US")}` : `fires at tick ${READING_TICK}`;
}

/** After run `run` (1-based): a run that fired at its first fire or at its final reading is kept; otherwise the next seed. */
export function afterRun(run: number, firedAtAll: boolean): "fired" | "retry" | "stop" {
  if (firedAtAll) return "fired";
  return run < RUNS ? "retry" : "stop";
}

/** Run r (1-based) trains from seed FIGURE_SEED + block + r − 1. */
export function runSeed(block: number, run: number): number {
  return FIGURE_SEED + block + run - 1;
}
export const FIGURE_SETTINGS = {
  size: 128, render: 1, channels: 16, hidden: 96, perception: "identity-sobel-laplacian", boundary: "torus",
  fireRate: 0.5, pool: 64, rolloutMin: 32, rolloutMax: 64, checkpointChunk: 8,
  iterations: FIGURE_UPDATES, learningRate: 0.002, finalLearningRate: 0.0002, schedule: "cosine",
  gradientNormalization: "per-tensor", overflowWeight: 10, views: "distill-2-per-grid",
  display: "uint8-straight-through", objective: "mean-code", random: "pcg-hash-streams",
  batch1ResetEvery: 4,
} as const;

/**
 * figureInput's refusals. The page never starts Grow on such a request (grow-panel.tsx), and says
 * why in its own words (site-words.ts, grow.noAnchor and grow.plant); these are the contract's
 * errors, in the worker, which does not load the page's words.
 */
export const NO_ANCHOR_ERROR = "The training target has no reference patch to train toward";
const PLANT_ERROR = "The figure training procedure does not train a localized activity simulation";

export interface FigureInput {
  block: number;
  kind: MaterialKind;
  anchor: MaterialAnchor;
  /** m: the block's median winning norm, the loss scale. */
  medianNorm: number;
  /** u: the normalized training target. Each file records this measurement direction as lobeDirection. */
  direction: Control;
  dictionaryId: string;
  seed: number;
  batch: 1 | 4;
  /** A run continued from a saved definition (continuedInput): its lineage, which its files record. */
  continuation?: FigureContinuation;
}

/** Where a continued run came from, as its definitions record it. */
export interface FigureContinuation {
  /** The source definition's id, the new definitions' ancestorId. */
  ancestorId: string;
  /** The optimizer update the source was saved at. */
  fromUpdate: number;
  change: ContinuationChange;
}

/** Everything one Grow run needs, from Look's request, the block's summary and the chosen kind. */
export function figureInput(
  request: MaterialRequest, summary: LookSummary, dictionaryId: string, kind: MaterialKind, batch: 1 | 4 = 4, run = 1,
): FigureInput {
  if (request.mode === "plant") throw new Error(PLANT_ERROR);
  if (!request.anchor) throw new Error(NO_ANCHOR_ERROR);
  if (summary.block !== request.block) throw new Error("The basis group summary belongs to another basis group.");
  const length = Math.hypot(...request.anchor.code);
  return {
    block: request.block,
    kind,
    anchor: request.anchor,
    medianNorm: summary.medianNorm,
    direction: request.anchor.code.map((value) => value / length) as Control,
    dictionaryId,
    seed: runSeed(request.block, run),
    batch,
  };
}

/** The engine's FigureRequest (create_figure). */
export function engineRequest(input: FigureInput) {
  return {
    block: input.block, code: [...input.anchor.code], medianNorm: input.medianNorm, seed: input.seed, batch: input.batch,
    rule: input.kind.rule, start: input.kind.start,
  };
}

/** The patches a reading of this kind counts, in words for the kept note. */
export function readPatches(kind: MaterialKind): string {
  return readingRegion(kind) ? "the central 4 × 4 patches" : "all 64 patches";
}

/** The band a reached strength corresponds to, by Look's rule on the anchor's cuts. */
export function strengthBand(strength: number, input: Pick<FigureInput, "anchor" | "medianNorm">): StrengthBand {
  return bandOfNorm(strength * input.medianNorm, input.anchor.strength);
}

export interface Kept {
  run: number;
  stage: KeptStage;
  values: Float32Array;
  reading: FigureReading;
  preview: string;
  updates: number;
  trainingMs: number;
  engine: string;
}

/** The id names the kind by its recipe name without the date: grow-figure-pyramid-seeded-12002-… */
export function figureMaterialId(input: FigureInput, updates: number, stage: KeptStage): string {
  const anchor = input.anchor.source === "library" ? `${input.anchor.imageId}-${input.anchor.slot}` : `upload-${input.anchor.slot}`;
  const recipe = recipeName(input.kind).replace(/-\d{4}-\d{2}-\d{2}$/, "");
  // A continuation names the update it came from, or its final file could take the id of the source run's own.
  const from = input.continuation ? `-from-${input.continuation.fromUpdate}` : "";
  return `grow-${recipe}-${input.block}-${anchor}-seed-${input.seed}-batch-${input.batch}-update-${updates}-${stage.replace(" ", "-")}${from}`;
}

/**
 * The input of a run continued from a saved definition: the source's training seed and batch, so the
 * plans and firing go on as the source run's would have, and the lineage its files record.
 */
export function continuedInput(input: FigureInput, source: ContinuationSource, change: ContinuationChange): FigureInput {
  return { ...input, seed: source.seed, batch: source.batch, continuation: { ancestorId: source.id, fromUpdate: source.fromUpdate, change } };
}

/** A format-4 material file: the rule, its request, its kind and its reading at keeping. */
export function figureMaterial(input: FigureInput, kept: Kept): FigureMaterialFile {
  const { layout, values } = ruleLayout(input.kind);
  if (kept.values.length !== values) throw new Error(`This figure cellular model has ${values.toLocaleString("en-US")} values`);
  const start = startField(input.kind);
  const region = readingRegion(input.kind);
  const runs = plannedRuns(input.continuation !== undefined);
  // A continuation is its training's only run; its name says where it continued from instead.
  const run = runs > 1 ? ` · run ${kept.run} of ${runs}` : "";
  return {
    format: 4,
    id: figureMaterialId(input, kept.updates, kept.stage),
    name: `Block ${input.block} · ${input.anchor.band} anchor · ${savedNameKind(input.kind)}${run} · ${kept.stage}`
      + ` · ${kept.updates.toLocaleString("en-US")} updates${fired(kept.reading) ? "" : " · did not fire"}`
      + (input.continuation ? ` · continued from update ${input.continuation.fromUpdate.toLocaleString("en-US")}` : ""),
    block: input.block,
    mode: "fill",
    dictionaryId: input.dictionaryId,
    trainerCommit: import.meta.env.VITE_BUILD_REVISION,
    engine: kept.engine,
    ancestorId: input.continuation?.ancestorId ?? null,
    recipe: {
      name: recipeName(input.kind),
      placeholder: false,
      source: FIGURE_SOURCE,
      sourceSha256: FIGURE_SOURCE_SHA256,
      settings: {
        ...FIGURE_SETTINGS, init: input.kind.start, batch: input.batch, medianNorm: input.medianNorm, lobeDirection: input.direction,
        measurementDirection: MEASUREMENT_DIRECTION,
        ...(input.continuation ? {
          continuedFromUpdate: input.continuation.fromUpdate, continuedOptimizer: "fresh", continuedChange: input.continuation.change,
        } : {}),
        trainingMs: kept.trainingMs, run: kept.run, runs, fires: FIRES, stage: kept.stage,
      },
    },
    anchor: input.anchor,
    training: { seed: input.seed, updates: kept.updates },
    rule: { layout, dtype: "float32-le", fireRate: FIGURE_SETTINGS.fireRate, values: encodeRule(kept.values, values) },
    ...(start ? { start } : {}),
    reading: { ...kept.reading, ...(region ? { region } : {}) },
    preview: kept.preview,
  };
}
