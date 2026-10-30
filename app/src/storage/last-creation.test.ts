import { describe, expect, it } from "vitest";
import { forgetLastCreation, lastCreationId, rememberLastCreation, type PointerStore } from "./last-creation";

function memoryStore(): PointerStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe("the last creation pointer", () => {
  it("names the record the autosave wrote most recently, and nothing before the first save", () => {
    const store = memoryStore();
    expect(lastCreationId(store)).toBeNull();
    rememberLastCreation("a", store);
    rememberLastCreation("b", store);
    expect(lastCreationId(store)).toBe("b");
  });

  it("is forgotten when its record is deleted, and kept when another record is", () => {
    const store = memoryStore();
    rememberLastCreation("b", store);
    forgetLastCreation("a", store);
    expect(lastCreationId(store)).toBe("b");
    forgetLastCreation("b", store);
    expect(lastCreationId(store)).toBeNull();
  });

  it("starts new where storage is unavailable", () => {
    expect(lastCreationId(null)).toBeNull();
    rememberLastCreation("a", null);
    const throwing: PointerStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    rememberLastCreation("a", throwing);
    expect(lastCreationId(throwing)).toBeNull();
  });
});
