import { describe, expect, it } from "vitest";
import { fetchSetPictures, resolveTargetSet, targetSetRecord } from "./target-set";

/** Strongest rows in file order, descending norm, as readStrongestRows gives them: [imageId, slot, public]. */
function rows(entries: [number, number, 0 | 1][]) {
  return {
    count: entries.length,
    imageIds: Float64Array.from(entries, ([imageId]) => imageId),
    slots: Uint16Array.from(entries, ([, slot]) => slot),
    publicPreview: Uint8Array.from(entries, ([, , shown]) => shown),
  };
}

describe("the target set's pictures", () => {
  it("takes public rows in file order, the first row of each picture, its patch as slot − 5", () => {
    const strongest = rows([
      [3536804379159069, 74, 1], // the strongest row: patch 69
      [11, 5, 0], // not public: never requested
      [3536804379159069, 90, 1], // the same picture again: its first row stands
      [12, 260, 1], // patch 255, the grid's last
      [11, 6, 1], // a picture whose first row was private: this public row is its first public one
    ]);
    expect(resolveTargetSet(strongest)).toEqual([
      { imageId: 3536804379159069, patch: 69 },
      { imageId: 12, patch: 255 },
      { imageId: 11, patch: 1 },
    ]);
  });

  it("stops at 33 distinct pictures, and at fewer when the rows run out", () => {
    const many = rows(Array.from({ length: 80 }, (_, row) => [100 + Math.floor(row / 2), 5 + row, 1] as [number, number, 1]));
    const set = resolveTargetSet(many);
    expect(set).toHaveLength(33);
    expect(set[0]).toEqual({ imageId: 100, patch: 0 });
    expect(set[32]).toEqual({ imageId: 132, patch: 64 });
    expect(resolveTargetSet(rows([[7, 40, 1]]))).toEqual([{ imageId: 7, patch: 35 }]);
  });

  it("records the set with its source and neighbourhood, in set order", () => {
    expect(targetSetRecord([{ imageId: 7, patch: 35 }, { imageId: 3, patch: 0 }])).toEqual({
      source: "strongest", neighbourhood: "3x3", pictures: [{ imageId: 7, patch: 35 }, { imageId: 3, patch: 0 }],
    });
  });
});

describe("the target set's fetches", () => {
  it("drops a picture that cannot be fetched and keeps the others in set order", async () => {
    const pictures = [1, 2, 3, 4].map((imageId) => ({ imageId, patch: imageId * 10 }));
    const fetcher = (async (url: string) => {
      if (url.endsWith("/2.png")) return new Response(null, { status: 404 });
      if (url.endsWith("/3.png")) throw new TypeError("network");
      return new Response(new Uint8Array([Number(url.match(/(\d+)\.png$/)![1])]));
    }) as unknown as typeof fetch;
    const answered: number[] = [];
    const fetched = await fetchSetPictures(pictures, (imageId) => `https://library.example/previews/${imageId}.png`, fetcher, (count) => answered.push(count));
    expect(fetched.pictures).toEqual([{ imageId: 1, patch: 10 }, { imageId: 4, patch: 40 }]);
    expect(fetched.pngs.map((png) => [...png])).toEqual([[1], [4]]);
    expect(fetched.dropped).toEqual([{ imageId: 2, patch: 20 }, { imageId: 3, patch: 30 }]);
    expect(answered.at(-1)).toBe(4);
  });
});
