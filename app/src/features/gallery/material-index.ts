// The published materials: published/materials.json on the public bucket, newest first. The
// gallery's owner operations write it (gallery/src/material-review.ts); Explore, the basis group
// panel and Automata read it through the Worker (GET /api/materials). Every entry is built
// from a material file that passed readFigureMaterial, never from the submission form's claims.
// This module has no browser or React imports: the gallery Worker and scripts use it too.

import type { StrengthBand } from "../../recipe";
import {
  FIGURE_LAYOUT, FIGURE_PYRAMID_LAYOUT, fired, lossKindOf, methodNeedsSet, methodOfFile, startKindOf, type FigureLayout, type FigureMaterialFile,
  type FigureStartKind, type PixelsPerCell,
} from "../../materials/material-file.ts";
import { isGalleryMethod, isGalleryStart, placeFromFile, type GalleryPlace } from "./gallery-place.ts";

export const MATERIAL_INDEX_KEY = "published/materials.json";
export const MATERIAL_FILES = ["material.json", "poster.png"] as const;
export type MaterialFileName = (typeof MATERIAL_FILES)[number];

/** One published material, with the readouts a tile shows without opening the file. */
export interface MaterialEntry {
  id: string;
  /** A creative title, or empty to display the recipe. Existing research titles remain valid. */
  title: string;
  credit: string;
  publishedAt: string;
  /** The material file's own id: a kept file with this id is published. */
  materialId: string;
  block: number;
  recipe: string;
  /** The band of the request's anchor. */
  band: StrengthBand;
  strength: number | null;
  winnerFraction: number | null;
  /** Winner fraction at the reading >= 0.9 (grow/figure-recipe.ts). */
  fired: boolean;
  /** The patches the winner fraction counts, when not every patch: a seeded start reads the central 4 × 4. */
  region?: "centre-4x4";
  /** The state the reading names: grid side, replay seed and tick. */
  side: number;
  seed: number;
  tick: number;
  engine: string;
  trainerCommit: string;
  /** The material's kind, from its file: the rule layout, the start and the picture's pixels per cell. */
  layout: FigureLayout;
  start: MaterialStartKind;
  pixelsPerCell: PixelsPerCell;
  /**
   * The loss the rule trained with, from its file (lossKindOf): the request alone, or with the guide.
   * Absent in an older index, which means plain; read it with entryLoss. Absent too for a set method's
   * file, which trained toward its target set: its `gallery` place names the method.
   */
  loss?: MaterialLossKind;
  /** The research experiment that trained the rule (E18 to E21); absent for a rule grown in the browser. */
  experiment?: string;
  /** The direction the measurement projects on, from the file's settings: "training target", or absent for the main direction. */
  measurementDirection?: string;
  /**
   * The owner's site mark, the second of two levels: featured materials are the home's pool and the
   * Automata page's first group. Not the visitor's starred blocks of Explore. The gallery writes it on
   * every entry; absent in an older index, which means false. A site-featured material is featured in
   * its basis group too (featuredInBlock).
   */
  featured?: boolean;
  /**
   * The owner's first mark: featured within its basis group. The Automata page takes the group's
   * picture from it, on the wall and on the stage before a visitor chooses: the owner's "picture of
   * the group" sets it on one automaton and clears it on the group's others (gallery/src/material-review.ts,
   * setGroupPicture). Absent means false. A site-featured automaton counts as featured within its
   * group too: read that with featuredInBlock.
   */
  featuredInBlock?: boolean;
  /**
   * The automaton's place in its basis group's grid on the Automata page (gallery-place.ts): the start
   * and the method. The owner's publish of a research run writes it from the research export, and
   * materialEntry from the method a set method's file records. Absent for a rule grown in the browser
   * by basis-group mean matching and in an older index: read it with placeOf.
   */
  gallery?: GalleryPlace;
  /**
   * The owner's mark: of the automata that share its place in the grid, this one is the picture the
   * cell shows. Absent means false; the Automata page then takes the cell's first automaton.
   */
  cellPicture?: boolean;
}
export type MaterialStartKind = FigureStartKind;
export type MaterialLossKind = "plain" | "guided";
export interface MaterialIndex { entries: MaterialEntry[] }
export const EMPTY_MATERIAL_INDEX: MaterialIndex = { entries: [] };

