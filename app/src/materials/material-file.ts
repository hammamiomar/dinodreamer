import { decodeBase64, encodeBase64 } from "../base64.ts";
import { decodeNonEmptyString, decodeNumber, decodeObject, decodeUnsigned32 } from "../decode.ts";
import { CELLS, PATCH_SLOT_OFFSET, TOKEN_SLOTS, type MaterialAnchor, type StrengthBand, type StrengthCuts } from "../recipe.ts";
import { STRENGTH_BANDS, bandIndex } from "../features/look/strength-bands.ts";
import { escapedText, firstUnsafeString } from "../visitor-text.ts";

// Format-4 figure definitions are validated and their float32 weights decoded once on load.

/** Target-response coordinates in a basis group's three-dimensional space. */
export type Control = [number, number, number];

const DICTIONARY_BLOCKS = 16384;
const PICTURE_PATCHES = CELLS;
const MAX_START_RADIUS = 256;

const materialError = (label: string) => `Invalid ${label} in the automaton definition`;
const record = (value: unknown, label: string) => decodeObject(value, label, materialError);
const text = (value: unknown, label: string) => decodeNonEmptyString(value, label, materialError);
const number = (value: unknown, label: string) => decodeNumber(value, label, materialError);
const unsigned = (value: unknown, label: string) => decodeUnsigned32(value, label, materialError);

function decodeRule(encoded: string, count: number): Float32Array {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64(encoded);
  } catch {
    throw new Error("Invalid cellular model encoding in the automaton definition");
  }
  if (bytes.length !== count * 4) throw new Error(`The automaton definition's cellular model must have ${count} float32 values`);
  const view = new DataView(bytes.buffer);
  const values = Float32Array.from({ length: count }, (_, index) => view.getFloat32(index * 4, true));
  if (!values.every(Number.isFinite)) throw new Error("The automaton definition's cellular model values must be finite");
  return values;
}

/** Identity, basis group, dictionary, provenance, and embedded preview. */
function readCommon(file: Record<string, unknown>, dictionaryId?: string) {
  const id = text(file.id, "id");
  const name = text(file.name, "name");
  const fileDictionaryId = text(file.dictionaryId, "dictionaryId");
  const trainerCommit = text(file.trainerCommit, "trainerCommit");
  const preview = text(file.preview, "preview");
  const block = number(file.block, "basis group");
  if (!Number.isInteger(block) || block < 0 || block >= DICTIONARY_BLOCKS) {
    throw new Error("Invalid basis group in the automaton definition");
  }
  if (file.mode !== "fill") {
    throw new Error("The figure training procedure trains automata for area simulation only");
  }
  if (dictionaryId && fileDictionaryId !== dictionaryId) {
    throw new Error("The automaton definition belongs to a different basis collection");
  }
  const ancestorId = file.ancestorId === null ? null : text(file.ancestorId, "ancestor id");
  if (!preview.startsWith("data:image/png;base64,")) {
    throw new Error("The automaton definition's preview must be an embedded PNG");
  }
  return { id, name, block, mode: "fill" as const, dictionaryId: fileDictionaryId, trainerCommit, ancestorId, preview };
}

function readRecipe(value: unknown) {
  const recipe = record(value, "training procedure");
  if (typeof recipe.placeholder !== "boolean") {
    throw new Error("The automaton definition's training procedure must say whether it is a placeholder");
  }
  if (recipe.placeholder) {
    throw new Error("A figure automaton definition is never a placeholder");
  }
  return {
    name: text(recipe.name, "training procedure name"),
    placeholder: false as const,
    source: text(recipe.source, "source"),
    sourceSha256: text(recipe.sourceSha256, "source hash"),
    settings: record(recipe.settings, "settings"),
  };
}

/** Float32 little-endian storage, without a lossy JSON or half-precision conversion. */
export function encodeRule(values: Float32Array, count: number): string {
  if (values.length !== count || !values.every(Number.isFinite)) throw new Error("Invalid trained cellular model");
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return encodeBase64(bytes);
}

// Format 4: figure rules.

export const FIGURE_LAYOUT = "figure-16-96-torus-v1";
/** Parameter layout: fc1.weight [96, 64], fc1.bias [96], fc2.weight [16, 96]. */
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
 * with a guide on DINO units that is released during training; the request with a selection margin; or
 * another objective, as the research export marks a rule that was not trained on the request (set
 * matching, a prototype, a unit). Absent means plain. A guided rule also records `guideRatio`,
 * `guideReleaseFraction`, `guideReleaseFloor` and `guideUnits` (the number of guided units). What a
 * rule with another objective was asked for is its place in the gallery (features/gallery/gallery-place.ts),
 * which the research export sets.
 */
