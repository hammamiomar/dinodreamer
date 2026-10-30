import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { batchFallback, clearBatchFallback, clearRunOnPageHide, fallbackAfter, noteInterruptedRun, presetBatch, runMemory, runWentDownInThisTab } from "./batch-size";

/** A tab's session storage, kept across the page loads a test plays. */
function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
    clear: () => items.clear(),
    key: () => null,
    get length() { return items.size; },
  };
}

function device({ coarse, width, height }: { coarse: boolean; width: number; height: number }) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" && coarse }));
  vi.stubGlobal("screen", { width, height });
}

const phone = { coarse: true, width: 440, height: 956 };
const computer = { coarse: false, width: 1440, height: 900 };

beforeEach(() => vi.stubGlobal("sessionStorage", fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("the preset batch size", () => {
  test("is the recipe's 4 on a computer or a tablet, and 1 on a phone", () => {
    device(computer);
    expect(presetBatch("")).toBe(4);
    device({ coarse: true, width: 820, height: 1180 });
    expect(presetBatch("")).toBe(4);
    device(phone);
    expect(presetBatch("")).toBe(1);
    device({ coarse: true, width: 956, height: 440 });
    expect(presetBatch("")).toBe(1);
  });

  test("follows the address on any device, and ignores a batch size the recipe has no measurements for", () => {
    for (const where of [phone, computer]) {
      device(where);
      expect(presetBatch("?growBatch=1")).toBe(1);
      expect(presetBatch("?growBatch=4")).toBe(4);
    }
    device(computer);
    expect(presetBatch("?growBatch=2")).toBe(4);
  });
});

describe("the fallback after a run at 4 stops the page", () => {
  test("a page taken down mid-run presets 1 for the rest of the tab, until the person chooses", () => {
    device(computer);
    runMemory.started(4);
    // The page goes down without pagehide, then loads again.
    noteInterruptedRun();
    expect(batchFallback()).toEqual({ reason: "reload" });
    expect(presetBatch("")).toBe(1);
    // A later load of the same tab with no run in progress keeps the fallback.
    noteInterruptedRun();
    expect(presetBatch("")).toBe(1);
    clearBatchFallback();
    expect(batchFallback()).toBeNull();
    expect(presetBatch("")).toBe(4);
    // The tab still knows a run went down, for the start dialog's advice to reload.
    expect(runWentDownInThisTab()).toBe(true);
  });

  test("a page the person leaves or reloads is not a run that stopped it", () => {
    device(computer);
    const listeners: (() => void)[] = [];
    clearRunOnPageHide({ addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.push(listener as () => void) } as never);
    runMemory.started(4);
    for (const listener of listeners) listener();
    noteInterruptedRun();
    expect(batchFallback()).toBeNull();
    expect(presetBatch("")).toBe(4);
    expect(runWentDownInThisTab()).toBe(false);
  });

  test("a run that ended, and a run at 1, leave no fallback", () => {
    device(computer);
    runMemory.started(4);
    runMemory.ended();
    noteInterruptedRun();
    expect(batchFallback()).toBeNull();
    runMemory.started(1);
    noteInterruptedRun();
    expect(batchFallback()).toBeNull();
    expect(fallbackAfter("device", 1)).toBeNull();
  });

  test("a lost graphics device during a run at 4 falls back to 1 at once", () => {
    device(computer);
    runMemory.started(4);
    runMemory.deviceLost(4);
    expect(batchFallback()).toEqual({ reason: "device" });
    expect(presetBatch("")).toBe(1);
    // The run is over: a later page load does not count it as taken down.
    noteInterruptedRun();
    expect(batchFallback()).toEqual({ reason: "device" });
  });

  test("the address wins over the fallback", () => {
    device(computer);
    runMemory.started(4);
    noteInterruptedRun();
    expect(presetBatch("?growBatch=4")).toBe(4);
  });
});
