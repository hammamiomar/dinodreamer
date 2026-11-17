import { describe, expect, test } from "vitest";
import type { GalleryMethod, GalleryStart } from "../gallery/gallery-place";
import {
  addressSearch, arrangeGroup, findGroups, neighboursOf, sortWall, arrangeGroups, automatonToPlay, axesOf, cellAt, cellBeside, COMMON_METHODS, COMMON_STARTS, groupOfAutomaton,
  groupPath, pictureOfCell, pictureOfGroup, readAddress, shownCount, tryAfter, wallOrder, type GalleryAutomaton,
} from "./gallery";

function automaton(id: string, start: GalleryStart, method: GalleryMethod, changes: Partial<GalleryAutomaton> = {}): GalleryAutomaton {
  return {
    id, group: 7178, place: { start, method }, grids: "fine", pictureUrl: `/pictures/${id}.png`, shown: true,
    cellPicture: false, groupPicture: false, siteFeatured: false, metTarget: false, madeAt: "2026-11-01", ...changes,
  };
}

const ids = (automata: readonly GalleryAutomaton[]) => automata.map((each) => each.id);

describe("a group's grid", () => {
  test("has the common starts and methods even where the group has no automaton", () => {
    const axes = axesOf([automaton("a", "noise", "basis-group-mean")]);
    expect(axes.starts).toEqual(COMMON_STARTS);
    expect(axes.methods).toEqual(COMMON_METHODS);
  });

  test("gains a row or a column for a rare start or method only when the group has it, in the gallery's order", () => {
    const axes = axesOf([
      automaton("a", "circle-anywhere", "basis-group-distribution"),
      automaton("b", "noise", "token-mean"),
    ]);
    expect(axes.starts).toEqual(["noise", "circle", "circle-on-noise", "circle-anywhere"]);
    expect(axes.methods).toEqual(["basis-group-mean", "basis-group-mean-guided", "basis-group-distribution", "token-mean", "token-distribution"]);
  });

  test("files each automaton in the cell of its start and method, row by row, and lists no empty cell", () => {
    const group = arrangeGroup(7178, [
      automaton("d", "circle", "token-distribution"),
      automaton("a", "noise", "basis-group-mean"),
      automaton("c", "circle", "basis-group-mean"),
      automaton("b", "noise", "token-distribution"),
    ]);
    expect(group.cells.map((cell) => [cell.place.start, cell.place.method, ids(cell.tries)])).toEqual([
      ["noise", "basis-group-mean", ["a"]],
      ["noise", "token-distribution", ["b"]],
      ["circle", "basis-group-mean", ["c"]],
      ["circle", "token-distribution", ["d"]],
    ]);
    expect(cellAt(group, { start: "circle-on-noise", method: "basis-group-mean" })).toBeNull();
  });

  test("every basis group with an automaton, in number order", () => {
    const groups = arrangeGroups([
      automaton("a", "noise", "basis-group-mean", { group: 12002 }),
      automaton("b", "noise", "basis-group-mean", { group: 729 }),
      automaton("c", "circle", "basis-group-mean", { group: 12002 }),
    ]);
    expect(groups.map((group) => [group.group, group.automata.length])).toEqual([[729, 1], [12002, 2]]);
  });
});

describe("the tries of a cell", () => {
  const place = ["noise", "basis-group-mean"] as const;

  test("a cell holds every automaton of its place and shows one picture, never a column", () => {
    const tries = Array.from({ length: 72 }, (_, index) => automaton(`try-${String(index).padStart(2, "0")}`, ...place));
    const group = arrangeGroup(7178, tries);
    expect(group.cells).toHaveLength(1);
    expect(group.cells[0]!.tries).toHaveLength(72);
    expect(pictureOfCell(group.cells[0]!).id).toBe("try-00");
  });

  test("the owner's picture of the cell comes first, then the group's picture, then a met target, then the newer", () => {
    const group = arrangeGroup(7178, [
      automaton("older", ...place, { madeAt: "2026-10-22" }),
      automaton("newer", ...place, { madeAt: "2026-11-03" }),
      automaton("met", ...place, { metTarget: true, madeAt: "2026-10-20" }),
      automaton("group-picture", ...place, { groupPicture: true }),
      automaton("cell-picture", ...place, { cellPicture: true }),
    ]);
    expect(ids(group.cells[0]!.tries)).toEqual(["cell-picture", "group-picture", "met", "newer", "older"]);
  });

  test("a try a visitor does not see comes after every one a visitor sees, whatever its marks", () => {
    const group = arrangeGroup(7178, [
      automaton("hidden-picture", ...place, { shown: false, cellPicture: true }),
      automaton("shown", ...place),
    ]);
    expect(ids(group.cells[0]!.tries)).toEqual(["shown", "hidden-picture"]);
    expect(shownCount(group.automata)).toBe(1);
  });

  test("the arrow keys step through a cell's tries and stop at its ends", () => {
    const cell = arrangeGroup(7178, [automaton("a", ...place), automaton("b", ...place), automaton("c", ...place)]).cells[0]!;
    expect(tryAfter(cell, "a", 1).id).toBe("b");
    expect(tryAfter(cell, "c", 1).id).toBe("c");
    expect(tryAfter(cell, "a", -1).id).toBe("a");
    expect(tryAfter(cell, "b", -1).id).toBe("a");
  });
});

