import { describe, expect, it } from "vitest";
import type { AtlasIndexEntry } from "../../library/atlas-cloud";
import { cloudSearch, initialCloudSearch, parseCloudQuery, randomCloudPage, visibleClouds } from "./cloud-browser";
import { ATLAS_TEXT } from "./atlas-text";

const entries: AtlasIndexEntry[] = [
  {
    block: 10,
    total: 4096,
    reach: 3,
    nearRing: 0.8,
    pole: 0,
    counts: [3600, 400, 90, 6],
  },
  {
    block: 20,
    total: 4096,
    reach: 8,
    nearRing: 0.2,
    pole: 0.03,
    counts: [3000, 800, 290, 6],
  },
  {
    block: 30,
    total: 4096,
    reach: 8,
    nearRing: 0.5,
    pole: 0.1,
    counts: [3000, 800, 290, 6],
  },
];
const defaults = parseCloudQuery(new URLSearchParams());
const materials = new Map([[20, { total: 2, fired: 1 }], [30, { total: 1, fired: 0 }]]);
const starred = new Set([10, 30]);
// Block 30 has no category: fewer than 100 sample tokens.
const categories = new Map([[10, "surround"], [20, "local"]]);
const blocks = (change: Parameters<typeof visibleClouds>[1]) =>
  visibleClouds(entries, change, materials, starred, categories).map(
    (entry) => entry.block,
  );

describe("cloud Atlas choices", () => {
  it("round-trips the order, the category, the two checks, the search and the page", () => {
    const query = { ...defaults, order: "pole", category: "surround", hasMaterial: true, starred: true, search: "12", page: 4 } as const;
    expect(parseCloudQuery(new URLSearchParams(cloudSearch(query, "fake")))).toEqual(query);
    expect(cloudSearch(query, "fake")).toContain("engine=fake");
    expect(cloudSearch(query, "fake")).toContain("family=surround");
    expect(cloudSearch(defaults)).not.toContain("family");
    expect(parseCloudQuery(new URLSearchParams("page=-1&sort=invalid"))).toMatchObject({ order: "block", page: 1 });
  });

  it("opens earlier links without the removed choices", () => {
    expect(parseCloudQuery(new URLSearchParams("view=bands&colour=family&shape=pole&bands=13&collection=in_use&sort=materials"))).toEqual(defaults);
    expect(parseCloudQuery(new URLSearchParams("material=fired")).hasMaterial).toBe(true);
    expect(parseCloudQuery(new URLSearchParams("material=grown")).hasMaterial).toBe(true);
    expect(parseCloudQuery(new URLSearchParams("material=none")).hasMaterial).toBe(false);
    expect(parseCloudQuery(new URLSearchParams("sort=starred")).starred).toBe(true);
    expect(parseCloudQuery(new URLSearchParams("collection=starred")).starred).toBe(true);
  });

  it("opens an old Provenance link on its category, and no category for any other word", () => {
    expect(parseCloudQuery(new URLSearchParams("role=patch&sort=context&family=surround&page=1"))).toEqual({ ...defaults, category: "surround" });
    expect(parseCloudQuery(new URLSearchParams("family=position")).category).toBe("position");
    expect(parseCloudQuery(new URLSearchParams("family=context")).category).toBeNull();
    expect(parseCloudQuery(new URLSearchParams("family=unknown")).category).toBeNull();
    expect(defaults.category).toBeNull();
  });

  it("chooses a default page once while preserving explicit links and filters", () => {
    expect(initialCloudSearch(new URLSearchParams(), 120, 0)).toBe("?sort=block&page=1");
    expect(initialCloudSearch(new URLSearchParams("engine=fake"), 120, 0.999)).toBe("?engine=fake&sort=block&page=5");
    expect(initialCloudSearch(new URLSearchParams(), 0, 0.5)).toBe("?sort=block&page=1");
    for (const address of ["sort=reach", "page=3", "block=7178", "family=local", "collection=starred", "material=fired"]) {
      expect(initialCloudSearch(new URLSearchParams(address), 120, 0.5)).toBeNull();
    }
  });

  it("sorts shape measures descending with stable block ties", () => {
    expect(blocks(defaults)).toEqual([10, 20, 30]);
    expect(blocks({ ...defaults, order: "reach" })).toEqual([20, 30, 10]);
    expect(blocks({ ...defaults, order: "ring" })).toEqual([10, 30, 20]);
    expect(blocks({ ...defaults, order: "pole" })).toEqual([30, 20, 10]);
    expect(blocks({ ...defaults, order: "block" })).toEqual([10, 20, 30]);
    expect(entries.map((entry) => entry.block)).toEqual([10, 20, 30]);
  });

  it("filters by material, by star and by number without card reads", () => {
    expect(blocks({ ...defaults, hasMaterial: true })).toEqual([20, 30]);
    expect(blocks({ ...defaults, starred: true })).toEqual([10, 30]);
    expect(blocks({ ...defaults, hasMaterial: true, starred: true })).toEqual([30]);
    expect(blocks({ ...defaults, starred: true, search: "2" })).toEqual([]);
    expect(blocks({ ...defaults, search: "2" })).toEqual([20]);
  });

  it("filters by response category, and a block without one is in no category", () => {
    expect(blocks({ ...defaults, category: "surround" })).toEqual([10]);
    expect(blocks({ ...defaults, category: "local" })).toEqual([20]);
    expect(blocks({ ...defaults, category: "global" })).toEqual([]);
    expect(blocks({ ...defaults, category: "local", hasMaterial: true })).toEqual([20]);
    expect(blocks({ ...defaults, category: "surround", hasMaterial: true })).toEqual([]);
    expect(blocks(defaults)).toEqual([10, 20, 30]);
  });

  it("opens a random page other than the current one, each other page equally likely", () => {
    // Five pages, the third shown: the four quarters of [0, 1) open pages 1, 2, 4 and 5.
    expect([0, 0.25, 0.5, 0.75].map((random) => randomCloudPage(5, 3, random))).toEqual([1, 2, 4, 5]);
    expect(randomCloudPage(5, 3, 0.9999)).toBe(5);
    expect(randomCloudPage(5, 1, 0)).toBe(2);
    expect(randomCloudPage(5, 5, 0.9999)).toBe(4);
    expect(randomCloudPage(2, 1, 0.3)).toBe(2);
    expect(randomCloudPage(2, 2, 0.7)).toBe(1);
    for (let random = 0; random < 1; random += 0.01) expect(randomCloudPage(683, 72, random)).not.toBe(72);
  });

  it("has no random page when the choices fill one page", () => {
    expect(randomCloudPage(1, 1, 0.5)).toBeNull();
  });

  it("keeps presentation wording free of research threshold terms and percentages", () => {
    const prose = JSON.stringify(ATLAS_TEXT);
    expect(prose).not.toMatch(/\bgate\b|\d\s*%/i);
    expect(ATLAS_TEXT.count(3031, 4096)).toBe("3,031 of 4,096 patches");
  });
});
