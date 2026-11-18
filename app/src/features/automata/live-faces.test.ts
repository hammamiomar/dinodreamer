import { describe, expect, test, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { readFigureMaterial } from "../../materials/material-file";
import materialFile from "../../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json";
import { createFigureReplay, type FigureReplay } from "../../replay/figure-replay";
import { faceTickAtTime, openLiveFace } from "./live-faces";

vi.mock("../../replay/figure-replay", () => ({ createFigureReplay: vi.fn() }));

describe("growth on the Automata wall", () => {
  test("the seed stays visible, early form comes quickly and every reading has a slower finish", () => {
    for (const reading of [100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000]) {
      const fastTicks = Math.min(160, Math.ceil(0.6 * reading));
      const burstEnd = 0.16 + fastTicks / 600;
      expect(faceTickAtTime(0.16, reading)).toBe(0);
      expect(faceTickAtTime(0.21, reading)).toBeGreaterThanOrEqual(29);
      expect(faceTickAtTime(burstEnd + 0.001, reading)).toBe(fastTicks);
      expect(faceTickAtTime(2.5, reading)).toBeGreaterThan(fastTicks);
      expect(faceTickAtTime(burstEnd + 4.4, reading)).toBeLessThan(reading);
      expect(faceTickAtTime(burstEnd + 4.501, reading)).toBe(reading);
      expect(faceTickAtTime(30, reading)).toBe(reading);
    }
  });

  test.each([60, 120])("at %i Hz the seed is first, hidden time is excluded and the reading sleeps", async (hz) => {
    let now = 0;
    let tick = 0;
    const seen: number[] = [];
    vi.mocked(createFigureReplay).mockResolvedValue({
      get tick() { return tick; },
      async advance(count: number) { tick += count; seen.push(tick); },
      async present() { seen.push(tick); },
      async stamp() {}, dispose() {},
    } as unknown as FigureReplay);
    const device = { lost: new Promise(() => {}) };
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => ({ requestDevice: async () => device }) } });
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    let pending: (() => void) | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { pending = callback; });
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    async function frame() {
      now += 1000 / hz;
      const scheduled = pending;
      pending = undefined;
      scheduled?.();
      await setImmediate();
    }
    const onShown = vi.fn();
    const onFailed = vi.fn();
    const canvas = { getBoundingClientRect: () => ({ width: 192 }) } as HTMLCanvasElement;
    const face = openLiveFace(canvas, readFigureMaterial(materialFile), { side: 64, seed: 1, tick: 100 }, { onShown, onFailed });
    try {
      await setImmediate();
      await frame();
      expect(onShown).toHaveBeenCalledOnce();
      expect(seen).toEqual([0]);
      for (let i = 0; i < hz / 10; i++) await frame();
      expect(seen).toEqual([0]);
      face.setInView(false);
      now += 6000;
      face.setInView(true);
      for (let i = 0; i < hz * 0.4; i++) await frame();
      expect(tick).toBe(faceTickAtTime(0.5, 100));
      for (let i = 0; i < hz * 4.5; i++) await frame();
      expect(tick).toBe(100);
      expect(pending).toBeUndefined();
      face.stroke({ x: 3, y: 1 }, { x: 4, y: 1 });
      for (let i = 0; i < hz * 4.2; i++) await frame();
      expect(tick).toBeGreaterThanOrEqual(338);
      expect(tick).toBeLessThanOrEqual(341);
      expect(pending).toBeUndefined();
      expect(onFailed).not.toHaveBeenCalled();
    } finally {
      face.close();
      clock.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
