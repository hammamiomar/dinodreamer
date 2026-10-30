import { describe, expect, it } from "vitest";
import { createStarredStore, parseStarred, toggled } from "./starred-blocks";

function memoryStorage(): Storage & { writes: number } {
  const items = new Map<string, string>();
  const storage = {
    writes: 0,
    getItem: (key: string) => items.get(key) ?? null,
    setItem(key: string, value: string) {
      storage.writes += 1;
      items.set(key, value);
    },
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    length: 0,
  };
  return storage;
}

describe("starred blocks", () => {
  it("keeps the order starred and each block once", () => {
    expect(toggled([], 7125)).toEqual([7125]);
    expect(toggled([7125], 42)).toEqual([7125, 42]);
    expect(toggled([7125, 42], 7125)).toEqual([42]);
  });

  it("reads a stored list and ignores anything that is not a block number", () => {
    expect(parseStarred(null)).toEqual([]);
    expect(parseStarred('[7125, 42, 7125, -1, 2.5, "x"]')).toEqual([7125, 42]);
    expect(parseStarred("not json")).toEqual([]);
    expect(parseStarred("{}")).toEqual([]);
  });

  it("writes each change to the storage and reads the same array until the list changes", () => {
    const storage = memoryStorage();
    const store = createStarredStore(() => storage);
    let changes = 0;
    store.subscribe(() => (changes += 1));
    store.toggle(7125);
    store.toggle(42);
    expect(storage.getItem("starred-blocks")).toBe("[7125,42]");
    expect(store.read()).toBe(store.read());
    expect(store.read()).toEqual([7125, 42]);
    expect(changes).toBe(2);
  });

  it("keeps the list in memory when the storage refuses a write, and the star stays set", () => {
    const storage = memoryStorage();
    storage.setItem("starred-blocks", "[1]");
    let refuse = true;
    const refusing = {
      ...storage,
      setItem(key: string, value: string) {
        if (refuse) throw new DOMException("quota", "QuotaExceededError");
        storage.setItem(key, value);
      },
    } as Storage;
    const store = createStarredStore(() => refusing);
    expect(store.read()).toEqual([1]);
    store.toggle(7125);
    // The stored text still says [1]; the page says what the visitor did.
    expect(storage.getItem("starred-blocks")).toBe("[1]");
    expect(store.read()).toEqual([1, 7125]);
    expect(store.read()).toEqual([1, 7125]);
    store.toggle(42);
    expect(store.read()).toEqual([1, 7125, 42]);
    // A write that succeeds hands the list back to the storage.
    refuse = false;
    store.toggle(1);
    expect(storage.getItem("starred-blocks")).toBe("[7125,42]");
    expect(store.read()).toEqual([7125, 42]);
  });

  it("works without any storage", () => {
    const store = createStarredStore(() => undefined);
    expect(store.read()).toEqual([]);
    store.toggle(7125);
    expect(store.read()).toEqual([7125]);
    store.toggle(7125);
    expect(store.read()).toEqual([]);
  });
});
