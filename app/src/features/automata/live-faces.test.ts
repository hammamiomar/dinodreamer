import { describe, expect, test, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { readFigureMaterial } from "../../materials/material-file";
import materialFile from "../../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json";
import { createFigureReplay, type FigureReplay } from "../../replay/figure-replay";
import { openLiveFace } from "./live-faces";

vi.mock("../../replay/figure-replay", () => ({ createFigureReplay: vi.fn() }));

describe("growth on the Automata wall", () => {
  test.each([[60, 100], [120, 100], [60, 600], [120, 2000]])(
    "at %i Hz the face grows steadily through reading tick %i, pauses out of view and heals after a stroke",
    async (hz, reading) => {
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
      const face = openLiveFace(canvas, readFigureMaterial(materialFile), { side: 64, seed: 1, tick: reading }, { onShown, onFailed });
      try {
        await setImmediate();
        await frame();
        expect(onShown).toHaveBeenCalledOnce();
        expect(seen).toEqual([0]);
        for (let i = 0; i < hz / 10; i++) await frame();
        expect(Math.abs(tick - 6)).toBeLessThanOrEqual(1);
        face.setInView(false);
        now += 6000;
        face.setInView(true);
        for (let i = 0; i < hz * 0.4; i++) await frame();
        expect(Math.abs(tick - 30)).toBeLessThanOrEqual(1);
        for (let i = 0; i < Math.ceil(hz * reading / 60); i++) await frame();
        expect(tick).toBe(reading);
        expect(pending).toBeUndefined();
        face.stroke({ x: 3, y: 1 }, { x: 4, y: 1 });
        for (let i = 0; i < hz * 4.2; i++) await frame();
        expect(tick).toBeGreaterThanOrEqual(reading + 238);
        expect(tick).toBeLessThanOrEqual(reading + 241);
        expect(pending).toBeUndefined();
        expect(onFailed).not.toHaveBeenCalled();
      } finally {
        face.close();
        clock.mockRestore();
        vi.unstubAllGlobals();
      }
    },
  );
});
