import { describe, expect, test } from "vitest";
import { FIGURE_LAYOUT, FIGURE_PYRAMID_LAYOUT, type FigureMaterial } from "../../materials/material-file";
import type { FigureReplayState } from "../../replay/figure-replay";
import type { MaterialEntry } from "../gallery/material-index";
import { cellsForGrids, entranceAutomaton, gridsOf, pictureSpread, startsAgain } from "./home-relay";

const CHANNELS = 16;

/** A grid of `side` cells whose value at (x, y, channel) is `value(x, y, channel)`. */
function grid(side: number, value: (x: number, y: number, channel: number) => number): Float32Array {
  const cells_NC = new Float32Array(side * side * CHANNELS);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      for (let channel = 0; channel < CHANNELS; channel++) cells_NC[(y * side + x) * CHANNELS + channel] = value(x, y, channel);
    }
  }
  return cells_NC;
}

const at = (cells_NC: Float32Array, side: number, x: number, y: number, channel: number) => cells_NC[(y * side + x) * CHANNELS + channel];

describe("the cells a relay hands on", () => {
  test("names the grids by the entry's side and layout", () => {
    expect(gridsOf({ side: 128, layout: FIGURE_LAYOUT })).toEqual({ side: 128, coarse: false });
    expect(gridsOf({ side: 128, layout: FIGURE_PYRAMID_LAYOUT })).toEqual({ side: 128, coarse: true });
  });

  test("are the same cells when the grids fit", () => {
    const cells: FigureReplayState = { tick: 600, fine: grid(8, (x) => x), coarse: grid(4, () => 1) };
    expect(cellsForGrids(cells, { side: 8, coarse: true }, { side: 8, coarse: true })).toBe(cells);
  });

  test("give a two-grid rule a coarse grid of 2 × 2 means, its colour taken out of the fine, so the picture stays", () => {
    const fine = grid(8, (x, y, channel) => x + 10 * y + 100 * channel);
    const handed = cellsForGrids({ tick: 7, fine }, { side: 8, coarse: false }, { side: 8, coarse: true })!;
    expect(handed.tick).toBe(7);
    // Coarse cell (1, 2) covers fine cells x 2–3, y 4–5: their mean, hidden values too.
    expect(at(handed.coarse!, 4, 1, 2, 0)).toBeCloseTo(2.5 + 45);
    expect(at(handed.coarse!, 4, 1, 2, 9)).toBeCloseTo(2.5 + 45 + 900);
    // The fine grid keeps its hidden values; its colour plus the coarse colour upsampled is the old colour.
    expect(at(handed.fine, 8, 3, 5, 9)).toBe(3 + 50 + 900);
    const back = cellsForGrids(handed, { side: 8, coarse: true }, { side: 8, coarse: false })!;
    for (let index = 0; index < fine.length; index++) expect(back.fine[index]).toBeCloseTo(fine[index]!, 4);
  });

  test("fold the coarse colour into the fine for a one-grid rule, as the two-grid picture adds it", () => {
    // A coarse grid with colour 1 in every cell adds 1 to each fine colour; its hidden values are not colour.
    const fine = grid(8, (x, _y, channel) => (channel < 3 ? 0.1 * x : 5));
    const coarse = grid(4, (_x, _y, channel) => (channel < 3 ? 1 : 9));
    const handed = cellsForGrids({ tick: 3, fine, coarse }, { side: 8, coarse: true }, { side: 8, coarse: false })!;
    expect(handed.coarse).toBeUndefined();
    expect(at(handed.fine, 8, 2, 5, 0)).toBeCloseTo(1.2);
    expect(at(handed.fine, 8, 2, 5, 3)).toBe(5);
    // One coarse cell lit: the fine cells over it take 0.75² of it, and its neighbours less, wrapped on the torus.
    const lit = grid(4, (x, y, channel) => (x === 0 && y === 0 && channel === 0 ? 1 : 0));
    const spread = cellsForGrids({ tick: 0, fine: grid(8, () => 0), coarse: lit }, { side: 8, coarse: true }, { side: 8, coarse: false })!;
    expect(at(spread.fine, 8, 0, 0, 0)).toBeCloseTo(0.5625);
    expect(at(spread.fine, 8, 1, 1, 0)).toBeCloseTo(0.5625);
    expect(at(spread.fine, 8, 2, 0, 0)).toBeCloseTo(0.1875);
    expect(at(spread.fine, 8, 7, 7, 0)).toBeCloseTo(0.0625);
    expect(at(spread.fine, 8, 4, 4, 0)).toBe(0);
  });

  test("double a grid at 2 px per cell bilinearly on the torus, every value, and halve by the mean of 2 × 2", () => {
    const small = grid(4, (x, y, channel) => x + 4 * y + channel);
    const doubled = cellsForGrids({ tick: 1, fine: small }, { side: 4, coarse: false }, { side: 8, coarse: false })!;
    expect(doubled.fine.length).toBe(8 * 8 * CHANNELS);
    // Fine cell 3 reads small cells 1 and 2 by 0.75 and 0.25 on each axis, so it sits at 1.25; fine
    // cell 0 reads cells 3 (wrapped) and 0 by 0.25 and 0.75, so it sits at 0.75. Every value is resampled.
    expect(at(doubled.fine, 8, 3, 3, 5)).toBeCloseTo(1.25 + 4 * 1.25 + 5);
    expect(at(doubled.fine, 8, 0, 0, 0)).toBeCloseTo(0.75 + 4 * 0.75);
    // Down by two, a constant stays constant and each cell is the mean of the 2 × 2 it covers.
    const flat = cellsForGrids({ tick: 1, fine: grid(8, () => 2) }, { side: 8, coarse: false }, { side: 4, coarse: false })!;
    expect(flat.fine).toEqual(grid(4, () => 2));
    const halved = cellsForGrids({ tick: 1, fine: grid(8, (x, y) => (x >> 1) + 4 * (y >> 1)) }, { side: 8, coarse: false }, { side: 4, coarse: false })!;
    expect(at(halved.fine, 4, 3, 2, 9)).toBe(11);
  });

  test("move between a two-grid rule and a smaller one-grid rule through the fold", () => {
    const coarse = grid(4, (_x, _y, channel) => (channel < 3 ? 0.5 : 0));
    const handed = cellsForGrids({ tick: 0, fine: grid(8, () => 0), coarse }, { side: 8, coarse: true }, { side: 4, coarse: false })!;
    expect(handed.coarse).toBeUndefined();
    expect(at(handed.fine, 4, 1, 1, 0)).toBeCloseTo(0.5);
    const back = cellsForGrids(handed, { side: 4, coarse: false }, { side: 8, coarse: true })!;
    expect(back.fine.length).toBe(8 * 8 * CHANNELS);
    expect(back.coarse?.length).toBe(4 * 4 * CHANNELS);
    expect(at(back.coarse!, 4, 2, 3, 0)).toBeCloseTo(0.5);
  });

  test("hand on nothing between sides that differ by another factor", () => {
    expect(cellsForGrids({ tick: 0, fine: grid(16, () => 0) }, { side: 16, coarse: false }, { side: 4, coarse: false })).toBeNull();
  });
});

