import { describe, expect, it } from "vitest";
import type { MaterialEntry } from "../gallery/material-index";
import { actionsFor, afterAction, featuredGroup, findItem, marksOf, ownerCounts, readShelf } from "./owner-mode";

const base: MaterialEntry = {
  id: "block-12002-figure-strongest-seed-1", title: "12002 · strongest · seed 1", credit: "DinoDreamer project", publishedAt: "2026-10-23T00:00:00Z",
  materialId: "block-12002-figure-strongest-seed-1", block: 12002, recipe: "figure-2026-10-22", band: "strongest",
  strength: 2.387, winnerFraction: 1, fired: true, side: 128, seed: 2026102201, tick: 600, engine: "pytorch", trainerCommit: "9822ee64",
  layout: "figure-16-96-torus-v1", start: "noise", pixelsPerCell: 1, experiment: "E18", featured: false,
};
const shownA: MaterialEntry = { ...base, id: "shown-a" };
const shownB: MaterialEntry = { ...base, id: "shown-b", featured: true };
const hiddenC: MaterialEntry = { ...base, id: "hidden-c" };
const pendingD: MaterialEntry = { ...base, id: "20261026-101500-a1b2c3d4" };
const shelf = readShelf({ pending: [pendingD], shown: [shownA, shownB], hidden: [hiddenC] });
const ids = (items: readonly { entry: MaterialEntry }[]) => items.map((item) => item.entry.id);

describe("the owner mode", () => {
  it("keeps every automaton in a slot: pending ones first, then the shown ones in the index's order, then the hidden ones", () => {
    expect(ids(shelf.pending)).toEqual([pendingD.id]);
    expect(ids(shelf.published)).toEqual([shownA.id, shownB.id, hiddenC.id]);
    expect(shelf.published.map((item) => item.state)).toEqual(["shown", "shown", "hidden"]);
  });

  it("offers each state its actions: hide, feature or unfeature and purge; restore and purge; approve and reject; none after purge or reject", () => {
    expect(actionsFor(findItem(shelf, shownA.id)!)).toEqual(["hide", "feature", "purge"]);
    expect(actionsFor(findItem(shelf, shownB.id)!)).toEqual(["hide", "unfeature", "purge"]);
    expect(actionsFor(findItem(shelf, hiddenC.id)!)).toEqual(["restore", "purge"]);
    expect(actionsFor(findItem(shelf, pendingD.id)!)).toEqual(["approve", "reject"]);
    const after = afterAction(afterAction(shelf, shownA.id, "purge", null), pendingD.id, "reject", null);
    expect(actionsFor(findItem(after, shownA.id)!)).toEqual([]);
    expect(actionsFor(findItem(after, pendingD.id)!)).toEqual([]);
  });

  it("changes one automaton in its slot and preserves every other item's object identity", () => {
    const hidden = afterAction(shelf, shownA.id, "hide", { ...shownA, hiddenAt: "2026-10-26T10:00:00Z" } as MaterialEntry);
    expect(ids(hidden.published)).toEqual(ids(shelf.published));
    expect(findItem(hidden, shownA.id)!.state).toBe("hidden");
    expect(hidden.published[1]).toBe(shelf.published[1]);
    expect(hidden.pending[0]).toBe(shelf.pending[0]);
    expect(findItem(afterAction(hidden, shownA.id, "restore", shownA), shownA.id)!.state).toBe("shown");
    // Feature keeps the state and takes the Worker's entry; Purge keeps the entry the page had.
    const featured = afterAction(shelf, shownA.id, "feature", { ...shownA, featured: true });
    expect(findItem(featured, shownA.id)).toEqual({ entry: { ...shownA, featured: true }, state: "shown" });
    expect(findItem(afterAction(shelf, shownB.id, "purge", null), shownB.id)).toEqual({ entry: shownB, state: "purged" });
    // Approved on this page, a pending automaton stays in Pending review and acts as a shown one.
    const approved = afterAction(shelf, pendingD.id, "approve", pendingD);
    expect(ids(approved.pending)).toEqual([pendingD.id]);
    expect(actionsFor(findItem(approved, pendingD.id)!)).toEqual(["hide", "feature", "purge"]);
  });

  it("marks a tile with its state when not simply shown, then Featured while the mark holds", () => {
    const words = (id: string, at = shelf) => marksOf(findItem(at, id)!).map((mark) => mark.kind);
    expect(words(shownA.id)).toEqual([]);
    expect(words(shownB.id)).toEqual(["featured"]);
    expect(words(hiddenC.id)).toEqual(["hidden"]);
    expect(words(pendingD.id)).toEqual(["pending"]);
    expect(words(shownB.id, afterAction(shelf, shownB.id, "purge", null))).toEqual(["purged"]);
    expect(words(pendingD.id, afterAction(shelf, pendingD.id, "approve", pendingD))).toEqual(["approved"]);
    expect(words(pendingD.id, afterAction(shelf, pendingD.id, "reject", null))).toEqual(["rejected"]);
  });

  it("keeps the Featured group as read, with each automaton's current entry", () => {
    const unfeatured = afterAction(shelf, shownB.id, "unfeature", { ...shownB, featured: false });
    expect(featuredGroup(unfeatured, [shownB.id])).toEqual([{ ...shownB, featured: false }]);
    expect(featuredGroup(afterAction(shelf, shownA.id, "feature", { ...shownA, featured: true }), [shownB.id]).map((entry) => entry.id)).toEqual([shownB.id]);
  });

  it("counts the shown, hidden, pending and featured automata after each action", () => {
    expect(ownerCounts(shelf)).toEqual({ shown: 2, hidden: 1, pending: 1, featured: 1 });
    const after = afterAction(afterAction(shelf, pendingD.id, "approve", { ...pendingD, featured: false }), shownB.id, "hide", shownB);
    expect(ownerCounts(after)).toEqual({ shown: 2, hidden: 2, pending: 0, featured: 0 });
  });
});
