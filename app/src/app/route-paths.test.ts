import { describe, expect, it } from "vitest";
import { canonicalPathname } from "./route-paths";

describe("canonical page paths", () => {
  it.each([
    ["/explore", "/index"],
    ["/explore/", "/index/"],
    ["/block/7178", "/basis/7178"],
    ["/explore/block/7178", "/index/basis/7178"],
    ["/playground", "/automata"],
    ["/playground/block/7178", "/automata/basis/7178"],
    ["/grow", "/train"],
    ["/grow/block/7178", "/train/basis/7178"],
    ["/picture/block/7178", "/picture/basis/7178"],
    ["/how/block/7178", "/how/basis/7178"],
    ["/create/block/7178", "/create/basis/7178"],
    ["/admin/materials/block/7178", "/admin/materials/basis/7178"],
    ["/index/block/7178", "/index/basis/7178"],
  ])("redirects %s to %s", (previous, current) => {
    expect(canonicalPathname(previous)).toBe(current);
    expect(canonicalPathname(current)).toBe(current);
  });

  it.each(["/", "/growth", "/blockade/1", "/explorer", "/api/materials/block-7178", "/assets/grow.js"])(
    "preserves unrelated path %s",
    (pathname) => expect(canonicalPathname(pathname)).toBe(pathname),
  );
});
