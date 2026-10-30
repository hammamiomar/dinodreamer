import { describe, expect, it } from "vitest";
import { explorePath, recallAtlasPosition, rememberAtlasPosition } from "./atlas-position";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    length: 0,
  };
}

describe("the Explore position left", () => {
  it("is the last position remembered, and Explore itself before any", () => {
    const storage = memoryStorage();
    expect(explorePath(storage)).toBe("/index");
    rememberAtlasPosition("?role=cls&sort=block&page=12", storage);
    expect(recallAtlasPosition(storage)).toBe("?role=cls&sort=block&page=12");
    expect(explorePath(storage)).toBe("/index?role=cls&sort=block&page=12");
  });

  it("survives a storage that refuses", () => {
    const refusing = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("quota");
      },
      getItem: () => {
        throw new Error("blocked");
      },
    } as Storage;
    rememberAtlasPosition("?role=patch&sort=block&page=3", refusing);
    expect(recallAtlasPosition(refusing)).toBe("?role=patch&sort=block&page=3");
  });
});
