import { afterEach, describe, expect, it, vi } from "vitest";
import { trainingBatch } from "./training-device";

function device(coarse: boolean, width: number, height: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" && coarse }));
  vi.stubGlobal("screen", { width, height });
}

afterEach(() => vi.unstubAllGlobals());

describe("Train's initial batch", () => {
  it.each([[440, 956], [956, 440]])("uses batch 1 on a phone at %i × %i", (width, height) => {
    device(true, width, height);
    expect(trainingBatch("")).toBe(1);
  });

  it.each([
    [true, 820, 1180],
    [false, 1440, 900],
    [false, 440, 956],
  ] as const)("retains batch 4 for other screens (%s, %i × %i)", (coarse, width, height) => {
    device(coarse, width, height);
    expect(trainingBatch("")).toBe(4);
  });

  it("accepts either explicit batch on either device", () => {
    for (const coarse of [false, true]) {
      device(coarse, 440, 956);
      expect(trainingBatch("?growBatch=1")).toBe(1);
      expect(trainingBatch("?growBatch=4")).toBe(4);
    }
  });

  it("uses the device default for an unsupported batch", () => {
    device(true, 440, 956);
    expect(trainingBatch("?growBatch=2")).toBe(1);
    device(false, 1440, 900);
    expect(trainingBatch("?growBatch=2")).toBe(4);
  });
});
