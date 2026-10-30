import { describe, expect, it } from "vitest";
import type { StrengthCuts } from "../../recipe";
import type { CloudToken } from "./cloud-token";
import { evenSubsample, makeMaterialRequest, type RequestInput } from "./material-request";

// Ring 4, maximum 12: cuts at 6, 8 and 10.
const strength: StrengthCuts = { ring: 4, cuts: [6, 8, 10], maximum: 12 };
const coverage = { source: "full", loadedRows: 65536, blockRows: 215830, selectedPoints: 2 } as const;
const points: CloudToken[] = [
  { source: "library", imageId: 9007199254740991, slot: 5, code: [-3, 4, 1], norm: Math.hypot(-3, 4, 1), publicPreview: true },
  { source: "library", imageId: 7, slot: 260, code: [2, 1, 3], norm: Math.hypot(2, 1, 3), publicPreview: true },
  { source: "library", imageId: 8, slot: 9, code: [6, 8, 0], norm: 10, publicPreview: false },
  { source: "upload", slot: 9, code: [1, 2, 3], norm: Math.hypot(1, 2, 3) },
];
const input = (selected: number[], anchor: number, mode?: RequestInput["mode"]): RequestInput =>
  ({ block: 14544, token: (index) => points[index], points: selected, anchor, strength, coverage, mode });

describe("the Studio request", () => {
  it("keeps the older fields exactly for public library points, and copies native codes", () => {
    const request = makeMaterialRequest(input([1, 0], 1, "fill"));
    expect(request.block).toBe(14544);
    expect(request.mode).toBe("fill");
    expect(request.points).toStrictEqual([
      { source: "library", imageId: 7, code: [2, 1, 3], slot: 260 },
      { source: "library", imageId: 9007199254740991, code: [-3, 4, 1], slot: 5 },
    ]);
    request.points[0].code[0] = 20;
    expect(points[1].code[0]).toBe(2);
    expect(makeMaterialRequest(input([0], 0))).not.toHaveProperty("mode");
  });

  it("says the anchor's band first, with the cuts that define it", () => {
    const request = makeMaterialRequest(input([0, 1], 2));
    const json = JSON.parse(JSON.stringify(request));
    expect(Object.keys(json)[0]).toBe("anchor");
    expect(Object.keys(json.anchor)[0]).toBe("band");
    expect(json.anchor).toEqual({
      band: "strongest", norm: 10, strength: { ring: 4, cuts: [6, 8, 10], maximum: 12 },
      source: "library", imageId: 8, code: [6, 8, 0], slot: 9, publicPreview: false,
    });
    expect(json.coverage).toEqual({ source: "full", loadedRows: 65536, blockRows: 215830, selectedPoints: 2 });
  });

  it("names the band of a weak anchor plainly; the request is still made", () => {
    expect(makeMaterialRequest(input([1], 1)).anchor?.band).toBe("barely");
    expect(makeMaterialRequest(input([0], 0)).anchor?.band).toBe("barely");
  });

  it("marks a library point without a public picture and keeps an upload without an invented ID", () => {
    const request = makeMaterialRequest(input([2, 3], 3));
    expect(request.points).toStrictEqual([
      { source: "library", imageId: 8, code: [6, 8, 0], slot: 9, publicPreview: false },
      { source: "upload", code: [1, 2, 3], slot: 9 },
    ]);
    expect(request.anchor).toMatchObject({ source: "upload", band: "barely" });
    expect(request.anchor).not.toHaveProperty("imageId");
  });
});

describe("the points Send carries", () => {
  const region = Array.from({ length: 10 }, (_, index) => 100 + index);

  it("returns a region within the limit unchanged", () => {
    expect(evenSubsample(region, 10, null)).toBe(region);
  });

  it("spaces a larger region evenly in row order", () => {
    expect(evenSubsample(region, 4, null)).toEqual([100, 102, 105, 107]);
  });

  it("keeps a selected anchor in place of the nearest drawn point, in order", () => {
    expect(evenSubsample(region, 4, 109)).toEqual([100, 102, 105, 109]);
    expect(evenSubsample(region, 4, 103)).toEqual([100, 103, 105, 107]);
    expect(evenSubsample(region, 4, 42)).toEqual([100, 102, 105, 107]);
  });
});
