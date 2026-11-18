import type { MaterialAnchor, MaterialRequest } from "../recipe";
import { FIGURE_PYRAMID_LAYOUT, methodOfFile, type FigureMaterial, type FigureMaterialFile } from "../materials/material-file";
import { MEAN_OBJECTIVE, type FigureObjective } from "./figure-recipe";
import type { GrowRule, GrowStart, MaterialKind } from "./material-kind";

// A saved or published automaton definition trains on from its own rule, with a fresh optimizer and a fresh pool grown from its start, its
// update count continuing the schedule. The rule's model kind and basis group stay; the start and
// the reference patch may change. The new definitions record where they came from.

/** A definition Train can continue, read once at the boundary (continuationSource). */
export interface ContinuationSource {
  /** The definition's id: the continued definitions' ancestorId. */
  id: string;
  name: string;
  block: number;
  /** The worker refuses a definition of another basis collection than the release's. */
  dictionaryId: string;
  rule: GrowRule;
  start: GrowStart;
  values: Float32Array;
  /** The optimizer update it was saved at: the schedule continues from it. */
  fromUpdate: number;
  /** Its training seed and batch: the continued run draws its plans with them. */
  seed: number;
  batch: 1 | 4;
  anchor: MaterialAnchor;
  preview: string;
  /**
   * What it trained toward: its method, layers and target set as its file records them, so the
   * continued run compares with the same set even after the library changes. A file without a method
   * trained by basis-group mean matching, or is a research run whose set it does not record: it
   * continues by basis-group mean matching.
   */
  objective: FigureObjective;
}

/** What a continuation changed from its source, as its files record it (`continuedChange`). */
export type ContinuationChange = "none" | "start" | "reference patch" | "start and reference patch";

/**
 * The definition as Train continues it, or why it cannot: a figure definition grown one pixel per
 * cell (Train's grid) and trained at batch 1 or 4. Its basis collection is checked by the worker,
 * which knows the release's.
 */
export function continuationSource(material: FigureMaterial): ContinuationSource {
  const { file, values } = material;
  if ((file.picture?.pixelsPerCell ?? 1) !== 1) throw new Error("Train grows one pixel per cell; this automaton definition grows two.");
  const batch = file.recipe.settings.batch;
  if (batch !== 1 && batch !== 4) throw new Error("This automaton definition does not record a batch of 1 or 4.");
  return {
    id: file.id,
    name: file.name,
    block: file.block,
    dictionaryId: file.dictionaryId,
    rule: file.rule.layout === FIGURE_PYRAMID_LAYOUT ? "pyramid" : "cell",
    start: file.start?.kind === "centre-disc" ? "centre-disc" : "noise",
    values,
    fromUpdate: file.training.updates,
    seed: file.training.seed,
    batch,
    anchor: file.anchor,
    preview: file.preview,
    objective: continuedObjective(file),
  };
}

function continuedObjective(file: FigureMaterialFile): FigureObjective {
  const method = methodOfFile(file);
  if (method === null) return MEAN_OBJECTIVE;
  const { layers, set } = file.recipe.settings;
  return { method, layers: [...layers ?? []], set: set ?? null };
}

/** The training target the definition was trained toward: its own reference patch, the default of a continuation. */
export function continuationRequest(source: ContinuationSource): MaterialRequest {
  return { block: source.block, points: [source.anchor], anchor: source.anchor, mode: "fill" };
}

/** The kind a continuation trains: the source's model kind always, the chosen start. */
export function continuedKind(source: ContinuationSource, chosen: MaterialKind): MaterialKind {
  return { rule: source.rule, start: chosen.start };
}

/** What changed from the source: its start, its reference patch (another patch's response vector), or both. */
export function continuationChange(source: ContinuationSource, start: GrowStart, anchor: MaterialAnchor): ContinuationChange {
  const startChanged = start !== source.start;
  const anchorChanged = anchor.code.some((value, axis) => value !== source.anchor.code[axis]);
  if (startChanged && anchorChanged) return "start and reference patch";
  if (startChanged) return "start";
  return anchorChanged ? "reference patch" : "none";
}