export type FigureLossKind = "plain" | "guided" | "plain-margin" | "other";
const FIGURE_LOSS_KINDS: readonly unknown[] = ["plain", "guided", "plain-margin", "other"];

/**
 * The loss kind of a rule. A file of a set method (`settings.method`) trained toward its target set,
 * not toward the request's code, so it is "other"; otherwise its `lossKind`, and absent means plain.
 */
export function lossKindOf(file: Pick<FigureMaterialFile, "recipe">): FigureLossKind {
  const method = file.recipe.settings.method;
  if (method !== undefined && method !== "basis-group-mean") return "other";
  const kind = file.recipe.settings.lossKind;
  return kind === "guided" || kind === "plain-margin" || kind === "other" ? kind : "plain";
}

/**
 * The method a browser training records in `settings.method`: one choice of space (the basis group's
 * 3 numbers, or DINO's 768 for a token) and one of comparison (the mean, or the distribution). The
 * names are the Automata page's (features/gallery/gallery-place.ts). A file without the field was
 * trained by basis-group mean matching, or by the research, whose export gives its place.
 */
export const FIGURE_METHODS = ["basis-group-mean", "token-mean", "basis-group-distribution", "token-distribution"] as const;
export type FigureMethod = (typeof FIGURE_METHODS)[number];

/** The method the file records, or null when it records none. */
export function methodOfFile(file: Pick<FigureMaterialFile, "recipe">): FigureMethod | null {
  const method = file.recipe.settings.method;
  return (FIGURE_METHODS as readonly unknown[]).includes(method) ? method as FigureMethod : null;
}

/** Whether a method compares the canvas with a target set: every method but basis-group mean matching. */
export function methodNeedsSet(method: FigureMethod): boolean {
  return method !== "basis-group-mean";
}

/** Whether a method compares the spread of the canvas's patches with the set's, not their mean. */
export function methodComparesDistributions(method: FigureMethod): boolean {
  return method === "basis-group-distribution" || method === "token-distribution";
}

/** Whether a method compares DINO's tokens, at the layers the file records. */
export function methodReadsTokens(method: FigureMethod): boolean {
  return method === "token-mean" || method === "token-distribution";
}

/**
 * A layer a token method compares, as the engine names it (engine/src/grow/figure.rs, `Layer`): the
 * patch tokens after zero-based DINO block k, or the final layer, the tokens the basis groups read.
 */
export type FigureLayer = `block-${number}` | "final";
/** DINOv3 ViT-B/16 has 12 blocks, 0 to 11. */
const DINO_BLOCKS = 12;

export function isFigureLayer(value: unknown): value is FigureLayer {
  if (value === "final") return true;
  const block = typeof value === "string" ? /^block-(\d{1,2})$/.exec(value)?.[1] : undefined;
  return block !== undefined && Number(block) < DINO_BLOCKS && String(Number(block)) === block;
}

/** One picture of a target set: a library picture and the patch of its 16 × 16 grid (slot − 5). */
export interface SetPicture {
  imageId: number;
  patch: number;
}

/**
 * Where a target set's pictures came from: "selection", the patches the visitor selected on a group's
 * page and sent to Train; "sample-strongest", with no selection, the strongest of the group's public
 * sample cloud (clouds/<block>.json), the research's own set (grow/target-set.ts).
 */
export type TargetSetSource = "selection" | "sample-strongest";
const TARGET_SET_SOURCES: readonly unknown[] = ["selection", "sample-strongest"];

/**
 * The target set a set method trained toward, in set order, so a continuation prepares the same set
 * even after the library changes. `source` says where the pictures came from (TargetSetSource);
 * `pictures` is the set itself. `neighbourhood` "3x3": the 3 × 3 tokens around each patch.
 */
export interface FigureTargetSet {
  source: TargetSetSource;
  neighbourhood: "3x3";
  pictures: SetPicture[];
}
/** The standard target set holds up to 33 pictures; a file may hold fewer if a picture could not be fetched. */
export const MOST_SET_PICTURES = 33;

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
    settings: Record<string, unknown> & {
      medianNorm: number; lobeDirection: Control; lossKind?: FigureLossKind;
      /** A browser training's method (methodOfFile), a token method's layers and a set method's target set. */
      method?: FigureMethod; layers?: FigureLayer[]; set?: FigureTargetSet;
    };
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

