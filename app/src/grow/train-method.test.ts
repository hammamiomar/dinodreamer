import { describe, expect, it } from "vitest";
import { FIGURE_METHODS } from "../materials/material-file";
import { RUNS } from "./figure-recipe";
import {
  DEFAULT_DEPTH, DEFAULT_METHOD, TRAIN_COMPARISONS, TRAIN_SPACES, comparisonOf, depthFromSearch, depthOfLayers, keepRule, methodFromSearch,
  methodLayers, methodOf, spaceOf,
} from "./train-method";

describe("Train's method", () => {
  it("defaults to basis-group mean matching (Omar's decision 4)", () => {
    expect(DEFAULT_METHOD).toBe("basis-group-mean");
    expect(methodFromSearch(new URLSearchParams("block=12002"))).toBe("basis-group-mean");
    expect(methodFromSearch(new URLSearchParams("block=12002&method=token-distribution"))).toBe("token-distribution");
    expect(methodFromSearch(new URLSearchParams("block=12002&method=basis-group-mean-guided"))).toBe("basis-group-mean");
  });

  it("is one choice of space and one of comparison, the four names of the Automata page", () => {
    const made = TRAIN_SPACES.flatMap((space) => TRAIN_COMPARISONS.map((comparison) => methodOf(space, comparison)));
    expect([...made].sort()).toEqual([...FIGURE_METHODS].sort());
    for (const method of FIGURE_METHODS) expect(methodOf(spaceOf(method), comparisonOf(method))).toBe(method);
    expect([spaceOf("token-mean"), comparisonOf("token-mean")]).toEqual(["token", "mean"]);
    expect([spaceOf("basis-group-distribution"), comparisonOf("basis-group-distribution")]).toEqual(["basis-group", "distribution"]);
  });

  it("compares both token methods at four layers by default or the final layer alone; a basis-group method has no depth", () => {
    expect(DEFAULT_DEPTH).toBe("four-layers");
    for (const method of ["token-mean", "token-distribution"] as const) {
      expect(methodLayers(method)).toEqual(["block-3", "block-6", "block-9", "final"]);
      expect(methodLayers(method, "final-layer")).toEqual(["final"]);
    }
    expect(methodLayers("basis-group-mean", "final-layer")).toEqual([]);
    expect(methodLayers("basis-group-distribution")).toEqual([]);
  });

  it("reads a depth from recorded layers and from the address", () => {
    expect(depthOfLayers(["block-3", "block-6", "block-9", "final"])).toBe("four-layers");
    expect(depthOfLayers(["final"])).toBe("final-layer");
    expect(depthOfLayers(["block-3"])).toBeNull();
    expect(depthFromSearch(new URLSearchParams("block=12002&depth=final-layer"))).toBe("final-layer");
    expect(depthFromSearch(new URLSearchParams("block=12002&depth=deep"))).toBe("four-layers");
  });
});

describe("the keep rule (Omar's decision 3)", () => {
  const rows = [
    // method, continued, runs, keeps the first fire, publishes only a fired result
    ["basis-group-mean", false, RUNS, true, true],
    ["basis-group-mean", true, 1, true, true],
    ["token-mean", false, 1, false, false],
    ["basis-group-distribution", false, 1, false, false],
    ["token-distribution", false, 1, false, false],
    ["token-distribution", true, 1, false, false],
  ] as const;
  for (const [method, continued, runs, keepsFirstFire, publishesOnlyFired] of rows) {
    it(`${method}${continued ? ", continued" : ""}: ${runs} run(s), first fire ${keepsFirstFire ? "kept" : "not kept"}`, () => {
      expect(keepRule(method, continued, RUNS)).toEqual({ runs, keepsFirstFire, publishesOnlyFired });
    });
  }
});
