import { describe, expect, test } from "vitest";
import { CELLS, MOTION_OFF, OPTIMIZER_BEFORE_FORMAT_5, RECIPE_DEFAULTS, patchSlot, type Area, type Recipe, type Request } from "../recipe";
import {
  ADDRESS_ID_STRIDE,
  editableCells,
  foldAddressTerms,
  neededBlocks,
  neededImages,
  objectiveSpec,
  probeSpecs,
  sameObjective,
  sameProbes,
} from "./objective";

function painted(...cells: number[]): Area {
  const where = Array<number>(CELLS).fill(0);
  for (const cell of cells) where[cell] = 100;
  return where;
}

function request(id: number, overrides: Partial<Request> = {}): Request {
  return {
    id,
    block: 100,
    respondLike: {
      enabled: true,
      weight: RECIPE_DEFAULTS.respondLikeWeight,
      source: { imageId: 3106516868104010, role: "patch", slot: patchSlot(5, 9) },
      code: [-4.8, -1.9, -2.2],
      where: painted(17),
      alsoBlocks: [], target: { kind: "point" }, radius: 1,
    },
    lookLike: {
      enabled: true,
      weight: 1,
      references: [{ token: { imageId: 8878176028456224, role: "patch", slot: 229 }, source: Array(CELLS).fill(true) }],
      where: painted(17, 33),
    },
    ...overrides,
  };
}

function recipe(requests: Request[]): Recipe {
  return {
    format: 7,
    release: "pass-003",
    seed: 0,
    requests,
    protect: Array(CELLS).fill(false),
    rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: true, weight: 0 } },
    motion: MOTION_OFF,
    optimizer: OPTIMIZER_BEFORE_FORMAT_5,
  };
}

describe("objective spec", () => {
  test("holds only active terms", () => {
    const off = request(2, { lookLike: { enabled: false, weight: 1, references: [], where: painted() } });
    off.respondLike.enabled = false;
    const spec = objectiveSpec(recipe([request(1), off]));
    expect(spec.requests.map((r) => r.id)).toEqual([1]);
    expect(spec.tv).toBeNull();
    expect(spec.l2).toBeNull(); // Enabled with weight 0 is absent too.
  });

  test("each term carries its own area", () => {
    const spec = objectiveSpec(recipe([request(1)]));
    expect(spec.requests[0].respond?.where).toEqual(painted(17));
    expect(spec.requests[0].look?.where).toEqual(painted(17, 33));
    expect(probeSpecs(recipe([request(1)]))[0].where).toEqual(painted(17));
  });

  test("a storage request carries no area for its code", () => {
    const storage = request(1);
    storage.respondLike.source = { imageId: 1, role: "storage", slot: 2 };
    storage.respondLike.where = painted();
    const spec = objectiveSpec(recipe([storage]));
    expect(spec.requests[0].respond?.where).toBeNull();
    expect(spec.requests[0].look?.where).toEqual(storage.lookLike.where);
  });

  test("edits of an inactive term do not change the objective; active edits do", () => {
    const base = recipe([request(1)]);
    const inactive = structuredClone(base);
    inactive.rules.tv.weight = 0.5; // Still disabled.
    inactive.seed = 7; // The seed is not part of the objective.
    expect(sameObjective(objectiveSpec(base), objectiveSpec(inactive))).toBe(true);

    const disabledCode = structuredClone(base);
    disabledCode.requests[0].respondLike.enabled = false;
    const disabledCodeEdited = structuredClone(disabledCode);
    disabledCodeEdited.requests[0].respondLike.code = [1, 2, 3];
    expect(sameObjective(objectiveSpec(disabledCode), objectiveSpec(disabledCodeEdited))).toBe(true);
    // The probe still follows the code, without touching the objective.
    expect(sameProbes(probeSpecs(disabledCode), probeSpecs(disabledCodeEdited))).toBe(false);

    const respondArea = structuredClone(base);
    respondArea.requests[0].respondLike.where = painted(17, 18);
    expect(sameObjective(objectiveSpec(base), objectiveSpec(respondArea))).toBe(false);
    expect(sameProbes(probeSpecs(base), probeSpecs(respondArea))).toBe(false);
    const lookArea = structuredClone(base);
    lookArea.requests[0].lookLike.where = painted(17);
    expect(sameObjective(objectiveSpec(base), objectiveSpec(lookArea))).toBe(false);
    expect(sameProbes(probeSpecs(base), probeSpecs(lookArea))).toBe(true);
    const window = structuredClone(base);
    window.requests[0].lookLike.references[0].source[0] = false;
    expect(sameObjective(objectiveSpec(base), objectiveSpec(window))).toBe(false);
  });

  test("lists the blocks and reference images the engine must load", () => {
    const second = request(2, { block: 7 });
    second.respondLike.enabled = false;
    const spec = recipe([request(1), second]);
    expect(neededBlocks(objectiveSpec(spec), probeSpecs(spec)).sort((a, b) => a - b)).toEqual([7, 100]);
    expect(neededImages(objectiveSpec(spec))).toEqual([8878176028456224]);
  });

  test("protected cells become zero bytes", () => {
    const spec = recipe([]);
    spec.protect[3] = true;
    const cells = editableCells(spec);
    expect(cells[3]).toBe(0);
    expect(cells[4]).toBe(1);
  });
});

