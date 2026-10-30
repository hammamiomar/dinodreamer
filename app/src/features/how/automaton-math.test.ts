import { describe, expect, it } from "vitest";
import { automatonCellAtPatch, automatonPatchAtCell, automatonParameter, automatonTargetLoss, detectorPictures, gridPixels, imagePixels, largestAbsoluteCoordinate, moveAutomatonCell, stretchedCoarsePixels } from "./automaton-math";
import type { AutomatonGrid } from "./automaton-record";
import { CHANNELS } from "./nca-math";

/** A grid whose every cell has the same colour `value` in its three colour channels and zeros elsewhere. */
function flatGrid(side: number, value: number): AutomatonGrid {
  const state = new Float32Array(side * side * CHANNELS);
  for (let cell = 0; cell < side * side; cell++) state.set([value, value, value], cell * CHANNELS);
  return { side, tick: 600, seed: 1, state };
}

describe("the stacked grids' pixels", () => {
  it("stretch a flat coarse grid to a flat layer, and add it to the fine grid for the image", () => {
    const coarse = flatGrid(2, 0.1);
    const fine = flatGrid(4, 0.2);
    expect(Array.from(gridPixels(coarse).slice(0, 4))).toEqual([153, 153, 153, 255]);
    const stretched = stretchedCoarsePixels(coarse, 4);
    expect(stretched.length).toBe(4 * 4 * 4);
    expect(new Set(stretched)).toEqual(new Set([153, 255]));
    const image = imagePixels(fine, coarse);
    expect(new Set(image)).toEqual(new Set([204, 255]));
    expect(() => stretchedCoarsePixels(coarse, 8)).toThrow();
  });
});

describe("automaton inspection calculations", () => {
  it("averages distances after taking each view mean, not the distance of all views combined", () => {
    expect(automatonTargetLoss([[2, 0, 0], [-2, 0, 0]], [0, 0, 0], 2)).toBe(1);
    expect(automatonTargetLoss([[1, 2, 3]], [1, 2, 3], 5)).toBe(0);
  });
  it("locates the three stored parameter arrays at their boundaries", () => {
    expect(automatonParameter(6143)).toEqual({ matrix: "W1", coordinate: "96, 64" });
    expect(automatonParameter(6144)).toEqual({ matrix: "b", coordinate: "1" });
    expect(automatonParameter(6239)).toEqual({ matrix: "b", coordinate: "96" });
    expect(automatonParameter(6240)).toEqual({ matrix: "W2", coordinate: "1, 1" });
    expect(automatonParameter(7775)).toEqual({ matrix: "W2", coordinate: "16, 96" });
    expect(largestAbsoluteCoordinate([1, -8, 5])).toBe(1);
  });
  it("keeps comparison queries and local cell regions on the same picture location", () => {
    for (let patch = 0; patch < 256; patch++) expect(automatonPatchAtCell(automatonCellAtPatch(patch, 128), 128)).toBe(patch);
    expect(automatonCellAtPatch(17, 128)).toBe(12 * 128 + 12);
    expect(automatonPatchAtCell(16383, 128)).toBe(255);
  });
  it("keeps keyboard inspection within the state grid", () => {
    expect(moveAutomatonCell(0, 128, "ArrowLeft")).toBe(0);
    expect(moveAutomatonCell(128, 128, "ArrowUp")).toBe(0);
    expect(moveAutomatonCell(0, 128, "End")).toBe(16383);
    expect(moveAutomatonCell(16383, 128, "ArrowDown")).toBe(16383);
  });
});

describe("the grid through the detectors", () => {
  it("shows the value as the grid itself and a flat grid as mid-grey through every change detector", () => {
    const grid = flatGrid(4, 0.25);
    const [value, leftRight, topBottom, average] = detectorPictures(grid);
    expect(value).toEqual(gridPixels(grid));
    for (const picture of [leftRight, topBottom, average]) {
      expect(picture!.length).toBe(4 * 4 * 4);
      expect(Array.from(picture!).every((byte, at) => byte === (at % 4 === 3 ? 255 : 128))).toBe(true);
    }
  });

  it("sees a vertical edge left to right only, and the edge as the picture's largest value", () => {
    const side = 4;
    const state = new Float32Array(side * side * CHANNELS);
    // The right half brighter than the left, in every colour channel.
    for (let cell = 0; cell < side * side; cell++) if (cell % side >= 2) state.set([0.4, 0.4, 0.4], cell * CHANNELS);
    const grid: AutomatonGrid = { side, tick: 600, seed: 1, state };
    const [, leftRight, topBottom] = detectorPictures(grid);
    // The torus wraps, so the edge at column 2 (bright to the right) and the edge at column 0 (bright to the left) are full white and full black.
    expect(leftRight![(0 * side + 1) * 4]).toBe(255);
    expect(leftRight![(0 * side + 3) * 4]).toBe(0);
    expect(Array.from(topBottom!).every((byte, at) => byte === (at % 4 === 3 ? 255 : 128))).toBe(true);
  });
});
