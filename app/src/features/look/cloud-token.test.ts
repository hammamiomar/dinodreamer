import { describe, expect, test } from "vitest";
import { anchorToken } from "./cloud-token";

const strength = { ring: 5, cuts: [8, 11, 14] as [number, number, number], maximum: 17 };

describe("an automaton's reference patch as a cloud point", () => {
  test("a library patch keeps its picture, its place and its response vector", () => {
    expect(anchorToken({ source: "library", imageId: 42, slot: 141, code: [1, 2, 3], norm: 12, band: "strongly", strength }))
      .toEqual({ source: "library", imageId: 42, slot: 141, code: [1, 2, 3], norm: 12, publicPreview: true });
    expect(anchorToken({ source: "library", imageId: 42, slot: 141, code: [1, 2, 3], norm: 12, band: "strongly", strength, publicPreview: false }))
      .toEqual({ source: "library", imageId: 42, slot: 141, code: [1, 2, 3], norm: 12, publicPreview: false });
  });

  test("a patch of the person's own picture has no picture to show", () => {
    expect(anchorToken({ source: "upload", slot: 20, code: [0, 1, 0], norm: 9, band: "weakly", strength }))
      .toEqual({ source: "upload", slot: 20, code: [0, 1, 0], norm: 9 });
  });
});