/** Bucket keys of a published material's files, relative to the public bucket. */
export function materialKey(id: string, file: MaterialFileName): string {
  return `gallery/materials/${id}/${file}`;
}

/** An entry id is a submission id or a project seed's slug: safe in keys and URLs. */
export function isMaterialEntryId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,95}$/.test(id);
}

/**
 * What an entry says of its rule's objective, from its file. A set method's file gives its place, so an
 * app built before set methods existed, which reads the place first, still files it under its method,
 * and no reader takes it for the request's own loss. Any other file gives its loss, as before.
 */
function objectiveFields(file: FigureMaterialFile): Pick<MaterialEntry, "loss" | "gallery"> {
  const method = methodOfFile(file);
  if (method !== null && methodNeedsSet(method)) return { gallery: placeFromFile(startKindOf(file.start), "plain", method) };
  return { loss: lossKindOf(file) === "guided" ? "guided" : "plain" };
}

export function materialEntry(id: string, file: FigureMaterialFile, label: { title: string; credit: string }, publishedAt: string): MaterialEntry {
  if (!isMaterialEntryId(id)) throw new Error(`"${id}" cannot name a published automaton`);
  const { experiment, measurementDirection } = file.recipe.settings;
  return {
    id, title: label.title, credit: label.credit, publishedAt,
    materialId: file.id, block: file.block, recipe: file.recipe.name, band: file.anchor.band,
    strength: file.reading.strength, winnerFraction: file.reading.winnerFraction, fired: fired(file.reading),
    ...(file.reading.region ? { region: file.reading.region } : {}),
    side: file.reading.side, seed: file.reading.seed, tick: file.reading.tick,
    engine: file.engine, trainerCommit: file.trainerCommit,
    layout: file.rule.layout, start: startKindOf(file.start), pixelsPerCell: file.picture?.pixelsPerCell ?? 1,
    ...objectiveFields(file),
    ...(typeof experiment === "string" ? { experiment } : {}),
    ...(typeof measurementDirection === "string" ? { measurementDirection } : {}),
    featured: false,
    featuredInBlock: false,
  };
}

/** The loss the entry's rule trained with; an older entry without the field trained with the request alone. */
export function entryLoss(entry: Pick<MaterialEntry, "loss">): MaterialLossKind {
  return entry.loss ?? "plain";
}

/** The entry's place in its basis group's grid: the one it carries, else the one its file's start and loss give. */
export function placeOf(entry: Pick<MaterialEntry, "gallery" | "start" | "loss">): GalleryPlace {
  return entry.gallery ?? placeFromFile(entry.start, entryLoss(entry));
}

/** Whether the owner featured the material within its basis group: its own mark, or the site mark, which implies it. */
export function featuredInBlock(entry: Pick<MaterialEntry, "featured" | "featuredInBlock">): boolean {
  return entry.featuredInBlock === true || entry.featured === true;
}

/** The index with this entry added, or replacing an entry with the same id; newest first. */
export function withMaterialEntry(index: MaterialIndex, entry: MaterialEntry): MaterialIndex {
  const entries = [...index.entries.filter((existing) => existing.id !== entry.id), entry]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  return { entries };
}

/** The index without the entry of this id; the same object when there is none. */
export function withoutMaterialEntry(index: MaterialIndex, id: string): MaterialIndex {
  if (!index.entries.some((entry) => entry.id === id)) return index;
  return { entries: index.entries.filter((entry) => entry.id !== id) };
}

const BANDS: readonly unknown[] = ["barely", "weakly", "strongly", "strongest"];