/** Selection criterion: the block wins in at least 90 % of the patches at the reading (tick 600). */
export const FIRES = 0.9;
export function fired(reading: { winnerFraction: number | null }): boolean {
  return reading.winnerFraction !== null && reading.winnerFraction >= FIRES;
}

/** The recorded measurement direction; absent means the group's main direction. */
export const MEASUREMENT_DIRECTION = "training target";

/**
 * Identifies which statistic a format-4 reading's `strength` stores, from `experiment` and
 * `measurementDirection`. Browser definitions with `measurementDirection` store the mean
 * projection on the training target direction (u·c_t / m). Earlier browser definitions and
 * legacy main-direction exports store the mean projection on the main direction. Median-based
 * exports store the median of |c_t| / m over the read patches.
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

function vector(value: unknown, label: string): Control {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`Invalid ${label} in the automaton definition`);
  return [number(value[0], label), number(value[1], label), number(value[2], label)];
}

function readAnchor(value: unknown): MaterialAnchor {
  const anchor = record(value, "reference patch");
  const norm = number(anchor.norm, "reference patch response magnitude");
  const cuts = record(anchor.strength, "reference patch response magnitude cuts");
  const ring = number(cuts.ring, "reference patch median selection threshold");
  const maximum = number(cuts.maximum, "reference patch maximum");
  if (!Array.isArray(cuts.cuts) || cuts.cuts.length !== 3) throw new Error("Invalid reference patch cuts in the automaton definition");
  const steps: [number, number, number] = [
    number(cuts.cuts[0], "reference patch cut"),
    number(cuts.cuts[1], "reference patch cut"),
    number(cuts.cuts[2], "reference patch cut"),
  ];
  if (steps[0] < ring || steps[1] < steps[0] || steps[2] < steps[1]) {
    throw new Error("Reference patch cuts must rise from the median selection threshold");
  }
  const code = vector(anchor.code, "reference patch response vector");
  if (!Number.isInteger(anchor.slot) || (anchor.slot as number) < PATCH_SLOT_OFFSET || (anchor.slot as number) >= TOKEN_SLOTS) {
    throw new Error("Invalid reference patch slot in the automaton definition");
  }
  const slot = anchor.slot as number;
  if (Math.abs(Math.hypot(...code) - norm) > 1e-3 * norm) {
    throw new Error("The reference patch response magnitude must be the length of its response vector");
  }
  const strength: StrengthCuts = { ring, cuts: steps, maximum };
  const band = bandOfNorm(norm, strength);
  if (anchor.band !== band) {
    throw new Error("The reference patch response level must follow its response magnitude and cuts");
  }
  if (anchor.source === "library") {
    if (!Number.isSafeInteger(anchor.imageId) || (anchor.imageId as number) < 1) {
      throw new Error("Invalid reference patch picture in the automaton definition");
    }
    if (anchor.publicPreview !== undefined && anchor.publicPreview !== false) {
      throw new Error("Invalid reference patch picture in the automaton definition");
    }
    return {
      band,
      norm,
      strength,
      code,
      slot,
      source: "library",
      imageId: anchor.imageId as number,
      ...(anchor.publicPreview === false ? { publicPreview: false as const } : {}),
    };
  }
  if (anchor.source !== "upload" || anchor.imageId !== undefined) {
    throw new Error("Invalid reference patch source in the automaton definition");
  }
  return { band, norm, strength, code, slot, source: "upload" };
}

function readFigureReading(value: unknown): FigureReading {
  const reading = record(value, "measurement");
  let status: FigureReading["status"];
  let strength: number | null;
  let winnerFraction: number | null;
  if (reading.status === "unmeasured") {
    if (reading.strength !== null || reading.winnerFraction !== null) {
      throw new Error("An unmeasured automaton definition must not claim scores");
    }
    status = "unmeasured";
    strength = null;
    winnerFraction = null;
  } else if (reading.status === "measured") {
    status = "measured";
    strength = number(reading.strength, "measured value");
    winnerFraction = number(reading.winnerFraction, "selection fraction");
    if (winnerFraction < 0 || winnerFraction > 1) throw new Error("The selection fraction must be between 0 and 1");
  } else {
    throw new Error("The automaton definition's measurement needs its status");
  }
  if (reading.side !== 64 && reading.side !== 128 && reading.side !== 256) {
    throw new Error("A measurement grid has 64, 128 or 256 cells per side");
  }
  const seed = unsigned(reading.seed, "measurement seed");
  if (!Number.isSafeInteger(reading.tick) || (reading.tick as number) < 0) {
    throw new Error("Invalid measurement simulation step in the automaton definition");
  }
  if (reading.region !== undefined && reading.region !== "centre-4x4") {
    throw new Error("Invalid measurement region in the automaton definition");
  }
  const note = text(reading.note, "measurement conditions");
  return {
    status,
    strength,
    winnerFraction,
    side: reading.side,
    seed,
    tick: reading.tick as number,
    ...(reading.region !== undefined ? { region: reading.region } : {}),
    note,
  };
}

function readTargetSet(value: unknown): FigureTargetSet {
  const set = record(value, "target set");
  if (!TARGET_SET_SOURCES.includes(set.source)) throw new Error('The target set\'s source must be "selection" or "sample-strongest"');
  if (set.neighbourhood !== "3x3") throw new Error('The target set\'s neighbourhood must be "3x3"');
  if (!Array.isArray(set.pictures) || set.pictures.length < 1 || set.pictures.length > MOST_SET_PICTURES) {
    throw new Error(`The target set needs 1 to ${MOST_SET_PICTURES} pictures`);
  }
  const seen = new Set<number>();
  const pictures = set.pictures.map((entry) => {
    const picture = record(entry, "target set picture");
    if (!Number.isSafeInteger(picture.imageId) || (picture.imageId as number) < 1) throw new Error("Invalid target set picture in the automaton definition");
    if (!Number.isInteger(picture.patch) || (picture.patch as number) < 0 || (picture.patch as number) >= PICTURE_PATCHES) {
      throw new Error("A target set picture's patch is a position of its 16 × 16 grid");
    }
    if (seen.has(picture.imageId as number)) throw new Error("A target set has each picture once");
    seen.add(picture.imageId as number);
    return { imageId: picture.imageId as number, patch: picture.patch as number };
  });
  return { source: set.source as TargetSetSource, neighbourhood: "3x3", pictures };
}

/**
 * Validates method-specific settings: token methods require distinct layers, set methods require
 * a target set and cannot claim request loss kinds, and basis-group mean takes neither.
 */
