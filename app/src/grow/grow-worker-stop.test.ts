import { afterEach, expect, it, vi } from "vitest";
import type { GrowCommand, GrowEvent } from "./protocol";

const { loadEngine, update, readGrid } = vi.hoisted(() => ({
  loadEngine: vi.fn(),
  update: vi.fn(),
  readGrid: vi.fn(),
}));
vi.mock("../synthesis/load-encoder", () => ({ loadEncoderEngine: loadEngine }));
vi.mock("../synthesis/assets", () => ({
  fetchModelRelease: async () => ({ dictionary: "model/test/", release: "test", blocks: 16384 }),
  blockPath: () => "frame",
  AssetLoader: class {
    async open() {}
    async bytes() {
      return new TextEncoder().encode(JSON.stringify({
        release: "test", block: 4009, patch_rows: 100, gate_median: 2, radius: { p50: 3 }, main_lobe: { direction: [1, 0, 0] },
      }));
    }
  },
}));
// One unloaded chunk is sufficient to exercise the reader-readiness boundary.
vi.mock("../reader/assets", () => ({ decodeReaderIndex: () => ({ files: [{}] }) }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the untrained grid running across the reading interval and resumes the held trainer", async () => {
  vi.useFakeTimers();
  const events: GrowEvent[] = [];
  const scope = {
    onmessage: undefined as ((event: { data: GrowCommand }) => void) | undefined,
    postMessage: (event: GrowEvent) => events.push(event),
  };
  vi.stubGlobal("self", scope);
  let tick = 0;
  const trainer = { completed: () => 0, target: () => 1000, values: () => new Float32Array(7776), free: vi.fn() };
  const grid = {
    advance: (steps: number) => { tick += steps; return new Uint8ClampedArray(4); },
    tick: () => tick, seed: () => 1, finite: () => true, set_rule: vi.fn(), free: vi.fn(),
  };
  // End the simulated device run at its first optimizer call, after verifying which trainer resumed.
  update.mockRejectedValue(new Error("Device closed"));
  readGrid.mockRejectedValue(new Error("Dictionary is incomplete"));
  loadEngine.mockResolvedValue({ engine: {
    load_frame: vi.fn(), create_figure: () => trainer, create_figure_grid: () => grid,
    figure_update: update, figure_reading: readGrid, free: vi.fn(),
  } });
  await import("./grow.worker");
  const send = (data: GrowCommand) => scope.onmessage!({ data });
  send({
    type: "start", release: { baseUrl: "/fixtures", manifestPath: "test.json" },
    request: { block: 4009, points: [], anchor: {
      source: "library", imageId: 1, slot: 5, code: [3, 0, 0], norm: 3, band: "strongest",
      strength: { ring: 2, cuts: [3, 4, 5], maximum: 6 },
    } },
    kind: { rule: "cell", start: "noise" }, batch: 1, method: "basis-group-mean", layers: [], set: null, stopAtFirstFire: false,
  });
  send({ type: "stop" });
  await vi.advanceTimersByTimeAsync(2100);
  expect(events).toContainEqual(expect.objectContaining({ type: "phase", phase: "stopped" }));
  expect(tick).toBeGreaterThan(1);
  expect(readGrid).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(trainer.free).not.toHaveBeenCalled();

  send({ type: "resume-training" });
  await vi.advanceTimersByTimeAsync(100);
  expect(update).toHaveBeenCalledExactlyOnceWith(trainer);
  expect(trainer.free).toHaveBeenCalledOnce();
});
