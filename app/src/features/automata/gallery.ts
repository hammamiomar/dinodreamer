// The Automata page's arrangement (automata-page.tsx). Every automaton is filed under its basis group,
// and within the group by the three things that decide what it looks like: where it starts, what its
// training asked for, and the luck of its training. The first two are the rows and the columns of the
// group's grid (gallery-place.ts). The third is inside a cell: the automata that share a place are its
// tries, in one order, and the first is the picture the cell shows. A cell never shows a column of them.
//
// The public page arranges the published automata; the owner's view arranges every research run as
// well, with the ones a visitor does not see marked (`shown`). The rules are the same for both, and
// this module has no browser or React imports, so they are tested without a page.

import { GALLERY_METHODS, GALLERY_STARTS, samePlace, type GalleryMethod, type GalleryPlace, type GalleryStart } from "../gallery/gallery-place";

/** The grids an automaton has, Train's first choice: one fine grid, or a coarse grid under it. */
export type GalleryGrids = "fine" | "coarse-fine";

/** One automaton as the page arranges it. A page adds what its stage needs to play it. */
export interface GalleryAutomaton {
  /** Its id in the address: a published entry's id, or in the owner's view a research run's. */
  id: string;
  group: number;
  place: GalleryPlace;
  grids: GalleryGrids;
  /** A still of it, grown: a published automaton's poster, or a research run's last still. */
  pictureUrl: string;
  /** Whether a visitor sees it. The public page holds shown automata only. */
  shown: boolean;
  /** The owner's mark: the picture of its cell. */
  cellPicture: boolean;
  /** The owner's first featured level, set on the automaton itself: the picture of its group. */
  groupPicture: boolean;
  /** The owner's second featured level: featured for the site, so its group comes first on the wall. */
  siteFeatured: boolean;
  /** Whether its reading met the selection target. Only an order among unmarked tries: the token methods do not aim at it. */
  metTarget: boolean;
  /** When it was published or trained, as an ISO date; "" when unknown. Newer tries come first. */
  madeAt: string;
}

/** The automata that share one place of a group's grid, in the order of triesInOrder. */
export interface GalleryCell<T extends GalleryAutomaton> {
  place: GalleryPlace;
  tries: T[];
}

export interface GalleryGroup<T extends GalleryAutomaton> {
  group: number;
  automata: T[];
  /** The grid's rows and columns (axesOf). */
  starts: GalleryStart[];
  methods: GalleryMethod[];
  /** The cells that hold an automaton, row by row. */
  cells: GalleryCell<T>[];
}

/**
 * The starts and the methods every group's grid has, whether the group holds an automaton there or
 * not: a reader learns one grid, and an empty cell says that nothing was grown that way. The research
 * grew these for most groups. A start or a method outside them is rare, so it takes a row or a
 * column only in a group that has it.
 */
export const COMMON_STARTS: readonly GalleryStart[] = ["noise", "circle", "circle-on-noise"];
export const COMMON_METHODS: readonly GalleryMethod[] = [
  "basis-group-mean",
  "basis-group-mean-guided",
  "basis-group-distribution",
  "token-distribution",
];

/** The space a method compares in: the basis group's three numbers, DINO's whole token, or neither (a research variant). */
export type MethodSpace = "basis-group" | "token" | "other";

export function methodSpace(method: GalleryMethod): MethodSpace {
  if (method === "basis-group-mean" || method === "basis-group-mean-guided" || method === "basis-group-distribution") return "basis-group";
  if (method === "token-mean" || method === "token-distribution") return "token";
  return "other";
}

/** A grid's columns under their bands: the methods of one space side by side, in the grid's order. */
export function methodBands(methods: readonly GalleryMethod[]): { space: MethodSpace; methods: GalleryMethod[] }[] {
  const bands: { space: MethodSpace; methods: GalleryMethod[] }[] = [];
  for (const method of methods) {
    const space = methodSpace(method);
    const last = bands.at(-1);
    if (last !== undefined && last.space === space) last.methods.push(method);
    else bands.push({ space, methods: [method] });
  }
  return bands;
}

