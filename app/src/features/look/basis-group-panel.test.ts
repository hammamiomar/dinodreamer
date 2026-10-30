import { describe, expect, it } from "vitest";
import { addressedBlock, basisGroupPath, panelHome } from "./basis-group-panel";

describe("every block view is a panel (basis-group-panel.tsx)", () => {
  it("opens over the page it is opened from, keeping that page's address", () => {
    expect(basisGroupPath("/index", "?order=strength&page=3", 12002)).toBe("/index/basis/12002?order=strength&page=3");
    expect(basisGroupPath("/automata", "?material=abc", 12002)).toBe("/automata/basis/12002?material=abc");
    expect(basisGroupPath("/train", "?block=12002", 9759)).toBe("/train/basis/9759?block=12002");
    expect(basisGroupPath("/picture", "", 9759)).toBe("/picture/basis/9759");
    expect(basisGroupPath("/how", "", 13852)).toBe("/how/basis/13852");
    expect(basisGroupPath("/train/basis/9759", "?block=12002", 13852)).toBe("/train/basis/13852?block=12002");
  });

  it("opens over the Index from a page without panels", () => {
    expect(panelHome("/gallery")).toBeNull();
    expect(basisGroupPath("/gallery", "", 12002)).toBe("/basis/12002");
    expect(basisGroupPath("/", "?engine=fake", 12002)).toBe("/basis/12002?engine=fake");
  });

  it("names a basis group only by a whole number under 16,384", () => {
    expect(addressedBlock("12002")).toBe(12002);
    expect(addressedBlock("0")).toBe(0);
    for (const id of [undefined, "16384", "-1", "12.5", "abc", ""]) expect(addressedBlock(id)).toBeNull();
  });
});
