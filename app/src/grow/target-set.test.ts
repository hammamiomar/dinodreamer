import { describe, expect, it } from "vitest";
import type { LookPoint } from "../library/look-cloud";
import type { MaterialPoint } from "../recipe";
import {
  FEWEST_DISTRIBUTION_PICTURES, SET_PICTURES, fetchSetPictures, resolveTargetSet, sameTargetSet, sampleCandidates, selectionCandidates, setRefusal,
  targetSetRecord, weakSelection, type SetCandidate,
} from "./target-set";

/** Candidates as [imageId, slot, norm, public]. */
const candidates = (rows: [number, number, number, boolean][]): SetCandidate[] =>
  rows.map(([imageId, slot, norm, publicPreview]) => ({ imageId, slot, norm, publicPreview }));

describe("the target set's rule", () => {
  it("takes public patches strongest first, one per picture, its patch as slot − 5", () => {
    const set = resolveTargetSet(candidates([
      [12, 260, 5.0, true], // patch 255, the grid's last
      [3536804379159069, 74, 9.0, true], // the strongest: patch 69
      [11, 5, 8.0, false], // not public: never requested
      [3536804379159069, 90, 7.0, true], // the same picture again, weaker: its strongest patch stands
      [11, 6, 6.0, true], // a picture whose stronger patch was private: this public one is its first
    ]));
    expect(set).toEqual([
      { imageId: 3536804379159069, patch: 69 },
      { imageId: 11, patch: 1 },
      { imageId: 12, patch: 255 },
    ]);
  });

  it("keeps the given order between equal norms, as the research's stable sort", () => {
    expect(resolveTargetSet(candidates([[1, 10, 2, true], [2, 20, 3, true], [3, 30, 2, true]])).map((picture) => picture.imageId)).toEqual([2, 1, 3]);
  });

  it("stops at 33 distinct pictures, and allows fewer, down to one", () => {
    expect(SET_PICTURES).toBe(33);
    const many = candidates(Array.from({ length: 80 }, (_, row) => [100 + Math.floor(row / 2), 5 + row, 1000 - row, true] as [number, number, number, boolean]));
    const set = resolveTargetSet(many);
    expect(set).toHaveLength(33);
    expect([set[0], set[32]]).toEqual([{ imageId: 100, patch: 0 }, { imageId: 132, patch: 64 }]);
    expect(resolveTargetSet(candidates([[7, 40, 1, true]]))).toEqual([{ imageId: 7, patch: 35 }]);
    expect(resolveTargetSet([])).toEqual([]);
  });
});

describe("the target set's candidates", () => {
  it("takes a selection's library patches by the norm of their code, and leaves out the visitor's own picture", () => {
    const points: MaterialPoint[] = [
      { source: "library", imageId: 7, slot: 40, code: [3, 4, 0] },
      { source: "library", imageId: 8, slot: 41, code: [1, 0, 0], publicPreview: false },
      { source: "upload", slot: 42, code: [9, 9, 9] },
    ];
    expect(selectionCandidates(points)).toEqual([
      { imageId: 7, slot: 40, norm: 5, publicPreview: true },
      { imageId: 8, slot: 41, norm: 1, publicPreview: false },
    ]);
    expect(resolveTargetSet(selectionCandidates(points))).toEqual([{ imageId: 7, patch: 35 }]);
    expect(resolveTargetSet(selectionCandidates([points[2]!]))).toEqual([]);
  });

  it("takes the sample cloud's points in file order with the norms the file stores", () => {
    const point = (imageId: number, slot: number, norm: number): LookPoint => ({
      source: "library", code: [norm, 0, 0], norm, imageId, slot, publicPreview: true, winnerRank: 1, gate: 1,
    });
    expect(sampleCandidates([point(5, 6, 2.5), point(4, 7, 3.5)])).toEqual([
      { imageId: 5, slot: 6, norm: 2.5, publicPreview: true },
      { imageId: 4, slot: 7, norm: 3.5, publicPreview: true },
    ]);
  });
});

describe("what a set method refuses or says (decision 15)", () => {
  const one = targetSetRecord("selection", [{ imageId: 7, patch: 35 }]);
  const two = targetSetRecord("selection", [{ imageId: 7, patch: 35 }, { imageId: 8, patch: 0 }]);

  it("refuses an empty set, and a set of one picture for a distribution method only", () => {
    expect(FEWEST_DISTRIBUTION_PICTURES).toBe(2);
    expect(setRefusal("token-mean", targetSetRecord("selection", []))).toBe("empty");
    expect(setRefusal("basis-group-distribution", one)).toBe("one-picture");
    expect(setRefusal("token-distribution", one)).toBe("one-picture");
    expect(setRefusal("token-mean", one)).toBeNull();
    expect(setRefusal("token-distribution", two)).toBeNull();
  });

  it("finds a selection weak when all its library patches lie at Level 1 or Level 2", () => {
    const strength = { ring: 5, cuts: [8, 11, 14] as [number, number, number], maximum: 17 };
    const at = (norm: number): MaterialPoint => ({ source: "library", imageId: norm, slot: 40, code: [norm, 0, 0] });
    expect(weakSelection([at(4), at(9)], strength)).toBe(true); // Level 1 inside the ring, Level 2 below the first cut
    expect(weakSelection([at(4), at(12)], strength)).toBe(false); // a Level 3 patch
    expect(weakSelection([{ source: "upload", slot: 40, code: [1, 0, 0] }], strength)).toBe(false);
  });
});

describe("the target set's record", () => {
  it("names its source and keeps its pictures in set order", () => {
    const pictures = [{ imageId: 7, patch: 35 }, { imageId: 3, patch: 0 }];
    expect(targetSetRecord("selection", pictures)).toEqual({ source: "selection", neighbourhood: "3x3", pictures });
    expect(targetSetRecord("sample-strongest", pictures).source).toBe("sample-strongest");
  });

  it("tells one set from another by source and pictures in order", () => {
    const a = targetSetRecord("selection", [{ imageId: 7, patch: 35 }, { imageId: 3, patch: 0 }]);
    expect(sameTargetSet(a, targetSetRecord("selection", [{ imageId: 7, patch: 35 }, { imageId: 3, patch: 0 }]))).toBe(true);
    expect(sameTargetSet(a, targetSetRecord("sample-strongest", a.pictures))).toBe(false);
    expect(sameTargetSet(a, targetSetRecord("selection", [{ imageId: 3, patch: 0 }, { imageId: 7, patch: 35 }]))).toBe(false);
    expect(sameTargetSet(a, null)).toBe(false);
    expect(sameTargetSet(null, null)).toBe(true);
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