/** The rows and columns of a group's grid: the common ones, and any other its automata have, in the gallery's order. */
export function axesOf(automata: readonly GalleryAutomaton[]): { starts: GalleryStart[]; methods: GalleryMethod[] } {
  const starts = new Set(automata.map((automaton) => automaton.place.start));
  const methods = new Set(automata.map((automaton) => automaton.place.method));
  return {
    starts: GALLERY_STARTS.filter((start) => COMMON_STARTS.includes(start) || starts.has(start)),
    methods: GALLERY_METHODS.filter((method) => COMMON_METHODS.includes(method) || methods.has(method)),
  };
}

/**
 * The order of a cell's tries. The one a visitor sees comes before a hidden one; then the owner's
 * picture of the cell; then the picture of the group; then one whose reading met the selection
 * target; then the newer; then by id, so the order never depends on how the index listed them.
 */
export function compareTries(a: GalleryAutomaton, b: GalleryAutomaton): number {
  return Number(b.shown) - Number(a.shown)
    || Number(b.cellPicture) - Number(a.cellPicture)
    || Number(b.groupPicture || b.siteFeatured) - Number(a.groupPicture || a.siteFeatured)
    || Number(b.metTarget) - Number(a.metTarget)
    || b.madeAt.localeCompare(a.madeAt)
    || a.id.localeCompare(b.id);
}

/** One group's automata in its grid. */
export function arrangeGroup<T extends GalleryAutomaton>(group: number, automata: readonly T[]): GalleryGroup<T> {
  const { starts, methods } = axesOf(automata);
  const cells: GalleryCell<T>[] = [];
  for (const start of starts) {
    for (const method of methods) {
      const place = { start, method };
      const tries = automata.filter((automaton) => samePlace(automaton.place, place)).sort(compareTries);
      if (tries.length > 0) cells.push({ place, tries });
    }
  }
  return { group, automata: [...automata], starts, methods, cells };
}

/** Every basis group that holds an automaton, each in its grid, in number order. */
export function arrangeGroups<T extends GalleryAutomaton>(automata: readonly T[]): GalleryGroup<T>[] {
  const byGroup = new Map<number, T[]>();
  for (const automaton of automata) {
    byGroup.set(automaton.group, [...(byGroup.get(automaton.group) ?? []), automaton]);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a - b)
    .map(([group, members]) => arrangeGroup(group, members));
}

export function cellAt<T extends GalleryAutomaton>(group: GalleryGroup<T>, place: GalleryPlace): GalleryCell<T> | null {
  return group.cells.find((cell) => samePlace(cell.place, place)) ?? null;
}

/** The picture a cell shows: its first try. */
export function pictureOfCell<T extends GalleryAutomaton>(cell: GalleryCell<T>): T {
  return cell.tries[0]!;
}

/**
 * The picture of a group, on the wall and on the stage when the address names no automaton: the
 * shown automaton the owner made the group's picture, else one he featured for the site, else the
 * picture of its first cell. Null for a group without an automaton.
 */
export function pictureOfGroup<T extends GalleryAutomaton>(group: GalleryGroup<T>): T | null {
  const candidates = group.cells.flatMap((cell) => cell.tries).filter((automaton) => automaton.shown);
  const pool = candidates.length > 0 ? candidates : group.cells.flatMap((cell) => cell.tries);
  return pool.find((automaton) => automaton.groupPicture)
    ?? pool.find((automaton) => automaton.siteFeatured)
    ?? pool[0]
    ?? null;
}

/** Whether the owner featured the group for the site: one of its shown automata carries the site mark. */
export function siteFeatured(group: GalleryGroup<GalleryAutomaton>): boolean {
  return group.automata.some((automaton) => automaton.shown && automaton.siteFeatured);
}

/** The wall's order: the groups featured for the site first, then the others, each in number order. */
export function wallOrder<T extends GalleryAutomaton>(groups: readonly GalleryGroup<T>[]): GalleryGroup<T>[] {
  return [...groups].sort((a, b) => Number(siteFeatured(b)) - Number(siteFeatured(a)) || a.group - b.group);
}

/** The groups before and after one in the wall's order, for a group's Previous and Next; null at an end. */
export function neighboursOf(groups: readonly GalleryGroup<GalleryAutomaton>[], group: number): { previous: number | null; next: number | null } {
  const ordered = wallOrder(groups).map((each) => each.group);
  const at = ordered.indexOf(group);
  return { previous: ordered[at - 1] ?? null, next: at < 0 ? null : ordered[at + 1] ?? null };
}

