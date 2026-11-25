import { describe, expect, test } from "vitest";
import { approachedBeats, HOME_BEATS, readingLine, sectionAt } from "./home-scroll";

// Five sections on a 900 px window, one window each.
const tops = [0, 900, 1800, 2700, 3600];

describe("the reading line", () => {
  test("is the middle of the window, or of the part under a reserved share", () => {
    expect(readingLine(900, 0)).toBe(450);
    expect(readingLine(844, 0.5)).toBeCloseTo(633, 6);
  });
});

describe("the section the window is on", () => {
  test("is the one whose top the reading line has passed", () => {
    expect(HOME_BEATS).toEqual(["entrance", "properties", "collection", "train", "keep"]);
    expect(sectionAt(tops, 0, 450)).toBe(0);
    expect(sectionAt(tops, 449, 450)).toBe(0);
    expect(sectionAt(tops, 450, 450)).toBe(1);
    expect(sectionAt(tops, 2700 - 450, 450)).toBe(3);
    expect(sectionAt(tops, 9000, 450)).toBe(4);
  });
});

describe("the beats whose files load", () => {
  test("only the entrance before the first scroll, even at a far section reached by a restored position", () => {
    expect(approachedBeats(0, false)).toEqual({
      entrance: true,
      properties: false,
      collection: false,
      train: false,
      keep: false,
    });
    expect(approachedBeats(3, false).keep).toBe(false);
  });

  test("each beat while the reader is one section before it", () => {
    expect(approachedBeats(0, true)).toEqual({
      entrance: true,
      properties: true,
      collection: false,
      train: false,
      keep: false,
    });
    expect(approachedBeats(2, true)).toEqual({
      entrance: true,
      properties: true,
      collection: true,
      train: true,
      keep: false,
    });
    expect(approachedBeats(3, true).keep).toBe(true);
    expect(approachedBeats(4, true).keep).toBe(true);
  });
});
