import type { MaterialAnchor, StrengthBand, StrengthCuts } from "../recipe";
import { STRENGTH_BANDS, bandIndex } from "../features/look/strength-bands.ts";

// Format-4 figure definitions are validated and their float32 weights decoded once on load.

/** Target-response coordinates in a basis group's three-dimensional space. */
export type Control = [number, number, number];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label} in the automaton definition`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${label} in the automaton definition`);
  return value;
}
function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${label} in the automaton definition`);
  return value;
}

function decodeRule(encoded: string, count: number): Float32Array {
  let binary: string;
  try { binary = atob(encoded); } catch { throw new Error("Invalid cellular model encoding in the automaton definition"); }
  if (binary.length !== count * 4) throw new Error(`The automaton definition's cellular model must have ${count} float32 values`);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const values = Float32Array.from({ length: count }, (_, index) => view.getFloat32(index * 4, true));
  if (!values.every(Number.isFinite)) throw new Error("The automaton definition's cellular model values must be finite");
  return values;
}

/** Identity, basis group, dictionary, provenance and the embedded preview. */
function readCommon(file: Record<string, unknown>, dictionaryId?: string) {
  for (const key of ["id", "name", "dictionaryId", "trainerCommit", "preview"]) text(file[key], key);
  const block = number(file.block, "basis group");
  if (!Number.isInteger(block) || block < 0 || block >= 16384) throw new Error("Invalid basis group in the automaton definition");
  if (file.mode !== "fill" && file.mode !== "plant") throw new Error("Invalid mode in the automaton definition");
  if (dictionaryId && file.dictionaryId !== dictionaryId) throw new Error("The automaton definition belongs to a different basis collection");
  if (file.ancestorId !== null) text(file.ancestorId, "ancestor id");
  if (!(file.preview as string).startsWith("data:image/png;base64,")) throw new Error("The automaton definition's preview must be an embedded PNG");
}

function readRecipe(value: unknown): Record<string, unknown> {
  const recipe = record(value, "training procedure");
  if (typeof recipe.placeholder !== "boolean") throw new Error("The automaton definition's training procedure must say whether it is a placeholder");
  text(recipe.source, "source"); text(recipe.sourceSha256, "source hash"); record(recipe.settings, "settings");
  return recipe;
}