/** How many of a group's automata a visitor sees. */
export function shownCount(automata: readonly GalleryAutomaton[]): number {
  return automata.filter((automaton) => automaton.shown).length;
}

/**
 * The automaton a group's screen plays: the one the address names when the group holds it, else the
 * group's picture. With its cell, so the grid can mark the place.
 */
export function automatonToPlay<T extends GalleryAutomaton>(group: GalleryGroup<T>, id: string | null):
  { automaton: T; cell: GalleryCell<T> } | null {
  const named = id === null ? undefined : group.automata.find((automaton) => automaton.id === id);
  const automaton = named ?? pictureOfGroup(group);
  if (automaton === null) return null;
  return { automaton, cell: cellAt(group, automaton.place)! };
}

/** The try `steps` places after this one in its cell (negative: before), held to the cell's ends. */
export function tryAfter<T extends GalleryAutomaton>(cell: GalleryCell<T>, id: string, steps: number): T {
  const at = cell.tries.findIndex((automaton) => automaton.id === id);
  const next = Math.min(cell.tries.length - 1, Math.max(0, (at < 0 ? 0 : at) + steps));
  return cell.tries[next]!;
}

/**
 * The cell one step from `place` along the grid, for the arrow keys: the next cell that holds an
 * automaton in that direction, in the same row or column; the same place when there is none.
 */
export function cellBeside<T extends GalleryAutomaton>(
  group: GalleryGroup<T>,
  place: GalleryPlace,
  direction: "left" | "right" | "up" | "down",
): GalleryCell<T> {
  const row = group.starts.indexOf(place.start);
  const column = group.methods.indexOf(place.method);
  const step = direction === "left" || direction === "up" ? -1 : 1;
  const along = direction === "left" || direction === "right" ? group.methods.length : group.starts.length;
  for (let at = (direction === "left" || direction === "right" ? column : row) + step; at >= 0 && at < along; at += step) {
    const candidate = direction === "left" || direction === "right"
      ? { start: place.start, method: group.methods[at]! }
      : { start: group.starts[at]!, method: place.method };
    const cell = cellAt(group, candidate);
    if (cell !== null) return cell;
  }
  return cellAt(group, place)!;
}

// The address. `/automata` is the wall; `?group=<n>` is a basis group's screen; `&material=<id>` names
// the automaton on its stage. A link from before the groups had screens names only the automaton, and
// the page finds its group (groupOfAutomaton). `?group=yours` is the visitor's saved automata, as before.

export const SAVED_GROUP = "yours";

export interface GalleryAddress {
  /** A basis group's number, the saved automata, or null for the wall. */
  group: number | typeof SAVED_GROUP | null;
  /** The automaton the address names, or null. */
  automaton: string | null;
}

export function readAddress(search: URLSearchParams): GalleryAddress {
  const group = search.get("group");
  const automaton = search.get("material");
  if (group === SAVED_GROUP) return { group: SAVED_GROUP, automaton };
  const number = group !== null && /^\d{1,5}$/.test(group) ? Number(group) : null;
  return { group: number, automaton };
}

/** Whether the address opens a screen with a stage: a basis group, an automaton, or the saved automata. The wall has none. */
export function opensGroup(search: URLSearchParams): boolean {
  const address = readAddress(search);
  return address.group !== null || address.automaton !== null;
}

/** The address as a search string: "?group=7178&material=…", "?group=7178", or "" for the wall. */
export function addressSearch(address: GalleryAddress): string {
  const search = new URLSearchParams();
  if (address.group !== null) search.set("group", String(address.group));
  if (address.automaton !== null) search.set("material", address.automaton);
  const query = search.toString();
  return query === "" ? "" : `?${query}`;
}

/** The Automata page with a basis group open, the link the essay, the home and the wall share. */
export function groupPath(group: number, automaton: string | null = null): string {
  return `/automata${addressSearch({ group, automaton })}`;
}

/** The group that holds the automaton an address names, for a link that names no group; null when none does. */
export function groupOfAutomaton<T extends GalleryAutomaton>(groups: readonly GalleryGroup<T>[], id: string): GalleryGroup<T> | null {
  return groups.find((group) => group.automata.some((automaton) => automaton.id === id)) ?? null;
}