describe("a request that asks k blocks (format 6)", () => {
  const others = [
    { block: 7, code: [1, 0, 0] as [number, number, number] },
    { block: 8, code: [0, 2, 0] as [number, number, number] },
  ];
  function asking(weight = 0.9): Request {
    const asked = request(1);
    asked.respondLike.weight = weight;
    asked.respondLike.alsoBlocks = others;
    return asked;
  }

  test("reaches the engine as k Code requests on the same cells, each at weight ÷ k", () => {
    const spec = objectiveSpec(recipe([asking(), request(2)]));
    expect(ADDRESS_ID_STRIDE).toBe(2 ** 24);
    expect(spec.requests.map((r) => r.id)).toEqual([1, 1 + 2 ** 24, 1 + 2 * 2 ** 24, 2]);
    const [own, second, third] = spec.requests;
    expect([own!.respond?.block, second!.respond?.block, third!.respond?.block]).toEqual([100, 7, 8]);
    expect([own!.respond?.code, second!.respond?.code, third!.respond?.code]).toEqual([[-4.8, -1.9, -2.2], [1, 0, 0], [0, 2, 0]]);
    for (const part of [own, second, third]) {
      expect(part!.respond?.weight).toBeCloseTo(0.3, 12);
      expect(part!.respond?.where).toEqual(painted(17));
      expect(part!.respond?.slot).toBe(patchSlot(5, 9));
    }
    // Appearance stays with the request itself.
    expect(own!.look?.where).toEqual(painted(17, 33));
    expect([second!.look, third!.look]).toEqual([null, null]);
  });

  test("asks one block exactly as format 5 did: the visitor's weight, unchanged", () => {
    const spec = objectiveSpec(recipe([request(1)]));
    expect(spec.requests).toHaveLength(1);
    expect(spec.requests[0]!.respond?.weight).toBe(RECIPE_DEFAULTS.respondLikeWeight);
  });

  test("with Code off, sends no request for the other blocks; with Appearance off, keeps the request's own id", () => {
    const codeOff = asking();
    codeOff.respondLike.enabled = false;
    const withoutCode = objectiveSpec(recipe([codeOff]));
    expect(withoutCode.requests.map((r) => [r.id, r.respond])).toEqual([[1, null]]);
    const lookOff = asking();
    lookOff.lookLike.enabled = false;
    expect(objectiveSpec(recipe([lookOff])).requests.map((r) => r.id)).toEqual([1, 1 + 2 ** 24, 1 + 2 * 2 ** 24]);
  });

  test("loads every asked block, probes the request's own block, and a new count is a new objective", () => {
    const spec = recipe([asking()]);
    expect(neededBlocks(objectiveSpec(spec), probeSpecs(spec)).sort((a, b) => a - b)).toEqual([7, 8, 100]);
    expect(probeSpecs(spec).map((probe) => [probe.requestId, probe.block])).toEqual([[1, 100]]);
    const fewer = structuredClone(spec);
    fewer.requests[0]!.respondLike.alsoBlocks = others.slice(0, 1);
    expect(sameObjective(objectiveSpec(spec), objectiveSpec(fewer))).toBe(false);
    expect(sameProbes(probeSpecs(spec), probeSpecs(fewer))).toBe(true);
  });

  test("folds the k blocks' terms into the request's one Code term: the mean raw, the summed weighted", () => {
    const third = 1 / 3;
    const engineTerms = [
      { id: "request:1:respond", raw: 0.3, weighted: third * 0.3 },
      { id: "request:1:look", raw: 0.5, weighted: 0.5 },
      { id: `request:${1 + 2 ** 24}:respond`, raw: 0.6, weighted: third * 0.6 },
      { id: `request:${1 + 2 * 2 ** 24}:respond`, raw: 0.9, weighted: third * 0.9 },
      { id: "request:2:respond", raw: 0.2, weighted: 0.4 },
      { id: "rules:tv", raw: 0.1, weighted: 0.05 },
    ];
    const folded = foldAddressTerms(engineTerms);
    expect(folded.map((term) => term.id)).toEqual(["request:1:respond", "request:1:look", "request:2:respond", "rules:tv"]);
    expect(folded[0]!.raw).toBeCloseTo(0.6, 12);
    // The visitor's weight (1) times the folded raw.
    expect(folded[0]!.weighted).toBeCloseTo(0.6, 12);
    expect(folded.slice(1)).toEqual([engineTerms[1], engineTerms[4], engineTerms[5]]);
    // One block per request: the terms pass with the same values.
    expect(foldAddressTerms([engineTerms[0]!, engineTerms[4]!])).toEqual([engineTerms[0], engineTerms[4]]);
  });
});