/** Float32 little-endian storage, without a lossy JSON or half-precision conversion. */
export function encodeRule(values: Float32Array, count: number): string {
  if (values.length !== count || !values.every(Number.isFinite)) throw new Error("Invalid trained cellular model");
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

// Format 4: figure rules.

export const FIGURE_LAYOUT = "figure-16-96-torus-v1";
/** fc1.weight [96,64], fc1.bias [96], fc2.weight [16,96]: the E1 order without the control matrix U. */
export const FIGURE_RULE_VALUES = 7776;
/**
 * The two-level pyramid: a coarse grid of side/2 cells and the fine grid, 16
 * channels each. The coarse rule's 7,776 values in the figure layout, then the fine rule's fc1.weight
 * [96,80] (inputs 0–63 its own perception, 64–79 the torus-upsampled coarse state), fc1.bias [96] and
 * fc2.weight [16,96].
 */
export const FIGURE_PYRAMID_LAYOUT = "figure-pyramid-16-96-torus-v1";
export const FIGURE_PYRAMID_RULE_VALUES = 17088;
export type FigureLayout = typeof FIGURE_LAYOUT | typeof FIGURE_PYRAMID_LAYOUT;

/** The readouts at the moment of keeping. */
export interface FigureReading {
  status: "measured" | "unmeasured";
  /**
   * Mean over the patch tokens of u·c_t / m. Dimensionless: 2 is twice the median winning norm. Some
   * research conversions store the median of |c_t| / m here instead, and u is the training target's
   * direction or the main direction (strengthStatistic).
   */
  strength: number | null;
  winnerFraction: number | null;
  /** The replay state that was read: grid side, replay seed and age in ticks. `preview` shows it. */
  side: 64 | 128 | 256;
  seed: number;
  tick: number;
  /** The patches the winner fraction counts: every patch (absent), or the central 4 × 4 of a seeded start. */
  region?: "centre-4x4";
  note: string;
}

/**
 * The state a replay starts from. Absent or "noise": the start distribution in every cell. "centre-disc":
 * the start distribution inside a disc of `radius` cells at the grid centre, and outside it that draw
 * times `backgroundAmplitude` (0 to 1; absent or 0: zero outside). The coarse grid of a pyramid has
 * half the radius and the same amplitude.
 */
export type FigureStart = { kind: "noise" } | { kind: "centre-disc"; radius: number; backgroundAmplitude?: number };

/** A start's kind as the automata index and Train name it: a centre disc on faint noise is a seeded field. */
export type FigureStartKind = "noise" | "centre-disc" | "seeded-field";

export function startKindOf(start: FigureStart | undefined): FigureStartKind {
  if (start === undefined || start.kind === "noise") return "noise";
  return (start.backgroundAmplitude ?? 0) > 0 ? "seeded-field" : "centre-disc";
}

/**
 * The loss the rule trained with, as its settings record it (`lossKind`): the request alone; the request
 * with a guide on DINO units that is released during training; or the request with a selection margin.
 * Absent means plain. A guided rule also records `guideRatio`, `guideReleaseFraction`, `guideReleaseFloor`
 * and `guideUnits` (the number of guided units).
 */
export type FigureLossKind = "plain" | "guided" | "plain-margin";
const FIGURE_LOSS_KINDS: readonly unknown[] = ["plain", "guided", "plain-margin"];

export function lossKindOf(file: Pick<FigureMaterialFile, "recipe">): FigureLossKind {
  const kind = file.recipe.settings.lossKind;
  return kind === "guided" || kind === "plain-margin" ? kind : "plain";
}

/** Picture pixels per cell along each axis. 2 shows a 64-cell grid as a 128-pixel picture. */
export type PixelsPerCell = 1 | 2;

export interface FigureMaterialFile {
  format: 4;
  id: string;
  name: string;
  block: number;
  mode: "fill";
  dictionaryId: string;
  trainerCommit: string;
  /** The engine build that trained the rule, as Saved creations record `engine`. */
  engine: string;
  ancestorId: string | null;
  recipe: {
    name: string;
    placeholder: false;
    source: string;
    sourceSha256: string;
    /** m and u of the loss and the readout travel with the rule. */
    settings: Record<string, unknown> & { medianNorm: number; lobeDirection: Control; lossKind?: FigureLossKind };
  };
  /** The request's patch, as Look wrote it. */
  anchor: MaterialAnchor;
  training: { seed: number; updates: number };
  rule: { layout: FigureLayout; dtype: "float32-le"; fireRate: number; values: string };
  start?: FigureStart;
  /** Absent means one pixel per cell. At 2, the picture is the archive's bilinear upsampling of the cells. */
  picture?: { pixelsPerCell: PixelsPerCell };
  reading: FigureReading;
  /**
   * Reserved playback settings. hiddenNoise is σ ≥ 0 of Gaussian noise added each tick to the
   * 13 hidden channels. Absent means 0.
   */
  playback?: { hiddenNoise: number };
  preview: string;
}
export interface FigureMaterial { file: FigureMaterialFile; values: Float32Array }
/** Look's band rule (features/look/strength-bands.ts), by name. */
export function bandOfNorm(norm: number, strength: StrengthCuts): StrengthBand {
  return STRENGTH_BANDS[bandIndex(norm, strength)];
}

/** E18's criterion: the block wins in at least 90 % of the patches at the reading (tick 600). */
export const FIRES = 0.9;
export function fired(reading: { winnerFraction: number | null }): boolean {
  return reading.winnerFraction !== null && reading.winnerFraction >= FIRES;
}

/** The recorded measurement direction; absent means the group's main direction. */
export const MEASUREMENT_DIRECTION = "training target";

/**
 * What a format-4 reading's `strength` holds, from the rule's settings `experiment` and
 * `measurementDirection` (an index entry copies both). Browser definitions with
 * `measurementDirection` store the mean projection on the training target's direction, u·c_t / m
 * over the read patches. Browser definitions from before it (no experiment) and the E18 and E19
 * conversions store the same mean on the main direction. The E20 and E21 conversions, the
 * selection-margin study and the 7178 investigation store the median over the read patches of
 * |c_t| / m; their notes say so.
 * For another experiment the statistic is not known here, and only its note names it.
 */
export type StrengthStatistic = "projection-on-target" | "projection-on-main-direction" | "median-magnitude" | "unknown";
const MAIN_DIRECTION_EXPERIMENTS: readonly string[] = ["E18", "E19"];
const MEDIAN_MAGNITUDE_EXPERIMENTS: readonly string[] = ["E20", "E21", "2026-10-26-selection-margin", "2026-10-30-7178-investigation"];

export function strengthStatistic(experiment: unknown, measurementDirection: unknown): StrengthStatistic {
  if (measurementDirection === MEASUREMENT_DIRECTION) return "projection-on-target";
  if (experiment === undefined) return "projection-on-main-direction";
  if (typeof experiment !== "string") return "unknown";
  if (MAIN_DIRECTION_EXPERIMENTS.includes(experiment)) return "projection-on-main-direction";
  if (MEDIAN_MAGNITUDE_EXPERIMENTS.includes(experiment)) return "median-magnitude";
  return "unknown";
}

/** The playback's hidden-channel noise σ: 0 unless the file sets it. */
export function hiddenNoise(file: FigureMaterialFile): number {
  return file.playback?.hiddenNoise ?? 0;
}

/** How a replay of this file starts and plays: the options every player passes to createFigureReplay. */
export interface FigurePlayback {
  hiddenNoise: number;
  /** Radius in cells of the seeded start's noise disc; 0 starts from noise in every cell. */
  startDisc: number;
  /** Outside the disc, the start draw times this amplitude; 0 is zero outside. */
  startBackground: number;
  pixelsPerCell: PixelsPerCell;
}
export function figurePlayback(file: FigureMaterialFile): FigurePlayback {
  return {
    hiddenNoise: hiddenNoise(file),
    startDisc: file.start?.kind === "centre-disc" ? file.start.radius : 0,
    startBackground: file.start?.kind === "centre-disc" ? file.start.backgroundAmplitude ?? 0 : 0,
    pixelsPerCell: file.picture?.pixelsPerCell ?? 1,
  };
}

/** Pictures are 128 or 256 pixels wide; a player offers the grids that make them at the file's pixels per cell. */
export const PICTURE_SIDES = [128, 256] as const;
export function replayGridSides(file: FigureMaterialFile): number[] {
  return PICTURE_SIDES.map((pixels) => pixels / figurePlayback(file).pixelsPerCell);
}
/** The width in pixels of the kept picture, which `preview` holds. */
export function readingPictureSide(file: FigureMaterialFile): number {
  return file.reading.side * figurePlayback(file).pixelsPerCell;
}

function unsigned(value: unknown, label: string): number {
  const result = number(value, label);
  if (!Number.isInteger(result) || result < 0 || result > 0xffffffff) throw new Error(`Invalid ${label} in the automaton definition`);
  return result;
}

function vector(value: unknown, label: string): Control {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`Invalid ${label} in the automaton definition`);
  return value.map((entry) => number(entry, label)) as Control;
}

