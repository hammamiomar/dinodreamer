import { describe, expect, it } from "vitest";
import { firingBoundary } from "./firing-boundary";

describe("the firing boundary", () => {
  it("spans from the lowest projection that met the target to the highest that did not", () => {
    const runs = [{ strength: 1.3, winnerFraction: 1 }, { strength: 1.4, winnerFraction: 0.5 }, { strength: 1.1, winnerFraction: 0 }, { strength: 2, winnerFraction: 0.95 }];
    expect(firingBoundary(runs)).toEqual([1.3, 1.4]);
  });
});
