// Owner actions update an automaton in its existing shelf slot. Groups keep their original
// membership until the next page load, preserving the shelf's scroll position and running player.

import { SITE_WORDS } from "../../app/site-words";
import type { MaterialEntry } from "../gallery/material-index";
import type { OwnerAction } from "./owner-materials";

const WORDS = SITE_WORDS.owner;

/** An automaton's state for the owner: the Worker's (shown, hidden, pending), or the result of an action on this page. */
export type OwnerState = "shown" | "hidden" | "purged" | "pending" | "approved" | "rejected";

export interface OwnerItem {
  /** The entry its tile and the stage show; an action replaces it with the Worker's answer. */
  entry: MaterialEntry;
  state: OwnerState;
}

/** The page's automata in their slots: Pending review, then every published one, shown before hidden. */
export interface OwnerShelf {
  pending: readonly OwnerItem[];
  published: readonly OwnerItem[];
}

/** The automata as the owner API answered them; a pending one's entry is built from its file (owner-materials.ts). */
export function readShelf(read: { pending: readonly MaterialEntry[]; shown: readonly MaterialEntry[]; hidden: readonly MaterialEntry[] }): OwnerShelf {
  return {
    pending: read.pending.map((entry) => ({ entry, state: "pending" })),
    published: [
      ...read.shown.map((entry): OwnerItem => ({ entry, state: "shown" })),
      ...read.hidden.map((entry): OwnerItem => ({ entry, state: "hidden" })),
    ],
  };
}

export function findItem(shelf: OwnerShelf, id: string): OwnerItem | undefined {
  return shelf.pending.find((item) => item.entry.id === id) ?? shelf.published.find((item) => item.entry.id === id);
}

/**
 * The actions the stage offers for an automaton, in the order they show. A shown one, or one approved
 * on this page, can be hidden, featured or unfeatured, and purged; a hidden one restored or purged; a
 * pending one approved or rejected. A purged or rejected one has no action left.
 */
export function actionsFor(item: OwnerItem): OwnerAction[] {
  switch (item.state) {
    case "shown":
    case "approved":
      return ["hide", item.entry.featured === true ? "unfeature" : "feature", "purge"];
    case "hidden":
      return ["restore", "purge"];
    case "pending":
      return ["approve", "reject"];
    case "purged":
    case "rejected":
      return [];
  }
}

/** Purge and Reject delete for good, so each asks once more, in place. */
export function requiresConfirmation(action: OwnerAction): boolean {
  return action === "purge" || action === "reject";
}

/** The state an action leaves: Hide and Restore swap shown and hidden, Feature and Unfeature keep it, the others end in their own. */
function stateAfter(state: OwnerState, action: OwnerAction): OwnerState {
  switch (action) {
    case "hide":
      return "hidden";
    case "restore":
      return "shown";
    case "feature":
    case "unfeature":
      return state;
    case "purge":
      return "purged";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
  }
}

/**
 * The page's automata after one action on `id`: the automaton keeps its slot, takes the entry the
 * Worker answered (its own entry when the answer is only an id) and its new state. Every other item
 * keeps its object identity.
 */
export function afterAction(shelf: OwnerShelf, id: string, action: OwnerAction, answered: MaterialEntry | null): OwnerShelf {
  const change = (item: OwnerItem): OwnerItem =>
    item.entry.id === id ? { entry: answered ?? item.entry, state: stateAfter(item.state, action) } : item;
  return { pending: shelf.pending.map(change), published: shelf.published.map(change) };
}

/** A word on a tile's label line (the shelf's TileMark, playground-shelf.tsx). */
export interface OwnerMark {
  kind: "hidden" | "featured" | "pending" | "purged" | "approved" | "rejected";
  word: string;
}

const STATE_MARKS: Record<OwnerState, OwnerMark | null> = {
  shown: null,
  hidden: { kind: "hidden", word: WORDS.markHidden },
  purged: { kind: "purged", word: WORDS.markPurged },
  pending: { kind: "pending", word: WORDS.markPending },
  approved: { kind: "approved", word: WORDS.markApproved },
  rejected: { kind: "rejected", word: WORDS.markRejected },
};

/** A tile's marks: its state when it is not simply shown, then Featured while the mark holds. */
export function marksOf(item: OwnerItem): OwnerMark[] {
  const marks: OwnerMark[] = [];
  const state = STATE_MARKS[item.state];
  if (state !== null) marks.push(state);
  const isRemoved = item.state === "purged" || item.state === "rejected";
  if (item.entry.featured === true && !isRemoved) marks.push({ kind: "featured", word: WORDS.markFeatured });
  return marks;
}

/** The Featured group keeps the automata it held when the page was read (`ids`), each with its current entry. */
export function featuredGroup(shelf: OwnerShelf, ids: readonly string[]): MaterialEntry[] {
  return ids.flatMap((id) => {
    const item = findItem(shelf, id);
    return item === undefined ? [] : [item.entry];
  });
}

/** The bar's counts: automata shown (approved on this page included), hidden, pending, and shown with the featured mark. */
export function ownerCounts(shelf: OwnerShelf): { shown: number; hidden: number; pending: number; featured: number } {
  const items = [...shelf.pending, ...shelf.published];
  const shown = items.filter((item) => item.state === "shown" || item.state === "approved");
  return {
    shown: shown.length,
    hidden: items.filter((item) => item.state === "hidden").length,
    pending: items.filter((item) => item.state === "pending").length,
    featured: shown.filter((item) => item.entry.featured === true).length,
  };
}