function readAnchor(value: unknown): MaterialAnchor {
  const anchor = record(value, "reference patch");
  const norm = number(anchor.norm, "reference patch response magnitude");
  const cuts = record(anchor.strength, "reference patch response magnitude cuts");
  const ring = number(cuts.ring, "reference patch median selection threshold");
  const maximum = number(cuts.maximum, "reference patch maximum");
  if (!Array.isArray(cuts.cuts) || cuts.cuts.length !== 3) throw new Error("Invalid reference patch cuts in the automaton definition");
  const steps = cuts.cuts.map((cut) => number(cut, "reference patch cut"));
  if (steps[0] < ring || steps[1] < steps[0] || steps[2] < steps[1]) throw new Error("Reference patch cuts must rise from the median selection threshold");
  const code = vector(anchor.code, "reference patch response vector");
  if (!Number.isInteger(anchor.slot) || (anchor.slot as number) < 5 || (anchor.slot as number) > 260) throw new Error("Invalid reference patch slot in the automaton definition");
  if (anchor.source === "library") {
    if (!Number.isSafeInteger(anchor.imageId) || (anchor.imageId as number) < 1) throw new Error("Invalid reference patch picture in the automaton definition");
    if (anchor.publicPreview !== undefined && anchor.publicPreview !== false) throw new Error("Invalid reference patch picture in the automaton definition");
  } else if (anchor.source !== "upload" || anchor.imageId !== undefined) {
    throw new Error("Invalid reference patch source in the automaton definition");
  }
  if (Math.abs(Math.hypot(...code) - norm) > 1e-3 * norm) throw new Error("The reference patch response magnitude must be the length of its response vector");
  const strength = { ring, cuts: steps as [number, number, number], maximum };
  if (anchor.band !== bandOfNorm(norm, strength)) throw new Error("The reference patch response level must follow its response magnitude and cuts");
  return anchor as unknown as MaterialAnchor;
}

