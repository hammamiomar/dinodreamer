import { afterEach, expect, it, vi } from "vitest";
import type { FigureReplay } from "./figure-replay";
import { recordReplayVideo } from "./replay-video";

afterEach(() => vi.unstubAllGlobals());

it.each(["advance", "recorder"])("releases the capture track when %s initialization fails", async (failure) => {
  const stop = vi.fn();
  const canvas = {
    getContext: () => ({}),
    captureStream: () => ({ getVideoTracks: () => [{ stop }] }),
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("OffscreenCanvas", class { getContext() { return {}; } });
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported() { return true; }
    constructor() { throw new Error("recorder failed"); }
  });
  const replay = {
    pictureSide: 128,
    reseed() {},
    async advance() { if (failure === "advance") throw new Error("advance failed"); },
  } as unknown as FigureReplay;
  await expect(recordReplayVideo(replay, { seed: 1, fromTick: 0, toTick: 1, ticksPerFrame: 1, fps: 30 })).rejects.toThrow(`${failure} failed`);
  expect(stop).toHaveBeenCalledOnce();
});