describe("a group's picture and its place on the wall", () => {
  test("the owner's picture of the group comes first, then an automaton featured for the site, then the first cell's picture", () => {
    const first = automaton("first", "noise", "basis-group-mean");
    const forSite = automaton("for-site", "circle", "basis-group-mean", { siteFeatured: true });
    const chosen = automaton("chosen", "circle", "token-distribution", { groupPicture: true });
    expect(pictureOfGroup(arrangeGroup(7178, [first]))?.id).toBe("first");
    expect(pictureOfGroup(arrangeGroup(7178, [first, forSite]))?.id).toBe("for-site");
    expect(pictureOfGroup(arrangeGroup(7178, [first, forSite, chosen]))?.id).toBe("chosen");
  });

  test("a hidden automaton is never the group's picture while the group shows another", () => {
    const hidden = automaton("hidden", "noise", "basis-group-mean", { shown: false, siteFeatured: true });
    const shown = automaton("shown", "circle", "basis-group-mean");
    expect(pictureOfGroup(arrangeGroup(7178, [hidden, shown]))?.id).toBe("shown");
    expect(pictureOfGroup(arrangeGroup(7178, [hidden]))?.id).toBe("hidden");
  });

  test("the groups featured for the site come first on the wall, then the others, each in number order", () => {
    const groups = arrangeGroups([
      automaton("a", "noise", "basis-group-mean", { group: 729 }),
      automaton("b", "noise", "basis-group-mean", { group: 2568, siteFeatured: true }),
      automaton("c", "noise", "basis-group-mean", { group: 12002, siteFeatured: true }),
      automaton("d", "noise", "basis-group-mean", { group: 13633 }),
    ]);
    expect(wallOrder(groups).map((group) => group.group)).toEqual([2568, 12002, 729, 13633]);
  });
});

describe("the stage and the arrow keys", () => {
  const group = arrangeGroup(7178, [
    automaton("noise-mean", "noise", "basis-group-mean"),
    automaton("noise-token", "noise", "token-distribution"),
    automaton("field-token", "circle-on-noise", "token-distribution"),
  ]);

  test("the stage plays the automaton the address names, or the group's picture when it names none of the group's", () => {
    expect(automatonToPlay(group, "field-token")?.automaton.id).toBe("field-token");
    expect(automatonToPlay(group, "field-token")?.cell.place).toEqual({ start: "circle-on-noise", method: "token-distribution" });
    expect(automatonToPlay(group, null)?.automaton.id).toBe("noise-mean");
    expect(automatonToPlay(group, "of-another-group")?.automaton.id).toBe("noise-mean");
  });

  test("an arrow moves to the next cell that holds an automaton, across the empty ones, and stays when there is none", () => {
    const from = { start: "noise", method: "basis-group-mean" } as const;
    expect(cellBeside(group, from, "right").place.method).toBe("token-distribution");
    expect(cellBeside(group, from, "left").place).toEqual(from);
    expect(cellBeside(group, from, "down").place).toEqual(from);
    expect(cellBeside(group, { start: "noise", method: "token-distribution" }, "down").place.start).toBe("circle-on-noise");
    expect(cellBeside(group, { start: "circle-on-noise", method: "token-distribution" }, "up").place.start).toBe("noise");
  });
});

