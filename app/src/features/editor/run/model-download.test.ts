import { describe, expect, it } from "vitest";
import { createRunState } from "./session";
import { modelGate, modelLoadedBefore, rememberModelLoaded, runGate, type FlagStore } from "./model-download";

function memoryStore(): FlagStore {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
}

describe("the model download gate", () => {
  it("asks before the first load in a browser, and not once the load is asked for or done before", () => {
    const fresh = createRunState();
    expect(modelGate(fresh, false, true)).toBe("ask");
    expect(modelGate({ ...fresh, loadSent: true }, false, true)).toBeNull();
    expect(modelGate(fresh, true, true)).toBeNull();
  });

  it("says the browser cannot paint without WebGPU, before a load or after the worker found no adapter", () => {
    const fresh = createRunState();
    expect(modelGate(fresh, true, false)).toBe("unsupported");
    const noAdapter = { ...fresh, loadSent: true, capabilities: { webgpu: false, reason: "No WebGPU adapter is available." } };
    expect(modelGate(noAdapter, false, true)).toBe("unsupported");
  });

  it("remembers a load in this browser", () => {
    const store = memoryStore();
    expect(modelLoadedBefore(store)).toBe(false);
    rememberModelLoaded(store);
    expect(modelLoadedBefore(store)).toBe(true);
    expect(modelLoadedBefore(null)).toBe(false);
  });
});

it("puts nothing before the fake engine, which loads nothing and needs no WebGPU; the real engine keeps its gate", () => {
  const fresh = createRunState();
  expect(runGate("fake", fresh, false)).toBeNull();
  // The test runtime has no navigator.gpu.
  expect(runGate("app/6c7bb2bf19937886/dinodreamer_engine_bg.wasm", fresh, false)).toBe("unsupported");
});
