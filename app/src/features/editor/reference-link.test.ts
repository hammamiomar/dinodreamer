import { describe, expect, it } from "vitest";
import { parseReferenceLink, referenceLinkValue } from "./reference-link";

describe("a reference link", () => {
  it("names a patch with or without its code", () => {
    expect(parseReferenceLink("4009:2985056820452196:64")).toEqual({ token: { imageId: 2985056820452196, role: "patch", slot: 64 }, block: 4009 });
    expect(parseReferenceLink("4009:2985056820452196:64:-9.04,-7.23,0.91")).toEqual({
      token: { imageId: 2985056820452196, role: "patch", slot: 64 },
      block: 4009,
      code: [-9.04, -7.23, 0.91],
    });
    expect(parseReferenceLink("12:7:0")).toEqual({ token: { imageId: 7, role: "cls", slot: 0 }, block: 12 });
  });

  it("refuses anything that is not one", () => {
    for (const value of [null, "", "4009", "4009:7", "a:7:64", "4009:7:999", "-1:7:64", "4009:7:64:1,2", "4009:7:64:1,x,3", "4009:7:64:1,2,3:4"]) {
      expect(parseReferenceLink(value), String(value)).toBeNull();
    }
  });

  it("writes the value it reads", () => {
    const reference = { token: { imageId: 2985056820452196, role: "patch" as const, slot: 64 }, block: 4009, code: [-9.04, -7.23, 0.91] as [number, number, number] };
    expect(parseReferenceLink(referenceLinkValue(reference))).toEqual(reference);
    const bare = { token: { imageId: 7, role: "patch" as const, slot: 64 }, block: 4009 };
    expect(parseReferenceLink(referenceLinkValue(bare))).toEqual(bare);
  });
});
