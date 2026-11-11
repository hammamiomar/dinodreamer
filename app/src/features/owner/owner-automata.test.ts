import { describe, expect, it } from "vitest";
import { FIGURE_LAYOUT } from "../../materials/material-file";
import { arrangeGroup, pictureOfCell, pictureOfGroup, shownCount } from "../automata/gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { readResearchManifest, type ResearchManifest } from "../research/research-runs";
import { actionsFor, afterChange, ownerAutomata, ownerCounts, type OwnerRead } from "./owner-automata";

const PICTURES = { poster: (id: string) => `/poster/${id}`, still: (run: { id: string }) => `/still/${run.id}` };

function entry(id: string, changes: Partial<MaterialEntry> = {}): MaterialEntry {
  return {
    id, title: "", credit: "DinoDreamer project", publishedAt: "2026-11-10T00:00:00.000Z", materialId: id, block: 7178, recipe: "figure-2026-10-22",
    band: "strongest", strength: 1, winnerFraction: 1, fired: true, side: 128, seed: 1, tick: 600, engine: "e", trainerCommit: "t",
    layout: FIGURE_LAYOUT, start: "noise", pixelsPerCell: 1, ...changes,
  };
}

function manifest(runs: Record<string, unknown>[]): ResearchManifest {
  return readResearchManifest({
    format: 1, generatedAt: "2026-11-10T20:00:00Z", researchCommit: "0123abcd", dictionaryId: "monet-dtd-seed9-20261004-pass-003",
    studies: [{ id: "day-1", date: "2026-10-30", title: "First", question: "Does it fire?" }],
    runs: runs.map((fields) => ({
      study: "day-1", group: 7178, groupName: "", start: { kind: "noise" }, loss: { kind: "plain" }, rule: "pyramid", seed: 0,
      schedule: { updates: 1000, pool: 64 },
      outcome: {
        releasedAtUpdate: null, requestLoss: null, centreSelected: null, naturalRouteKept: null,
        guideLossAtRelease: null, guideLossEnd: null, firesAtUpdate: 400, holds4000: true,
      },
      reading: { line: "", tags: [] }, materialSha256: "a".repeat(64), stills: [200, 600],
      gallery: { start: "noise", method: "basis-group-mean", target: "group", shown: false },
      ...fields,
    })),
  });
}

describe("the owner's automata", () => {
  const read: OwnerRead = {
    shown: [entry("block-7178-on-the-site"), entry("7178-shown-run"), entry("20261110-visitor", { block: 12002 })],
    hidden: [entry("7178-hidden-run")],
    manifest: manifest([
      { id: "7178-site-run", siteMaterials: ["block-7178-on-the-site"], gallery: { start: "circle", method: "token-distribution", target: "group", shown: true } },
      { id: "7178-shown-run" },
      { id: "7178-hidden-run" },
      { id: "7178-private-run" },
      { id: "7178-old-start", gallery: { start: null, method: "basis-group-mean", target: "other", shown: false } },
    ]),
  };
  const { automata, unfiled } = ownerAutomata(read, PICTURES);
  const of = (id: string) => automata.find((automaton) => automaton.id === id)!;

  it("holds every run once, with where it stands, and the automata no run holds", () => {
    expect(automata.map((automaton) => [automaton.id, automaton.state])).toEqual([
      ["block-7178-on-the-site", "shown"], ["7178-shown-run", "shown"], ["7178-hidden-run", "hidden"], ["7178-private-run", "not-shown"],
      ["20261110-visitor", "shown"],
    ]);
    expect(unfiled).toBe(1);
    expect(ownerCounts(automata)).toEqual({ shown: 3, hidden: 1, notShown: 1, all: 5 });
  });

  it("a run that is a published automaton keeps that automaton's address and takes the export's place", () => {
    const onSite = of("block-7178-on-the-site");
    expect(onSite.run?.id).toBe("7178-site-run");
    expect(onSite.place).toEqual({ start: "circle", method: "token-distribution" });
    expect(onSite.pictureUrl).toBe("/poster/block-7178-on-the-site");
  });

  it("a run that an earlier promotion published under a submission's id is that automaton, once", () => {
    const promoted = entry("20261102-153012-a1b2c3d4", { materialId: "7178-private-run" });
    const once = ownerAutomata({ ...read, shown: [...read.shown, promoted] }, PICTURES).automata;
    const found = once.filter((automaton) => automaton.run?.id === "7178-private-run");
    expect(found.map((automaton) => [automaton.id, automaton.state])).toEqual([["20261102-153012-a1b2c3d4", "shown"]]);
    expect(once.filter((automaton) => automaton.id === "20261102-153012-a1b2c3d4")).toHaveLength(1);
  });

  it("a run that was never shown shows its last still and no entry; a visitor's automaton has no run", () => {
    expect([of("7178-private-run").pictureUrl, of("7178-private-run").entry]).toEqual(["/still/7178-private-run", null]);
    expect([of("20261110-visitor").run, of("20261110-visitor").group]).toEqual([null, 12002]);
  });

  it("a visitor sees only the shown ones, and a cell's picture is one a visitor sees", () => {
    const group = arrangeGroup(7178, automata.filter((automaton) => automaton.group === 7178));
    expect(shownCount(group.automata)).toBe(2);
    const noise = group.cells.find((cell) => cell.place.start === "noise")!;
    expect(noise.tries.map((automaton) => automaton.id)).toEqual(["7178-shown-run", "7178-hidden-run", "7178-private-run"]);
    expect(pictureOfCell(noise).id).toBe("7178-shown-run");
    expect(pictureOfGroup(group)?.shown).toBe(true);
  });
});

describe("the owner's actions", () => {
  const marks = { cellPicture: false, groupPicture: false, siteFeatured: false };

  it("a run that was never shown can only be shown; a hidden automaton can be shown again or purged", () => {
    expect(actionsFor({ state: "not-shown", ...marks })).toEqual(["show"]);
    expect(actionsFor({ state: "hidden", ...marks })).toEqual(["show", "purge"]);
  });

  it("a shown one can be hidden, made a picture where it is not one already, featured or not, and purged", () => {
    expect(actionsFor({ state: "shown", ...marks })).toEqual(["hide", "cell-picture", "group-picture", "feature", "purge"]);
    expect(actionsFor({ state: "shown", cellPicture: true, groupPicture: true, siteFeatured: true })).toEqual(["hide", "unfeature", "purge"]);
  });

  it("an answer moves each entry to its new list and leaves every other entry the same object", () => {
    const a = entry("a");
    const b = entry("b");
    const c = entry("c");
    const read: OwnerRead = { shown: [a, b], hidden: [c], manifest: null };
    const hiddenA = { ...a, hiddenAt: "2026-11-10T21:00:00.000Z" };
    const afterHide = afterChange(read, { hidden: [hiddenA] });
    expect([afterHide.shown, afterHide.hidden]).toEqual([[b], [c, hiddenA]]);
    expect(afterHide.shown[0]).toBe(b);
    const marked = { ...b, cellPicture: true };
    expect(afterChange(read, { shown: [marked] }).shown).toEqual([a, marked]);
    expect(afterChange(read, { shown: [c] })).toMatchObject({ shown: [a, b, c], hidden: [] });
    expect(afterChange(read, { gone: ["a", "c"] })).toMatchObject({ shown: [b], hidden: [] });
  });
});