describe("the wall in a reader's order, and what a reader's words find", () => {
  const groups = arrangeGroups([
    automaton("a", "noise", "basis-group-mean", { group: 729, madeAt: "2026-10-22" }),
    automaton("b", "noise", "basis-group-mean", { group: 2568, siteFeatured: true, madeAt: "2026-10-20" }),
    automaton("c", "noise", "basis-group-mean", { group: 12002, madeAt: "2026-11-05" }),
    automaton("d", "circle", "basis-group-mean", { group: 12002, madeAt: "2026-10-01" }),
    automaton("e", "noise", "basis-group-mean", { group: 12240, madeAt: "2026-11-09", shown: false }),
    automaton("f", "noise", "basis-group-mean", { group: 12240, madeAt: "2026-10-30" }),
  ]);
  const names: Record<number, string> = { 729: "light on glass", 2568: "golden fur", 12002: "Cartoon eyes" };
  const nameOf = (group: number) => names[group] ?? null;
  const numbers = (found: { group: number }[]) => found.map((group) => group.group);

  test("the wall's own order, then the newest automaton a visitor sees, the most automata, the number, the name", () => {
    expect(numbers(sortWall(groups, "featured", nameOf))).toEqual([2568, 729, 12002, 12240]);
    expect(numbers(sortWall(groups, "newest", nameOf))).toEqual([12002, 12240, 729, 2568]);
    expect(numbers(sortWall(groups, "most", nameOf))).toEqual([12002, 729, 2568, 12240]);
    expect(numbers(sortWall(groups, "number", nameOf))).toEqual([729, 2568, 12002, 12240]);
    expect(numbers(sortWall(groups, "name", nameOf))).toEqual([12002, 2568, 729, 12240]);
  });

  test("digits find the groups whose number holds them; words find the groups whose name holds every one", () => {
    expect(numbers(findGroups(groups, "12", nameOf))).toEqual([12002, 12240]);
    expect(numbers(findGroups(groups, "002", nameOf))).toEqual([12002]);
    expect(numbers(findGroups(groups, "EYES", nameOf))).toEqual([12002]);
    expect(numbers(findGroups(groups, "glass light", nameOf))).toEqual([729]);
    expect(numbers(findGroups(groups, "  ", nameOf))).toEqual([729, 2568, 12002, 12240]);
    expect(findGroups(groups, "zebra", nameOf)).toEqual([]);
  });
});

describe("a group's neighbours", () => {
  test("Previous and Next follow the wall's order, and stop at its ends", () => {
    const groups = arrangeGroups([
      automaton("a", "noise", "basis-group-mean", { group: 729 }),
      automaton("b", "noise", "basis-group-mean", { group: 2568, siteFeatured: true }),
      automaton("c", "noise", "basis-group-mean", { group: 13633 }),
    ]);
    expect(neighboursOf(groups, 2568)).toEqual({ previous: null, next: 729 });
    expect(neighboursOf(groups, 729)).toEqual({ previous: 2568, next: 13633 });
    expect(neighboursOf(groups, 13633)).toEqual({ previous: 729, next: null });
  });
});

describe("the address", () => {
  test("round trip: the wall, a group, an automaton of a group, the saved automata", () => {
    for (const address of [
      { group: null, automaton: null },
      { group: 7178, automaton: null },
      { group: 7178, automaton: "7178-given-set-centre-disc-seed-0" },
      { group: "yours" as const, automaton: null },
    ]) {
      expect(readAddress(new URLSearchParams(addressSearch(address)))).toEqual(address);
    }
    expect(addressSearch({ group: null, automaton: null })).toBe("");
    expect(groupPath(7178)).toBe("/automata?group=7178");
    expect(groupPath(7178, "a-b")).toBe("/automata?group=7178&material=a-b");
  });

  test("a link from before the groups had screens names only the automaton, and the page finds its group", () => {
    const address = readAddress(new URLSearchParams("?material=block-12002-figure-strongest-seed-1"));
    expect(address).toEqual({ group: null, automaton: "block-12002-figure-strongest-seed-1" });
    const groups = arrangeGroups([
      automaton("block-12002-figure-strongest-seed-1", "noise", "basis-group-mean", { group: 12002 }),
      automaton("other", "noise", "basis-group-mean", { group: 729 }),
    ]);
    expect(groupOfAutomaton(groups, address.automaton!)?.group).toBe(12002);
    expect(groupOfAutomaton(groups, "purged")).toBeNull();
  });

  test("a group that is not a number is the wall", () => {
    expect(readAddress(new URLSearchParams("?group=abc")).group).toBeNull();
    expect(readAddress(new URLSearchParams("?group=123456")).group).toBeNull();
  });
});