function readFigureReading(value: unknown) {
  const reading = record(value, "measurement");
  if (reading.status === "unmeasured") {
    if (reading.strength !== null || reading.winnerFraction !== null) throw new Error("An unmeasured automaton definition must not claim scores");
  } else if (reading.status === "measured") {
    number(reading.strength, "measured value");
    const fraction = number(reading.winnerFraction, "selection fraction");
    if (fraction < 0 || fraction > 1) throw new Error("The selection fraction must be between 0 and 1");
  } else {
    throw new Error("The automaton definition's measurement needs its status");
  }
  if (reading.side !== 64 && reading.side !== 128 && reading.side !== 256) throw new Error("A measurement grid has 64, 128 or 256 cells per side");
  unsigned(reading.seed, "measurement seed");
  if (!Number.isSafeInteger(reading.tick) || (reading.tick as number) < 0) throw new Error("Invalid measurement simulation step in the automaton definition");
  if (reading.region !== undefined && reading.region !== "centre-4x4") throw new Error("Invalid measurement region in the automaton definition");
  text(reading.note, "measurement conditions");
}

function readStart(value: unknown) {
  const start = record(value, "start");
  if (start.kind === "noise") return;
  if (start.kind !== "centre-disc") throw new Error("Invalid start in the automaton definition");
  const radius = number(start.radius, "start radius");
  if (radius <= 0 || radius > 256) throw new Error("The start disc needs a positive radius of at most 256 cells");
  if (start.backgroundAmplitude === undefined) return;
  const amplitude = number(start.backgroundAmplitude, "start background amplitude");
  if (amplitude < 0 || amplitude > 1) throw new Error("The start's background amplitude must be from 0 to 1");
}

/** The start with only the fields format 4 defines; an amplitude of 0 is the same start as none. */
function canonicalStart(start: FigureStart): FigureStart {
  if (start.kind === "noise") return { kind: "noise" };
  const amplitude = start.backgroundAmplitude ?? 0;
  return amplitude > 0 ? { kind: "centre-disc", radius: start.radius, backgroundAmplitude: amplitude } : { kind: "centre-disc", radius: start.radius };
}

