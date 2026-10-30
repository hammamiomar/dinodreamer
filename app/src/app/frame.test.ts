import { describe, expect, test } from "vitest";
import { experimentalPage, fitsTheWindow } from "./frame";

describe("the Experimental link", () => {
  test("marks the Painter's page and the Painter with its panels, and nothing else", () => {
    for (const path of ["/canvas", "/create", "/create/basis/7125"]) expect(experimentalPage(path)).toBe(true);
    for (const path of ["/", "/index", "/basis/7125", "/automata", "/train", "/how", "/gallery", "/created"]) expect(experimentalPage(path)).toBe(false);
  });
});

describe("the frame's two page rules", () => {
  test("the screens that fit the window have no footer, with a basis group's panel over them too: the Canvas, the Playground and its owner mode, Train, and How it works", () => {
    for (const path of ["/create", "/create/basis/12002", "/automata", "/automata/basis/12002", "/admin/materials", "/train", "/train/basis/12002", "/how", "/how/basis/4009"]) {
      expect(fitsTheWindow(path)).toBe(true);
    }
    for (const path of ["/", "/index", "/basis/12002", "/growth", "/howl"]) expect(fitsTheWindow(path)).toBe(false);
  });
});
