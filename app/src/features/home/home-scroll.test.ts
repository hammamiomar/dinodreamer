import { describe, expect, test } from "vitest";
import { frameAt, layerAt, levelsArrived, NARROW_PANEL_SHARE, readingLine, sectionAt } from "./home-scroll";

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