function readMethod(settings: Record<string, unknown>): { method?: FigureMethod; layers?: FigureLayer[]; set?: FigureTargetSet } {
  if (settings.method === undefined) {
    if (settings.layers !== undefined || settings.set !== undefined) throw new Error("Layers and a target set belong to a set method");
    return {};
  }
  if (!(FIGURE_METHODS as readonly unknown[]).includes(settings.method)) {
    throw new Error(`The automaton definition's method must be one of ${FIGURE_METHODS.join(", ")}`);
  }
  const method = settings.method as FigureMethod;
  let layers: FigureLayer[] | undefined;
  if (methodReadsTokens(method)) {
    if (!Array.isArray(settings.layers) || settings.layers.length === 0 || !settings.layers.every(isFigureLayer) || new Set(settings.layers).size !== settings.layers.length) {
      throw new Error('A token method records its distinct layers: "block-k" or "final"');
    }
    layers = [...settings.layers];
  } else if (settings.layers !== undefined) {
    throw new Error("A basis-group method records no layers");
  }
  let set: FigureTargetSet | undefined;
  if (methodNeedsSet(method)) {
    set = readTargetSet(settings.set);
    if (settings.lossKind !== undefined && settings.lossKind !== "other") throw new Error("A set method's loss is not the request's");
  } else if (settings.set !== undefined) {
    throw new Error("Basis-group mean matching has no target set");
  }
  return {
    method,
    ...(layers !== undefined ? { layers } : {}),
    ...(set !== undefined ? { set } : {}),
  };
}

