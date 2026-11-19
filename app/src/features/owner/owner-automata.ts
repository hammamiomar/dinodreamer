// The owner's view of the Automata page (owner-automata-page.tsx): the same wall and the same screen
// as a visitor's (features/automata/), over every research run as well as every published automaton.
// A run a visitor does not see is present and marked. The rules here say where each one stands, what
// the owner can do with it, and what an action's answer changes on the page. The Worker owns the
// operations (gallery/src/admin.ts); this module has no browser or React imports.

import { FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import type { GalleryAutomaton } from "../automata/gallery";
import { placeOf, type MaterialEntry } from "../gallery/material-index";
import { entryIdOfRun, placeOfRun, type ResearchManifest, type ResearchRun } from "../research/research-runs";

/**
 * Where an automaton stands: a visitor sees it; the owner hid it, and its record waits; or it is a
 * research run that was never shown, private until the owner shows it.
 */
export type OwnerState = "shown" | "hidden" | "not-shown";

export interface OwnerAutomaton extends GalleryAutomaton {
  state: OwnerState;
  /** Its published entry, or the record it was hidden with; null for a run that was never shown. */
  entry: MaterialEntry | null;
  /** The research run that holds its rule; null for an automaton a visitor published. */
  run: ResearchRun | null;
}

/**
 * What the owner's view reads: the published index, the hidden records, the research run index (null
 * before its first publish), and the runs an earlier promotion published under a submission's id
 * (run id to entry id, research-runs.ts promotedRunEntries).
 */
export interface OwnerRead {
  shown: readonly MaterialEntry[];
  hidden: readonly MaterialEntry[];
  manifest: ResearchManifest | null;
  promotions: ReadonlyMap<string, string>;
}

/** Where the page finds an automaton's still: a published or hidden automaton's poster, or a run's last still. */
export interface OwnerPictures {
  poster: (entry: MaterialEntry) => string;
  still: (run: ResearchRun) => string;
}

function automatonOfRun(run: ResearchRun, entry: MaterialEntry | null, state: OwnerState, madeAt: string, pictures: OwnerPictures): OwnerAutomaton | null {
  // The export's place is the truth for a run: an entry published before the gallery carries none.
  const place = placeOfRun(run);
  if (place === null || run.group === null) return null;
  return {
    // The entry's own id when the run has one, so the address is the one a visitor's page uses.
    id: entry?.id ?? entryIdOfRun(run),
    group: run.group,
    place,
    grids: run.rule === "pyramid" ? "coarse-fine" : "fine",
    pictureUrl: entry === null ? pictures.still(run) : pictures.poster(entry),
    shown: state === "shown",
    cellPicture: entry?.cellPicture === true,
    groupPicture: entry?.featuredInBlock === true,
    siteFeatured: entry?.featured === true,
    metTarget: run.outcome.firesAtUpdate !== null,
    madeAt,
    state,
    entry,
    run,
  };
}

function automatonOfEntry(entry: MaterialEntry, state: OwnerState, pictures: OwnerPictures): OwnerAutomaton {
  return {
    id: entry.id,
    group: entry.block,
    place: placeOf(entry),
    grids: entry.layout === FIGURE_PYRAMID_LAYOUT ? "coarse-fine" : "fine",
    pictureUrl: pictures.poster(entry),
    shown: state === "shown",
    cellPicture: entry.cellPicture === true,
    groupPicture: entry.featuredInBlock === true,
    siteFeatured: entry.featured === true,
    metTarget: entry.fired,
    madeAt: entry.publishedAt,
    state,
    entry,
    run: null,
  };
}

/**
 * The entry that holds a run's rule, among these: the one the run is on the page as (entryIdOfRun), or
 * the one an earlier promotion published under a submission's id, which `promotions` names after a
 * rule match. A file's own id (materialId) is its submitter's claim and never links an entry to a run.
 * Null when none does.
 */
export function entryOfRun(run: ResearchRun, entries: readonly MaterialEntry[], promotions: ReadonlyMap<string, string>): MaterialEntry | null {
  const id = entryIdOfRun(run);
  const promoted = promotions.get(run.id);
  return entries.find((entry) => entry.id === id) ?? (promoted === undefined ? null : entries.find((entry) => entry.id === promoted) ?? null);
}

/**
 * Every automaton of the owner's view, each once: a research run with the entry it is on the page
 * as (shown, hidden or none), then the published and hidden automata that no run holds, which
 * visitors made. `unfiled` counts the runs the grid has no place for: an older export's, a start
 * outside the grid, or a run without a basis group.
 */
export function ownerAutomata(read: OwnerRead, pictures: OwnerPictures): { automata: OwnerAutomaton[]; unfiled: number } {
  const studyDates = new Map((read.manifest?.studies ?? []).map((study) => [study.id, study.date]));
  const automata: OwnerAutomaton[] = [];
  const taken = new Set<string>();
  let unfiled = 0;
  for (const run of read.manifest?.runs ?? []) {
    const shown = entryOfRun(run, read.shown, read.promotions);
    const hidden = shown === null ? entryOfRun(run, read.hidden, read.promotions) : null;
    const state: OwnerState = shown !== null ? "shown" : hidden !== null ? "hidden" : "not-shown";
    const automaton = automatonOfRun(run, shown ?? hidden, state, studyDates.get(run.study) ?? "", pictures);
    // Two runs can hold one rule (a rule trained once and exported by two studies): the first is the automaton.
    if (automaton === null || taken.has(automaton.id)) {
      if (automaton === null) unfiled++;
      continue;
    }
    taken.add(automaton.id);
    automata.push(automaton);
  }
  for (const [entries, state] of [[read.shown, "shown"], [read.hidden, "hidden"]] as const) {
    for (const entry of entries) {
      if (!taken.has(entry.id)) automata.push(automatonOfEntry(entry, state, pictures));
    }
  }
  return { automata, unfiled };
}

/** What the owner can do with one automaton (POST /admin/api/…, owner-materials.ts). */
export type OwnerAutomatonAction = "show" | "hide" | "cell-picture" | "group-picture" | "feature" | "unfeature" | "purge";

/**
 * The actions the stage offers, in the order they show. A run that was never shown can only be
 * shown. A hidden automaton can be shown again or purged. A shown one can be hidden, made the picture
 * of its cell or of its group when it is not that already, featured for the site or not, and purged.
 */
export function actionsFor(automaton: Pick<OwnerAutomaton, "state" | "cellPicture" | "groupPicture" | "siteFeatured">): OwnerAutomatonAction[] {
  if (automaton.state === "not-shown") return ["show"];
  if (automaton.state === "hidden") return ["show", "purge"];
  const actions: OwnerAutomatonAction[] = ["hide"];
  if (!automaton.cellPicture) actions.push("cell-picture");
  if (!automaton.groupPicture) actions.push("group-picture");
  actions.push(automaton.siteFeatured ? "unfeature" : "feature", "purge");
  return actions;
}

/** Purge deletes an automaton's public files for good, so it asks once more, in place. */
export function requiresConfirmation(action: OwnerAutomatonAction): boolean {
  return action === "purge";
}

/**
 * What an action's answer changes: the entries that are now shown as the Worker lists them, the
 * records that are now hidden, and the ids that are gone from both (a purge).
 */
export interface OwnerChange {
  shown?: readonly MaterialEntry[];
  hidden?: readonly MaterialEntry[];
  gone?: readonly string[];
}

/** The page's read after a change: each entry in its new list, every other entry the same object as before. */
export function afterChange(read: OwnerRead, change: OwnerChange): OwnerRead {
  const nowShown = new Map((change.shown ?? []).map((entry) => [entry.id, entry]));
  const nowHidden = new Map((change.hidden ?? []).map((entry) => [entry.id, entry]));
  const leaves = new Set([...nowShown.keys(), ...nowHidden.keys(), ...(change.gone ?? [])]);
  const kept = (entries: readonly MaterialEntry[]) => entries.filter((entry) => !leaves.has(entry.id));
  return {
    ...read,
    shown: [...kept(read.shown), ...nowShown.values()],
    hidden: [...kept(read.hidden), ...nowHidden.values()],
  };
}

/** The owner's counts for a group or for the whole page: how many a visitor sees, of how many. */
export function ownerCounts(automata: readonly OwnerAutomaton[]): { shown: number; hidden: number; notShown: number; all: number } {
  const count = (state: OwnerState) => automata.filter((automaton) => automaton.state === state).length;
  return { shown: count("shown"), hidden: count("hidden"), notShown: count("not-shown"), all: automata.length };
}
