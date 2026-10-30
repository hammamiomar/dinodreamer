import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localAssetPath } from "../vite.config";

const root = join(import.meta.dirname, "fixtures");

describe("development asset paths", () => {
  it("resolves nested names and encoded characters without their query", () => {
    expect(localAssetPath(root, "/release/picture%20one.png?v=2")).toBe(join(root, "release", "picture one.png"));
  });

  it.each(["/../private.json", "/%2e%2e%2ffixtures-other/private.json", "/..", "/"])("rejects a path outside the directory or the directory itself: %s", (url) => {
    expect(localAssetPath(root, url)).toBeNull();
  });

  it.each(["/%", "/%ZZ", "/%FF"])("rejects malformed URL encoding without throwing: %s", (url) => {
    expect(localAssetPath(root, url)).toBeNull();
  });
});