function readStart(value: unknown): FigureStart {
  const start = record(value, "start");
  if (start.kind === "noise") return { kind: "noise" };
  if (start.kind !== "centre-disc") throw new Error("Invalid start in the automaton definition");
  const radius = number(start.radius, "start radius");
  if (radius <= 0 || radius > MAX_START_RADIUS) throw new Error("The start disc needs a positive radius of at most 256 cells");
  if (start.backgroundAmplitude === undefined) return { kind: "centre-disc", radius };
  const backgroundAmplitude = number(start.backgroundAmplitude, "start background amplitude");
  if (backgroundAmplitude < 0 || backgroundAmplitude > 1) throw new Error("The start's background amplitude must be from 0 to 1");
  return { kind: "centre-disc", radius, backgroundAmplitude };
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
  // Definitions contain visitor text printed in pages, terminals, and exported shader comments.
  const unsafe = firstUnsafeString(file);
  if (unsafe !== null) throw new Error(`The automaton definition's ${escapedText(unsafe)} holds a control character or a line separator`);
  const common = readCommon(file, dictionaryId);
  const engine = text(file.engine, "engine build");
  const recipe = readRecipe(file.recipe);
  const medianNorm = number(recipe.settings.medianNorm, "median selected response magnitude");
  if (medianNorm <= 0) throw new Error("Invalid median selected response magnitude in the automaton definition");
  const lobeDirection = vector(recipe.settings.lobeDirection, "directional extension direction");
  if (Math.abs(Math.hypot(...lobeDirection) - 1) > 1e-3) throw new Error("The directional extension direction must be a unit vector");
  if (recipe.settings.lossKind !== undefined && !FIGURE_LOSS_KINDS.includes(recipe.settings.lossKind)) {
    throw new Error('The automaton definition\'s loss kind must be "plain", "guided", "plain-margin" or "other"');
  }
  const lossKind = recipe.settings.lossKind as FigureLossKind | undefined;
  const methodFields = readMethod(recipe.settings);
  const anchor = readAnchor(file.anchor);
  const training = record(file.training, "training");
  const trainingSeed = unsigned(training.seed, "training seed");
  if (!Number.isSafeInteger(training.updates) || (training.updates as number) < 0) {
    throw new Error("Invalid optimizer update count in the automaton definition");
  }
  const trainingUpdates = training.updates as number;
  const rule = record(file.rule, "cellular model");
  if ((rule.layout !== FIGURE_LAYOUT && rule.layout !== FIGURE_PYRAMID_LAYOUT) || rule.dtype !== "float32-le") {
    throw new Error("Unsupported cellular model shape in the automaton definition");
  }
  const layout: FigureLayout = rule.layout;
  const pyramid = layout === FIGURE_PYRAMID_LAYOUT;
  const fireRate = number(rule.fireRate, "cell update probability");
  if (fireRate <= 0 || fireRate > 1) throw new Error("The cell update probability must be in (0, 1]");
  const reading = readFigureReading(file.reading);
  const start = file.start === undefined ? undefined : readStart(file.start);
  let picture: { pixelsPerCell: PixelsPerCell } | undefined;
  if (file.picture !== undefined) {
    const pixels = record(file.picture, "picture").pixelsPerCell;
    if (pixels !== 1 && pixels !== 2) throw new Error("A picture has 1 or 2 pixels per cell");
    picture = { pixelsPerCell: pixels };
  }
  const pictureSide = reading.side * (picture?.pixelsPerCell ?? 1);
  if (!(PICTURE_SIDES as readonly number[]).includes(pictureSide)) {
    throw new Error("The measurement's picture must be 128 or 256 pixels wide");
  }
  let playback: { hiddenNoise: number } | undefined;
  if (file.playback !== undefined) {
    const rawPlayback = record(file.playback, "playback");
    const sigma = number(rawPlayback.hiddenNoise, "hidden-channel noise");
    if (sigma < 0) throw new Error("Hidden-channel noise must be zero or positive");
    if (pyramid && sigma !== 0) throw new Error("The two-scale cellular model has no playback noise");
    playback = { hiddenNoise: sigma };
  }
  if (pyramid && pictureSide !== reading.side) {
    throw new Error("The two-scale cellular model draws one pixel per fine-grid cell");
  }
  const count = pyramid ? FIGURE_PYRAMID_RULE_VALUES : FIGURE_RULE_VALUES;
  const encodedValues = text(rule.values, "cellular model values");
  const values = decodeRule(encodedValues, count);
  const settings: FigureMaterialFile["recipe"]["settings"] = {
    ...recipe.settings,
    medianNorm,
    lobeDirection,
    ...(lossKind !== undefined ? { lossKind } : {}),
    ...methodFields,
  };
  const decoded: FigureMaterialFile = {
    format: 4,
    ...common,
    engine,
    recipe: {
      name: recipe.name,
      placeholder: false,
      source: recipe.source,
      sourceSha256: recipe.sourceSha256,
      settings,
    },
    anchor,
    training: { seed: trainingSeed, updates: trainingUpdates },
    rule: { layout, dtype: "float32-le", fireRate, values: encodedValues },
    ...(start !== undefined ? { start } : {}),
    ...(picture !== undefined ? { picture } : {}),
    reading,
    ...(playback !== undefined ? { playback } : {}),
  };
  return { file: decoded, values };
}