/** Validate a format-4 file and decode its single-scale or pyramid weights. */
export function readFigureMaterial(value: unknown, dictionaryId?: string): FigureMaterial {
  const file = record(value, "top-level value");
  if (file.format === 1 || file.format === 2) throw new Error("This app cannot play E1 automata (formats 1 and 2).");
  if (file.format !== 4) throw new Error("Unsupported automaton definition format");
  readCommon(file, dictionaryId);
  if (file.mode !== "fill") throw new Error("The figure training procedure trains automata for area simulation only");
  text(file.engine, "engine build");
  const recipe = readRecipe(file.recipe);
  text(recipe.name, "training procedure name");
  if (recipe.placeholder) throw new Error("A figure automaton definition is never a placeholder");
  const settings = recipe.settings as Record<string, unknown>;
  if (number(settings.medianNorm, "median selected response magnitude") <= 0) throw new Error("Invalid median selected response magnitude in the automaton definition");
  if (Math.abs(Math.hypot(...vector(settings.lobeDirection, "directional extension direction")) - 1) > 1e-3) throw new Error("The directional extension direction must be a unit vector");
  if (settings.lossKind !== undefined && !FIGURE_LOSS_KINDS.includes(settings.lossKind)) throw new Error('The automaton definition\'s loss kind must be "plain", "guided" or "plain-margin"');
  readAnchor(file.anchor);
  const training = record(file.training, "training");
  unsigned(training.seed, "training seed");
  if (!Number.isSafeInteger(training.updates) || (training.updates as number) < 0) throw new Error("Invalid optimizer update count in the automaton definition");
  const rule = record(file.rule, "cellular model");
  if ((rule.layout !== FIGURE_LAYOUT && rule.layout !== FIGURE_PYRAMID_LAYOUT) || rule.dtype !== "float32-le") throw new Error("Unsupported cellular model shape in the automaton definition");
  const pyramid = rule.layout === FIGURE_PYRAMID_LAYOUT;
  const fireRate = number(rule.fireRate, "cell update probability");
  if (fireRate <= 0 || fireRate > 1) throw new Error("The cell update probability must be in (0, 1]");
  readFigureReading(file.reading);
  if (file.start !== undefined) readStart(file.start);
  if (file.picture !== undefined) {
    const pixels = record(file.picture, "picture").pixelsPerCell;
    if (pixels !== 1 && pixels !== 2) throw new Error("A picture has 1 or 2 pixels per cell");
  }
  const picture = (file.reading as FigureReading).side * ((file.picture as { pixelsPerCell: number } | undefined)?.pixelsPerCell ?? 1);
  if (!(PICTURE_SIDES as readonly number[]).includes(picture)) throw new Error("The measurement's picture must be 128 or 256 pixels wide");
  if (file.playback !== undefined) {
    const playback = record(file.playback, "playback");
    const sigma = number(playback.hiddenNoise, "hidden-channel noise");
    if (sigma < 0) throw new Error("Hidden-channel noise must be zero or positive");
    if (pyramid && sigma !== 0) throw new Error("The two-scale cellular model has no playback noise");
  }
  if (pyramid && picture !== (file.reading as FigureReading).side) throw new Error("The two-scale cellular model draws one pixel per fine-grid cell");
  const count = pyramid ? FIGURE_PYRAMID_RULE_VALUES : FIGURE_RULE_VALUES;
  return { file: file as unknown as FigureMaterialFile, values: decodeRule(text(rule.values, "cellular model values"), count) };
}

/** A recipe setting the canonical file keeps: numbers, flags, short text, short number lists, small text maps. */
function settingValue(value: unknown): unknown {
  const shortText = (text: unknown) => typeof text === "string" && text.length <= 200;
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || shortText(value)) return value;
  if (Array.isArray(value) && value.length <= 64 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return [...value];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length <= 16 && entries.every(([key, text]) => SETTING_KEY.test(key) && shortText(text))) return Object.fromEntries(entries);
  }
  return undefined;
}
const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * The recipe settings a figure material may carry, by name; canonicalFigureFile drops any other.
 * Three sources write them: the archived trainer's Settings (original_recipe.py, its own snake_case
 * names), the research converter's provenance (convert_figure_material.py), and the browser Grow
 * (grow/figure-recipe.ts FIGURE_SETTINGS and figureMaterial). A new setting is added here first.
 */
