import { describe, expect, it } from "vitest";
import { MAP_PATCHES, mapCells, neededPatches, readPatchIndices, selectedCount } from "./selection-cells";

describe("the selection map", () => {
  it("reads every patch for a noise start and the central 4 × 4 for a central start", () => {
    expect(readPatchIndices(undefined)).toHaveLength(64);
    const centre = readPatchIndices("centre-4x4");
    expect(centre).toEqual([18, 19, 20, 21, 26, 27, 28, 29, 34, 35, 36, 37, 42, 43, 44, 45]);
  });

  it("needs 58 of 64 patches and 15 of 16, the selection target rounded up", () => {
    expect([neededPatches(64), neededPatches(16)]).toEqual([58, 15]);
  });

  it("lights the selected read patches, leaves the others off and the unread ones faint", () => {
    const selected = new Uint8Array(MAP_PATCHES);
    selected[0] = 1;
    selected[27] = 1;
    const cells = mapCells(selected, "centre-4x4");
    expect([cells[0], cells[27], cells[28]]).toEqual(["unread", "on", "off"]);
    expect(cells.filter((cell) => cell === "unread")).toHaveLength(48);
    expect(selectedCount(selected, "centre-4x4")).toBe(1);
    expect(selectedCount(selected, undefined)).toBe(2);
    expect(mapCells(null, undefined).every((cell) => cell === "off")).toBe(true);
  });
});
