import { describe, expect, test } from "vitest";
import {
  between, cloudPoints, distanceInMedians, inFrame, journeyFit, mapFrame, mapTarget, meanOf, NATIVE_FRAME, patchPoints, PATCH_CODE_VALUES, PATH_READINGS,
  scoredMean, widenedRadius, withMean,
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
  // A cloud that is wide along the first axis, and a target along the third.
  const cloud = cloudPoints(Float32Array.from([-4, 0, 1, 4, 0, 1, 0, 0.5, 2, 0, -0.5, 2]), 4);
  const target = [[0, 0, 6] as const];

  test("up runs from the origin toward the target's mean, and across is where the cloud is widest at right angles to it", () => {
    const frame = mapFrame(target, cloud);
    expect(frame.up).toEqual([0, 0, 1]);
    [1, 0, 0].forEach((value, axis) => expect(frame.across[axis]).toBeCloseTo(value));
    // The target is straight up, the cloud's wide rows left and right of the way to it.
    const placed = inFrame(frame, target[0]!);
    expect(placed[0]).toBeCloseTo(0);
    expect(placed[1]).toBeCloseTo(6);
    expect(inFrame(frame, cloud[1]!)[0]).toBeCloseTo(4);
    // A rotation: lengths stay.
    expect(Math.hypot(...inFrame(frame, [1, 2, 3]))).toBeCloseTo(Math.hypot(1, 2, 3));
    expect(mapFrame([], cloud)).toBe(NATIVE_FRAME);
  });

  test("the view holds the origin and the target, not the cloud's far rows", () => {
    const fit = journeyFit([[0, 6, 0]]);
    expect(fit.center).toEqual([0, 3, 0]);
    expect(fit.radius).toBeGreaterThan(3);
    expect(fit.radius).toBeLessThan(4);
  });

  test("the view widens for a patch outside it, and not for one inside", () => {
    const fit = journeyFit([[0, 6, 0]]);
    expect(widenedRadius(fit, [[0, 1, 0], [1, 3, 0]])).toBe(fit.radius);
    expect(widenedRadius(fit, [[0, -4, 0]])).toBeGreaterThan(7);
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
