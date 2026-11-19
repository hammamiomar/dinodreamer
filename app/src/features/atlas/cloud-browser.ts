import type { AtlasIndexEntry } from "../../library/atlas-cloud";

/** A block's published materials (material-index.ts materialCounts). */
export interface MaterialCount { total: number; fired: number }

export const CLOUD_PAGE_SIZE = 24;
export const CLOUD_ORDERS = ["block", "reach", "ring", "pole"] as const;

/**
 * The response categories, as the provenance table stores them,
 * in display order. A block with fewer than 100 sample tokens has none. The
 * query key is `family` with these words, as in the old Provenance links (?sort=context&family=surround).
 */
export const CLOUD_CATEGORIES = ["local", "neighbourhood", "surround", "global", "position"] as const;
export type CloudCategory = (typeof CLOUD_CATEGORIES)[number];

/** A stored category word as Explore's filter, or null (every block) for any other value. */
export function parseCategory(value: string | null): CloudCategory | null {
  return CLOUD_CATEGORIES.find((category) => category === value) ?? null;
}

/**
 * Index controls: block number, order, response category, published materials and stars.
 * Unsupported query choices are ignored so older links still open.
 */
export interface CloudQuery {
  order: (typeof CLOUD_ORDERS)[number];
  /** Only blocks of this response category (the patch role's); null for every block. */
  category: CloudCategory | null;
  /** Only blocks with a published material. */
  hasMaterial: boolean;
  /** Only the blocks starred on this device. */
  starred: boolean;
  search: string;
  page: number;
}

function choice<T extends string>(
  value: string | null,
  choices: readonly T[],
): T {
  return choices.find((item) => item === value) ?? choices[0];
}

/** Earlier links named a material filter with these values; any of them meant "has a material". */
const HAS_MATERIAL = new Set(["material", "fired", "grown"]);

export function parseCloudQuery(search: URLSearchParams): CloudQuery {
  const page = Number(search.get("page"));
  const sort = search.get("sort");
  return {
    order: choice(sort, CLOUD_ORDERS),
    category: parseCategory(search.get("family")),
    hasMaterial: HAS_MATERIAL.has(search.get("material") ?? ""),
    // sort=starred is the oldest form of the starred collection.
    starred: search.get("collection") === "starred" || sort === "starred",
    search: (search.get("block") ?? "").replace(/\D/g, "").slice(0, 5),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

export function cloudSearch(query: CloudQuery, engine?: string | null): string {
  const search = new URLSearchParams({ sort: query.order });
  if (query.category) search.set("family", query.category);
  if (query.hasMaterial) search.set("material", "material");
  if (query.starred) search.set("collection", "starred");
  if (query.search) search.set("block", query.search);
  search.set("page", String(query.page));
  if (engine === "fake") search.set("engine", engine);
  return `?${search}`;
}

/**
 * All ordering and filter policy lives here; no card read is needed. `categories` holds each
 * block's response category in the patch role; a block without one is absent from it.
 */
export function visibleClouds(
  entries: readonly AtlasIndexEntry[],
  query: Omit<CloudQuery, "page">,
  materials: ReadonlyMap<number, MaterialCount>,
  starred: ReadonlySet<number>,
  categories: ReadonlyMap<number, string>,
): AtlasIndexEntry[] {
  const selected = entries.filter((entry) => {
    if (query.search && !String(entry.block).startsWith(query.search)) return false;
    if (query.category && categories.get(entry.block) !== query.category) return false;
    if (query.hasMaterial && !materials.has(entry.block)) return false;
    if (query.starred && !starred.has(entry.block)) return false;
    return true;
  });
  const measure = (entry: AtlasIndexEntry) => {
    if (query.order === "reach") return entry.reach;
    if (query.order === "ring") return entry.nearRing;
    if (query.order === "pole") return entry.pole;
    return 0;
  };
  return selected.sort((a, b) => measure(b) - measure(a) || a.block - b.block);
}

/**
 * Random's page: one of the `pages` pages of the current choices, chosen by `random` in [0, 1),
 * never `current`, so each press shows other blocks. Every other page is equally likely.
 * With one page there is no other page to open: null.
 */
export function randomCloudPage(pages: number, current: number, random: number): number | null {
  if (pages < 2) return null;
  // Draw one of the other pages as 1 … pages − 1, then step over the current page.
  const drawn = 1 + Math.min(pages - 2, Math.floor(random * (pages - 1)));
  return drawn >= current ? drawn + 1 : drawn;
}

/** A fresh Index visit starts at a uniformly chosen page. Explicit choices keep their address. */
export function initialCloudSearch(search: URLSearchParams, entries: number, random: number): string | null {
  const choices = ["sort", "page", "family", "material", "collection", "block", "role", "view", "colour", "shape", "bands"];
  if (choices.some((key) => search.has(key))) return null;
  const pages = Math.max(1, Math.ceil(entries / CLOUD_PAGE_SIZE));
  const query = { ...parseCloudQuery(search), page: 1 + Math.floor(random * pages) };
  // Preserve unrelated parameters, including the development engine selection.
  const address = new URLSearchParams(search);
  for (const [key, value] of new URLSearchParams(cloudSearch(query))) address.set(key, value);
  return `?${address}`;
}
