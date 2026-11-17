import { describe, expect, test } from "vitest";
import {
  between, cloudPoints, distanceInMedians, mapFit, mapTarget, meanOf, patchPoints, PATCH_CODE_VALUES, PATH_READINGS, scoredMean, withMean,
} from "./live-map-points";

const codesOf = (value: (patch: number) => [number, number, number]) =>
  Float32Array.from({ length: PATCH_CODE_VALUES }, (_, at) => value(Math.floor(at / 3))[at % 3]!);

describe("the canvas's patches as points of the group's space", () => {
  test("a reading's 192 values are 64 points in patch order", () => {
    const points = patchPoints(codesOf((patch) => [patch, 2 * patch, patch + 1]));
    expect(points).toHaveLength(64);
    expect(points[0]).toEqual([0, 0, 1]);
    expect(points[9]).toEqual([9, 18, 10]);
    expect(() => patchPoints(new Float32Array(191))).toThrow("192");
  });

  test("the scored mean is over every patch, or over the central 4 x 4 for a start from a circle", () => {
    // Patch t has the value 1 inside the central 4 x 4 and 0 outside it.
    const central = (patch: number) => [patch % 8, Math.floor(patch / 8)].every((place) => place >= 2 && place <= 5);
    const points = patchPoints(codesOf((patch) => (central(patch) ? [1, 0, 0] : [0, 0, 0])));
    expect(scoredMean(points, "centre-4x4")).toEqual([1, 0, 0]);
    expect(scoredMean(points, undefined)).toEqual([16 / 64, 0, 0]);
    expect(meanOf([])).toEqual([0, 0, 0]);
  });

  test("a distance is stated in the group's median response magnitudes", () => {
    expect(distanceInMedians([3, 4, 0], [0, 0, 0], 2.5)).toBe(2);
  });
});

describe("from one reading to the next", () => {
  test("the points start at the last reading and end at the new one", () => {
    const from = [[0, 0, 0], [2, 2, 2]] as const;
    const to = [[4, 0, 0], [2, 4, 2]] as const;
    expect(between(from, to, 0)).toEqual(from);
    expect(between(from, to, 1)).toEqual(to);
    expect(between(from, to, 0.5)).toEqual([[2, 0, 0], [2, 3, 2]]);
    expect(between(from, to, 7)).toEqual(to);
  });

  test("a point without a last reading stands at its new place", () => {
    expect(between([], [[1, 2, 3]], 0.25)).toEqual([[1, 2, 3]]);
  });

  test("the mean's path keeps the last readings only", () => {
    let path: readonly (readonly [number, number, number])[] = [];
    for (let reading = 0; reading < PATH_READINGS + 5; reading++) path = withMean(path, [reading, 0, 0]);
    expect(path).toHaveLength(PATH_READINGS);
    expect(path[0]).toEqual([5, 0, 0]);
    expect(path.at(-1)).toEqual([PATH_READINGS + 4, 0, 0]);
  });
});

describe("the map's view", () => {
  test("fits the cloud and the target, wherever the canvas's patches are", () => {
    const cloud = cloudPoints(Float32Array.from([-1, 0, 0, 1, 0, 0]), 2);
    const fit = mapFit(cloud, [[0, 3, 0]]);
    expect(fit.center.every(Number.isFinite)).toBe(true);
    // The fit's sphere holds the two rows and the target.
    for (const point of [...cloud, [0, 3, 0] as const]) {
      expect(Math.hypot(point[0] - fit.center[0], point[1] - fit.center[1], point[2] - fit.center[2])).toBeLessThanOrEqual(fit.radius + 1e-6);
    }
  });
});

describe("the run's target on the map", () => {
  test("basis-group mean matching trains toward the reference patch's code; a set method toward every token of its set", () => {
    const codes = Float32Array.from([1, 0, 0, 0, 2, 0, 0, 0, 3]);
    expect(mapTarget("basis-group-mean", [4, 4, 4], codes)).toEqual([[4, 4, 4]]);
    expect(mapTarget("token-mean", [4, 4, 4], codes)).toEqual([[1, 0, 0], [0, 2, 0], [0, 0, 3]]);
    expect(mapTarget("basis-group-distribution", [4, 4, 4], null)).toEqual([]);
  });
});