describe("a rule that cannot grow from the cells", () => {
  const picture = (colour: (pixel: number) => number) => Uint8ClampedArray.from({ length: 64 * 4 }, (_, index) => (index % 4 === 3 ? 255 : colour(index >> 2)));

  test("leaves a flat picture: no spread in one colour, about 0.5 in black and white halves", () => {
    expect(pictureSpread(picture(() => 128))).toBeCloseTo(0, 6);
    expect(pictureSpread(picture((pixel) => (pixel < 32 ? 0 : 255)))).toBeCloseTo(0.5);
  });

  test("starts again from its own start after two flat checks in a row, not one", () => {
    expect(startsAgain(null, 0)).toBe(false);
    expect(startsAgain(0.3, 0.005)).toBe(false);
    expect(startsAgain(0.005, 0.3)).toBe(false);
    expect(startsAgain(0.0099, 0.0078)).toBe(true);
    expect(startsAgain(0, 0)).toBe(true);
  });

  test("leaves a faint field to grow: above the bound, or below it with a rising spread", () => {
    // Measured after two turns that regrow (2026-11-18): 13364 seeded to 12002 coarse + fine bottoms
    // at 0.0123; to 2632 coarse + fine it rises from 0.0058.
    expect(startsAgain(0.0123, 0.0123)).toBe(false);
    expect(startsAgain(0.0058, 0.0098)).toBe(false);
  });
});

describe("the automaton the entrance runs", () => {
  const shown = { id: "block-1-shown" } as MaterialEntry;
  const chosen = { id: "block-2-chosen" } as MaterialEntry;
  const file = {} as FigureMaterial;
  const running = { entry: shown, material: file };

  test("is the choice once its file is ready", () => {
    const next = {} as FigureMaterial;
    expect(entranceAutomaton(chosen, { status: "ready", value: next }, running)).toEqual({ entry: chosen, material: next });
  });

  test("stays the running automaton while the choice's file loads, so its cells can go to the choice", () => {
    expect(entranceAutomaton(chosen, { status: "loading" }, running)).toBe(running);
  });

  test("is the choice's poster with no file to run: none loaded yet, a still, a failed read", () => {
    expect(entranceAutomaton(chosen, { status: "loading" }, null)).toEqual({ entry: chosen, material: null });
    expect(entranceAutomaton(chosen, { status: "absent" }, running)).toEqual({ entry: chosen, material: null });
    expect(entranceAutomaton(chosen, { status: "failed", message: "404" }, running)).toEqual({ entry: chosen, material: null });
    expect(entranceAutomaton(null, { status: "absent" }, running)).toBeNull();
  });
});