function check(condition: boolean, field: string): asserts condition {
  if (!condition) throw new Error(`The automata index has an invalid ${field}`);
}

/** Check the published index once at the boundary; a reader then trusts its fields. */
export function readMaterialIndex(value: unknown): MaterialIndex {
  check(typeof value === "object" && value !== null && Array.isArray((value as MaterialIndex).entries), "entries list");
  const ids = new Set<string>();
  for (const entry of (value as MaterialIndex).entries) {
    check(typeof entry === "object" && entry !== null, "entry");
    check(typeof entry.id === "string" && isMaterialEntryId(entry.id) && !ids.has(entry.id), "entry id");
    ids.add(entry.id);
    for (const key of ["title", "credit", "publishedAt", "materialId", "recipe", "engine", "trainerCommit"] as const) {
      check(typeof entry[key] === "string", key);
    }
    check(Number.isInteger(entry.block) && entry.block >= 0 && entry.block < 16384, "block");
    check(BANDS.includes(entry.band), "band");
    check(typeof entry.fired === "boolean", "fired");
    check(entry.strength === null || Number.isFinite(entry.strength), "strength");
    check(entry.winnerFraction === null || (entry.winnerFraction >= 0 && entry.winnerFraction <= 1), "selection fraction");
    check(entry.region === undefined || entry.region === "centre-4x4", "measurement region");
    check([entry.side, entry.seed, entry.tick].every((number) => Number.isInteger(number) && number >= 0), "measurement state");
    check(entry.layout === FIGURE_LAYOUT || entry.layout === FIGURE_PYRAMID_LAYOUT, "layout");
    check(entry.start === "noise" || entry.start === "centre-disc" || entry.start === "seeded-field", "start");
    check(entry.pixelsPerCell === 1 || entry.pixelsPerCell === 2, "pixels per cell");
    check(entry.loss === undefined || entry.loss === "plain" || entry.loss === "guided", "loss");
    check(entry.experiment === undefined || typeof entry.experiment === "string", "experiment");
    check(entry.measurementDirection === undefined || typeof entry.measurementDirection === "string", "measurement direction");
    check(entry.featured === undefined || typeof entry.featured === "boolean", "featured mark");
    check(entry.featuredInBlock === undefined || typeof entry.featuredInBlock === "boolean", "featured-in-group mark");
    check(entry.gallery === undefined || (typeof entry.gallery === "object" && entry.gallery !== null
      && isGalleryStart(entry.gallery.start) && isGalleryMethod(entry.gallery.method)), "place in its basis group's grid");
    check(entry.cellPicture === undefined || typeof entry.cellPicture === "boolean", "cell picture mark");
  }
  return value as MaterialIndex;
}

/** Per block: how many published materials, and how many of them fired. */
export function materialCounts(index: MaterialIndex): Map<number, { total: number; fired: number }> {
  const counts = new Map<number, { total: number; fired: number }>();
  for (const entry of index.entries) {
    const count = counts.get(entry.block) ?? { total: 0, fired: 0 };
    counts.set(entry.block, { total: count.total + 1, fired: count.fired + (entry.fired ? 1 : 0) });
  }
  return counts;
}

/** One block's materials: those that fired first, then the stronger readings. */
export function materialsOfBlock(index: MaterialIndex, block: number): MaterialEntry[] {
  return index.entries.filter((entry) => entry.block === block)
    .sort((a, b) => Number(b.fired) - Number(a.fired) || (b.strength ?? -Infinity) - (a.strength ?? -Infinity) || a.id.localeCompare(b.id));
}

/** Every block with a material, in number order, each with its materials in materialsOfBlock's order. */
export function materialsByBlock(index: MaterialIndex): { block: number; materials: MaterialEntry[] }[] {
  const blocks = [...new Set(index.entries.map((entry) => entry.block))].sort((a, b) => a - b);
  return blocks.map((block) => ({ block, materials: materialsOfBlock(index, block) }));
}
