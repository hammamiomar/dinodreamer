import { describe, expect, it, vi } from "vitest";
import { CELLS } from "../../recipe";
import { deliverStroke, drawReseedSeed, primaryErasesFor } from "./noise";
import type { Stroke } from "./model";

function stroke(mode: Stroke["mode"], ...cells: number[]): Stroke {
  const painted = new Array<number>(CELLS).fill(0);
  for (const cell of cells) painted[cell] = 100;
  return { mode, cells: painted };
}

describe("the Noise tool's stroke", () => {
  it("goes to the worker as one re-seed with a fresh seed, never to the recipe", () => {
    const dispatch = vi.fn();
    const reseed = vi.fn();
    deliverStroke({ kind: "noise" }, stroke("paint", 3, 4), { dispatch, reseed, seed: () => 99 });
    expect(reseed).toHaveBeenCalledWith(stroke("paint", 3, 4).cells.map(Boolean), 99);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("sends nothing for an erase or an empty stroke", () => {
    const reseed = vi.fn();
    deliverStroke({ kind: "noise" }, stroke("erase", 3), { dispatch: vi.fn(), reseed });
    deliverStroke({ kind: "noise" }, stroke("paint"), { dispatch: vi.fn(), reseed });
    expect(reseed).not.toHaveBeenCalled();
  });

  it("draws a 32-bit seed", () => {
    for (let draw = 0; draw < 5; draw++) {
      const seed = drawReseedSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(2 ** 32 - 1);
    }
  });
});

describe("a painting stroke", () => {
  it("goes to the recipe as one paintSelection, for a term, Protect and the held token; the lock rule decides what it reaches", () => {
    const dispatch = vi.fn();
    const reseed = vi.fn();
    for (const selection of [{ kind: "term" as const, requestId: 2, term: "look" as const }, { kind: "protect" as const }, { kind: "held" as const }]) {
      deliverStroke(selection, stroke("paint", 1), { dispatch, reseed });
      expect(dispatch).toHaveBeenLastCalledWith({ type: "paintSelection", stroke: stroke("paint", 1) });
    }
    expect(reseed).not.toHaveBeenCalled();
  });
});

describe("the touch Erase toggle", () => {
  it("makes a finger erase an area, never Noise, whose strokes always paint", () => {
    expect(primaryErasesFor({ kind: "protect" }, true)).toBe(true);
    expect(primaryErasesFor({ kind: "term", requestId: 1, term: "look" }, true)).toBe(true);
    expect(primaryErasesFor({ kind: "noise" }, true)).toBe(false);
    expect(primaryErasesFor({ kind: "noise" }, false)).toBe(false);
    expect(primaryErasesFor(null, false)).toBe(false);
  });
});
