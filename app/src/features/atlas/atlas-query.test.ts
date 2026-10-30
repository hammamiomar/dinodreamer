import { describe, expect, it } from "vitest";
import { hasAtlasQuery } from "./atlas-query";

describe("an old Atlas link", () => {
  it("recognises an old Atlas link by its query", () => {
    expect(hasAtlasQuery(new URLSearchParams("?role=cls"))).toBe(true);
    expect(hasAtlasQuery(new URLSearchParams("?page=3"))).toBe(true);
    expect(hasAtlasQuery(new URLSearchParams(""))).toBe(false);
    expect(hasAtlasQuery(new URLSearchParams("?utm=x"))).toBe(false);
  });
});
