import { expect, it } from "vitest";
import { updateWallViewport } from "./wall-viewport";

it("retains visible decks and the three that most recently left, including when a group covers the wall", () => {
  const first = { visible: new Set([1, 2, 3, 4, 5]), recent: [] };
  const second = updateWallViewport(first, new Set([4, 5, 6, 7]));
  expect(second.recent).toEqual([1, 2, 3]);
  const third = updateWallViewport(second, new Set([2, 3, 6, 7]));
  expect(third.recent).toEqual([1, 4, 5]);
  const covered = updateWallViewport(third, new Set());
  expect(covered.recent).toEqual([3, 6, 7]);
});
