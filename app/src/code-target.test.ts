import { describe, expect, it } from "vitest";
import { pathCode, regionCodes, regionSource, sameCodeTarget } from "./code-target";
import { parseRecipe } from "./recipe-parse";
import { validateRecipe, type CodeTarget } from "./recipe";
import { createRecipe, createRequest, setCodeBlockCount, setCodeRadius, setCodeTarget, setPathAnchor } from "./features/editor/model";
import { objectiveSpec, probeSpecs, sameObjective } from "./synthesis/objective";
import { matchMap } from "./features/editor/readout/readout";
import type { CloudPoint } from "./library/records";

function recipe() {
  const result = createRequest(createRecipe("pass-003"), { block: 14544, token: { imageId: 7, role: "patch", slot: 5 }, code: [2, 0, 0] });
  result.requests[0]!.lookLike.enabled = false;
  result.requests[0]!.respondLike.where = Array.from({ length: 256 }, (_, cell) => cell <= 2 ? 100 : 0);
  return result;
}
const path = { kind: "path", codes: [[2, 0, 0], [4, 0, 0]], anchors: [0, 2] } satisfies CodeTarget;
const region = { kind: "region", centre: [2, 0, 0], selectionRadius: 1, lambda: 1 } satisfies CodeTarget;

describe("palette recipes", () => {
  it.each<CodeTarget>([{ kind: "point" }, path, region])("round trips $kind and its radius", (target) => {
    let value = recipe();
    value = setCodeTarget(value, value.requests[0]!.id, target);
    value = setCodeRadius(value, value.requests[0]!.id, 2.5);
    expect(parseRecipe(value)).toEqual(value);
    expect(validateRecipe(value)).toEqual([]);
  });

  it("upgrades format 6 to a point at radius 1 while retaining address codes", () => {
    const value = recipe();
    const term = value.requests[0]!.respondLike;
    const { target: _target, radius: _radius, ...before } = term;
    const older = { ...value, format: 6, requests: [{ ...value.requests[0]!, respondLike: { ...before, alsoBlocks: [{ block: 3, code: [1, 2, 3] }] } }] };
    const parsed = parseRecipe(older);
    expect(parsed.format).toBe(7);
    expect(parsed.requests[0]!.respondLike).toEqual({ ...older.requests[0]!.respondLike, target: { kind: "point" }, radius: 1 });
  });

  it("defaults missing format-7 coverage to zero and keeps the field in the resolved recipe", () => {
    const value = recipe();
    const request = value.requests[0]!;
    const { lambda: _lambda, ...withoutCoverage } = region;
    const input = { ...value, requests: [{ ...request, respondLike: { ...request.respondLike, target: withoutCoverage } }] };
    expect(parseRecipe(input).requests[0]!.respondLike.target).toEqual({ ...region, lambda: 0 });
  });

  it.each([0, 0.5, 1])("keeps saved format-7 coverage %s through parsing and engine preparation", (lambda) => {
    const value = recipe();
    const request = value.requests[0]!;
    const saved = setCodeTarget(value, request.id, { ...region, lambda });
    const parsed = parseRecipe(saved);
    expect(parsed).toEqual(saved);
    const regions = new Map([[request.id, [region.centre]]]);
    expect(objectiveSpec(parsed, regions).requests[0]!.respond!.target).toEqual({ kind: "region", codes: [region.centre], lambda });
  });

  it("requires distinct anchors and rejects a zero target at any painted cell", () => {
    let value = recipe();
    const id = value.requests[0]!.id;
    value = setCodeTarget(value, id, path);
    expect(validateRecipe(setPathAnchor(value, id, 1, 0)).join()).toContain("different cells");
    value = setCodeTarget(value, id, { ...path, codes: [[1, 0, 0], [-1, 0, 0]] });
    expect(validateRecipe(value).join()).toContain("at a painted cell");
    expect(() => parseRecipe(setCodeTarget(value, id, { ...path, anchors: [-1, 1] }))).toThrow("endpoint cells");
  });

  it("resets a palette request to one block and cannot add address blocks", () => {
    let value = recipe();
    const request = value.requests[0]!;
    request.respondLike.alsoBlocks = [{ block: 3, code: [1, 1, 1] }];
    value = setCodeTarget(value, request.id, region);
    expect(value.requests[0]!.respondLike.alsoBlocks).toEqual([]);
    expect(setCodeBlockCount(value, request.id, 2, null)).toBe(value);
    const prefix = recipe();
    prefix.requests[0]!.respondLike.source = { imageId: 7, role: "cls", slot: 0 };
    expect(setCodeTarget(prefix, prefix.requests[0]!.id, path)).toBe(prefix);
  });
});

describe("target geometry and engine contracts", () => {
  it("projects the grid position and clamps before interpolation", () => {
    const target = { ...path, anchors: [1, 3] as [number, number] };
    expect([0, 1, 2, 3, 4, 18].map((cell) => pathCode(target, cell)[0])).toEqual([2, 2, 3, 4, 4, 3]);
  });

  it("selects on unscaled codes and only then multiplies the target set", () => {
    expect(regionCodes(region, [[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]], 2)).toEqual([[2, 0, 0], [4, 0, 0], [6, 0, 0]]);
    expect(() => regionCodes(region, [[5, 0, 0]], 1)).toThrow("no recorded");
    expect(() => regionCodes(region, Array.from({ length: 4097 }, () => [2, 0, 0]), 1)).toThrow("4096");
  });

  it("scales every address code and path endpoint in the engine spec", () => {
    let value = recipe();
    const id = value.requests[0]!.id;
    value.requests[0]!.respondLike.alsoBlocks = [{ block: 3, code: [1, 2, 3] }];
    value = setCodeRadius(value, id, 2);
    expect(objectiveSpec(value).requests.map((request) => request.respond!.code)).toEqual([[4, 0, 0], [2, 4, 6]]);
    const next = setCodeTarget(value, id, path);
    expect(probeSpecs(next)[0]!.target).toEqual({ ...path, codes: [[4, 0, 0], [8, 0, 0]] });
    expect(sameObjective(objectiveSpec(value), objectiveSpec(next))).toBe(false);
    expect(sameCodeTarget(path, { ...path, anchors: [0, 3] })).toBe(false);
  });

  it("uses engine per-cell normalizers for the path match map", () => {
    const match = matchMap({ requestId: 1, slots: new Uint16Array([5, 6]), codes: new Float32Array(6), errors: new Float32Array([1, 1]), normalizers: new Float32Array([4, 9]) }, [2, 0, 0]);
    expect(match.slice(0, 2)).toEqual([0.25, 1 / 9]);
  });

  it("takes each published patch token once and ignores prefix tokens and sample weights", () => {
    const point = { token: { imageId: 1, role: "patch" as const, slot: 5 }, code: [1, 2, 3] as [number, number, number], weight: 0.1 };
    const cloud: CloudPoint[] = [point, point, { ...point, token: { imageId: 1, role: "cls", slot: 0 } }];
    expect(regionSource(cloud)).toEqual([point]);
  });
});
