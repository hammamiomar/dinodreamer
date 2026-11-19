import { describe, expect, it } from "vitest";
import { automatonCellAtPatch, detectorPictures, gridPixels, imagePixels, stretchedCoarsePixels } from "./automaton-math";
import type { AutomatonGrid } from "./automaton-record";
import { CHANNELS } from "./nca-math";

function flatGrid(side: number, value: number): AutomatonGrid {
  const state = new Float32Array(side * side * CHANNELS);
  for (let cell = 0; cell < side * side; cell++) state.set([value, value, value], cell * CHANNELS);
  return { side, tick: 600, seed: 1, state };
}

describe("the stacked grids' pixels", () => {
  it("stretches a flat coarse grid to a flat layer, and adds it to the fine grid for the image", () => {
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

describe("patch-to-cell mapping", () => {
  it("maps patch indices to the center cell of each patch in a 128-cell grid", () => {
    expect(automatonCellAtPatch(0, 128)).toBe(4 * 128 + 4);
    expect(automatonCellAtPatch(17, 128)).toBe(12 * 128 + 12);
    expect(automatonCellAtPatch(255, 128)).toBe(124 * 128 + 124);
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
    for (let cell = 0; cell < side * side; cell++) if (cell % side >= 2) state.set([0.4, 0.4, 0.4], cell * CHANNELS);
    const grid: AutomatonGrid = { side, tick: 600, seed: 1, state };
    const [, leftRight, topBottom] = detectorPictures(grid);
    expect(leftRight![(0 * side + 1) * 4]).toBe(255);
    expect(leftRight![(0 * side + 3) * 4]).toBe(0);
    expect(Array.from(topBottom!).every((byte, at) => byte === (at % 4 === 3 ? 255 : 128))).toBe(true);
  });
});