/** A recipe setting the canonical file keeps: numbers, flags, short text, short number lists, small text maps. */
function settingValue(value: unknown): unknown {
  const shortText = (entry: unknown) => typeof entry === "string" && entry.length <= 200;
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || shortText(value)) return value;
  if (Array.isArray(value) && value.length <= 64 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return [...value];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length <= 16 && entries.every(([key, entry]) => SETTING_KEY.test(key) && shortText(entry))) return Object.fromEntries(entries);
  }
  return undefined;
}
const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * Allowed recipe setting keys kept by canonicalFigureFile. Covers archived trainer settings,
 * imported provenance metadata, and browser training settings.
 */
export const FIGURE_SETTING_KEYS: ReadonlySet<string> = new Set([
  // Archived trainer settings (snake_case)
  "block", "objective", "region_module", "region_target", "warm_start", "pole_target", "size", "render", "channels", "hidden",
  "fire_rate", "init", "pool", "batch", "rollout_min", "rollout_max", "reset_every", "iterations", "lr", "lr_final", "shift",
  "views", "gate_margin", "gate_radius", "overflow_weight", "rgb_overflow", "seed", "random_frame", "colony", "quantize",
  "checkpoint", "eval_only", "eval_size", "eval_steps", "eval_every",
  // Imported provenance and sweep metadata
  "arm", "loss", "targetCode", "inputSha256", "trainerSourceSha256", "experiment", "runFolder", "trainerSha256", "variant",
  "sweepStage", "firstFireUpdate", "retentionAtFirstFire", "retention4000AtFirstFire", "retainedFireUpdate",
  "retention4000AtRetainedFire",
  // Selection-margin training settings
  "selectionMargin", "marginRivalRank", "marginDeltaOverM2", "marginWeight",
  // Browser training recipe settings
  "perception", "boundary", "fireRate", "rolloutMin", "rolloutMax", "checkpointChunk", "learningRate", "finalLearningRate",
  "schedule", "gradientNormalization", "overflowWeight", "display", "random", "batch1ResetEvery", "fires", "run", "runs", "trainingMs",
  "stage",
  // Loss and readout calibration parameters (m, u, and measurement direction)
  "medianNorm", "lobeDirection", "measurementDirection",
  // Loss variant and guidance parameters
  "lossKind", "guideRatio", "guideReleaseFraction", "guideReleaseFloor", "guideUnits",
  // Continuation lineage metadata
  "continuedFromUpdate", "continuedOptimizer", "continuedChange",
  // Training method, token layers, and target set
  "method", "layers", "set",
  // Reading ladder steps and per-step losses for set methods
  "readingLadder", "readingLosses",
]);

/**
 * A token method's layers and a set method's target set, rebuilt field by field: their lists are longer
 * or deeper than settingValue keeps. readFigureMaterial has checked them (readMethod).
 */
function methodSettings(settings: Record<string, unknown>): { layers?: FigureLayer[]; set?: FigureTargetSet } {
  const set = settings.set as FigureTargetSet | undefined;
  return {
    ...(Array.isArray(settings.layers) ? { layers: [...settings.layers as FigureLayer[]] } : {}),
    ...(set ? {
      set: {
        source: set.source, neighbourhood: set.neighbourhood,
        pictures: set.pictures.map((picture) => ({ imageId: picture.imageId, patch: picture.patch })),
      },
    } : {}),
  };
}

/**
 * The file rebuilt from the fields format 4 defines, after readFigureMaterial accepted it. An unknown
 * property, such as a "shader" string, never reaches storage or another person's browser. Recipe
 * settings keep only the named keys of FIGURE_SETTING_KEYS, with short values (settingValue).
 */
export function canonicalFigureFile(file: FigureMaterialFile): FigureMaterialFile {
  const { anchor, picture, recipe, reading, rule, start, training } = file;
  const settings = {
    ...Object.fromEntries(Object.entries(recipe.settings)
      .filter(([key]) => FIGURE_SETTING_KEYS.has(key))
      .map(([key, value]) => [key, settingValue(value)] as const)
      .filter(([, value]) => value !== undefined)),
    ...methodSettings(recipe.settings),
  } as FigureMaterialFile["recipe"]["settings"];
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
