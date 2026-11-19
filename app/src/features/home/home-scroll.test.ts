import { describe, expect, test } from "vitest";
import { approachedBeats, frameAt, layerAt, levelsArrived, NARROW_PANEL_SHARE, readingLine, sectionAt } from "./home-scroll";

// Five sections on a 900 px window, one window each.
const tops = [0, 900, 1800, 2700, 3600];

describe("the reading line", () => {
  test("is the middle of the window, or of the part under the panel on a narrow one", () => {
    expect(readingLine(900, 0)).toBe(450);
    expect(readingLine(844, NARROW_PANEL_SHARE)).toBeCloseTo(675.2, 6);
  });
});

describe("the section the window is on", () => {
  test("is the one whose top the reading line has passed", () => {
    expect(sectionAt(tops, 0, 450)).toBe(0);
    expect(sectionAt(tops, 449, 450)).toBe(0);
    expect(sectionAt(tops, 450, 450)).toBe(1);
    expect(sectionAt(tops, 2700 - 450, 450)).toBe(3);
    expect(sectionAt(tops, 9000, 450)).toBe(4);
  });
});

describe("the beats whose files load", () => {
  test("only the entrance before the first scroll, even at a far section reached by a restored position", () => {
    expect(approachedBeats(0, false)).toEqual({ entrance: true, model: false, basis: false, automaton: false, end: false });
    expect(approachedBeats(3, false).end).toBe(false);
  });
  test("each beat while the reader is one section before it", () => {
    expect(approachedBeats(0, true)).toEqual({ entrance: true, model: true, basis: false, automaton: false, end: false });
    expect(approachedBeats(2, true)).toEqual({ entrance: true, model: true, basis: true, automaton: true, end: false });
    expect(approachedBeats(3, true).end).toBe(true);
    expect(approachedBeats(4, true).end).toBe(true);
  });
});

describe("what a playing figure shows", () => {
  test("the frame, the layer and the levels step evenly over the play", () => {
    expect(frameAt(0, 16)).toBe(0);
    expect(frameAt(0.5, 16)).toBe(8);
    expect(frameAt(1, 16)).toBe(15);
    expect(frameAt(1.2, 16)).toBe(15);
    expect(layerAt(0)).toBe(1);
    expect(layerAt(0.5)).toBe(7);
    expect(layerAt(1)).toBe(12);
    expect(levelsArrived(0)).toBe(0);
    expect(levelsArrived(0.5)).toBe(3);
    expect(levelsArrived(1)).toBe(5);
  });
});
