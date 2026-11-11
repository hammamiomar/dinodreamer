import { describe, expect, test } from "vitest";
import { experimentalPage, fitsTheWindow } from "./frame";

describe("the Experimental link", () => {
  test("marks the Painter's page and the Painter with its panels, and nothing else", () => {
    for (const path of ["/canvas", "/create", "/create/basis/7125"]) expect(experimentalPage(path)).toBe(true);
    for (const path of ["/", "/index", "/basis/7125", "/automata", "/train", "/how", "/gallery", "/created"]) expect(experimentalPage(path)).toBe(false);
  });
});

describe("the frame's two page rules", () => {
  test("the screens that fit the window have no footer, with a basis group's panel over them too: the Canvas, the owner's Automata view, Train, and How it works", () => {
    for (const path of ["/create", "/create/basis/12002", "/admin/materials", "/train", "/train/basis/12002", "/how", "/how/basis/4009"]) {
      expect(fitsTheWindow(path)).toBe(true);
    }
    for (const path of ["/", "/index", "/basis/12002", "/growth", "/howl"]) expect(fitsTheWindow(path)).toBe(false);
  });

  test("Automata fits the window with a basis group open, and its wall of groups scrolls to the footer", () => {
    expect(fitsTheWindow("/automata", "?group=7178")).toBe(true);
    expect(fitsTheWindow("/automata/basis/7178", "?group=7178&material=a")).toBe(true);
    expect(fitsTheWindow("/automata", "?material=block-12002-figure-strongest-seed-1")).toBe(true);
    expect(fitsTheWindow("/automata", "?group=yours")).toBe(true);
    expect(fitsTheWindow("/automata", "")).toBe(false);
    expect(fitsTheWindow("/automata/basis/7178", "")).toBe(false);
  });
});
