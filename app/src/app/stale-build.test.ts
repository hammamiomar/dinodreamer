import { describe, expect, it } from "vitest";
import type { RunState } from "../features/editor/run/session";
import { claimStaleBuildReload, engineStartFailedForStaleBuild, RELOAD_GUARD_MS, STALE_RELOAD_KEY } from "./stale-build";

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
}

describe("the reload guard", () => {
  it("allows one reload, then holds for the guard window, then allows again", () => {
    const storage = memoryStorage();
    expect(claimStaleBuildReload(storage, 1_000)).toBe(true);
    expect(storage.items.get(STALE_RELOAD_KEY)).toBe("1000");
    // The reloaded page fails the same way: no second reload, the error shows.
    expect(claimStaleBuildReload(storage, 5_000)).toBe(false);
    expect(claimStaleBuildReload(storage, 1_000 + RELOAD_GUARD_MS - 1)).toBe(false);
    // A later deploy, much later in the same tab, may heal again.
    expect(claimStaleBuildReload(storage, 1_000 + RELOAD_GUARD_MS)).toBe(true);
  });

  it("never reloads without a storage that keeps the mark", () => {
    expect(claimStaleBuildReload(undefined, 1_000)).toBe(false);
    const refusing = { getItem: () => null, setItem: () => { throw new Error("blocked"); } };
    expect(claimStaleBuildReload(refusing, 1_000)).toBe(false);
  });
});

describe("an engine start that a new build explains", () => {
  const base: Pick<RunState, "phase" | "settledPhase" | "capabilities" | "error" | "phaseMessage"> = { phase: "failed", settledPhase: "idle" };

  it("counts a worker that never started and an engine module that did not load", () => {
    expect(engineStartFailedForStaleBuild({ ...base, error: { message: "The synthesis worker stopped unexpectedly.", fatal: true } })).toBe(true);
    expect(
      engineStartFailedForStaleBuild({ ...base, capabilities: { webgpu: true, adapter: "apple" }, error: { message: "failed to fetch Wasm: 404 Not Found", fatal: true } }),
    ).toBe(true);
  });

  it("does not count a machine without WebGPU, a model failure, a failure after the engine ran, or no failure", () => {
    expect(engineStartFailedForStaleBuild({ ...base, capabilities: { webgpu: false, reason: "This browser does not provide WebGPU." }, phaseMessage: "This browser does not provide WebGPU." })).toBe(false);
    expect(engineStartFailedForStaleBuild({ ...base, capabilities: { webgpu: true }, error: { message: "model file checksum does not match", fatal: true } })).toBe(false);
    expect(engineStartFailedForStaleBuild({ ...base, settledPhase: "running", error: { message: "The synthesis worker stopped unexpectedly.", fatal: true } })).toBe(false);
    expect(engineStartFailedForStaleBuild({ phase: "loading", settledPhase: "idle" })).toBe(false);
  });
});