export const FIGURE_SETTING_KEYS: ReadonlySet<string> = new Set([
  // original_recipe.py Settings, as the E18 and E19 runs recorded them
  "block", "objective", "region_module", "region_target", "warm_start", "pole_target", "size", "render", "channels", "hidden",
  "fire_rate", "init", "pool", "batch", "rollout_min", "rollout_max", "reset_every", "iterations", "lr", "lr_final", "shift",
  "views", "gate_margin", "gate_radius", "overflow_weight", "rgb_overflow", "seed", "random_frame", "colony", "quantize",
  "checkpoint", "eval_only", "eval_size", "eval_steps", "eval_every",
  // convert_figure_material.py and convert_stage5_material.py: the run's arm, loss and provenance
  "arm", "loss", "targetCode", "inputSha256", "trainerSourceSha256", "experiment", "runFolder", "trainerSha256", "variant",
  // convert_stage6_materials.py: the sweep stage and run.json's fire record
  "sweepStage", "firstFireUpdate", "retentionAtFirstFire", "retention4000AtFirstFire", "retainedFireUpdate",
  "retention4000AtRetainedFire",
  // convert_stage6_materials.py --margin-rule: selection-margin settings
  "selectionMargin", "marginRivalRank", "marginDeltaOverM2", "marginWeight",
  // the browser Grow's figure recipe
  "perception", "boundary", "fireRate", "rolloutMin", "rolloutMax", "checkpointChunk", "learningRate", "finalLearningRate",
  "schedule", "gradientNormalization", "overflowWeight", "display", "random", "batch1ResetEvery", "fires", "run", "runs", "trainingMs",
  "stage",
  // m and u of the loss and the readout, for every source; which direction u is (absent: the main direction)
  "medianNorm", "lobeDirection", "measurementDirection",
  // the loss the rule trained with, for every source (lossKindOf), and a guided rule's guide
  "lossKind", "guideRatio", "guideReleaseFraction", "guideReleaseFloor", "guideUnits",
  // a Train run continued from a saved definition (ancestorId): its start update, its fresh optimizer, what it changed
  "continuedFromUpdate", "continuedOptimizer", "continuedChange",
]);

/**
 * The file rebuilt from the fields format 4 defines, after readFigureMaterial accepted it. An unknown
 * property, such as a "shader" string, never reaches storage or another person's browser. Recipe
 * settings keep only the named keys of FIGURE_SETTING_KEYS, with short values (settingValue).
 */
export function canonicalFigureFile(file: FigureMaterialFile): FigureMaterialFile {
  const { anchor, picture, recipe, reading, rule, start, training } = file;
  const settings = Object.fromEntries(Object.entries(recipe.settings)
    .filter(([key]) => FIGURE_SETTING_KEYS.has(key))
    .map(([key, value]) => [key, settingValue(value)] as const)
    .filter(([, value]) => value !== undefined)) as FigureMaterialFile["recipe"]["settings"];
  const point = anchor.source === "library"
    ? { source: "library" as const, imageId: anchor.imageId, ...(anchor.publicPreview === false ? { publicPreview: false as const } : {}) }
    : { source: "upload" as const };
  return {
    format: 4, id: file.id, name: file.name, block: file.block, mode: "fill",
    dictionaryId: file.dictionaryId, trainerCommit: file.trainerCommit, engine: file.engine, ancestorId: file.ancestorId,
    recipe: { name: recipe.name, placeholder: false, source: recipe.source, sourceSha256: recipe.sourceSha256, settings },
    anchor: {
      band: anchor.band, norm: anchor.norm,
      strength: { ring: anchor.strength.ring, cuts: [...anchor.strength.cuts] as [number, number, number], maximum: anchor.strength.maximum },
      code: [...anchor.code] as Control, slot: anchor.slot, ...point,
    } as MaterialAnchor,
    training: { seed: training.seed, updates: training.updates },
    rule: { layout: rule.layout, dtype: "float32-le", fireRate: rule.fireRate, values: rule.values },
    ...(start ? { start: canonicalStart(start) } : {}),
    ...(picture ? { picture: { pixelsPerCell: picture.pixelsPerCell } } : {}),
    reading: {
      status: reading.status, strength: reading.strength, winnerFraction: reading.winnerFraction,
      side: reading.side, seed: reading.seed, tick: reading.tick,
      ...(reading.region ? { region: reading.region } : {}),
      note: reading.note,
    },
    ...(file.playback ? { playback: { hiddenNoise: file.playback.hiddenNoise } } : {}),
    preview: file.preview,
  };
}
