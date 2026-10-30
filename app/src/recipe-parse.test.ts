import { describe, expect, it } from "vitest";
import { CELLS, MAX_REQUEST_ID, MAX_ZOOM_PER_UPDATE, MOTION_OFF, OPTIMIZER_BEFORE_FORMAT_5, OPTIMIZER_STEPS, validateRecipe } from "./recipe";
import type { OptimizerStep, Recipe } from "./recipe";
import { parseRecipe, recipeUpgradedFrom } from "./recipe-parse";

const field = (...chosen: number[]) => cellsIn(...chosen).map((inside) => inside ? 100 : 0);
const cellsIn = (...chosen: number[]) => Array.from({ length: CELLS }, (_, cell) => chosen.includes(cell));

function recipe(): Recipe {
  const token = { imageId: 7, role: "patch" as const, slot: 141 };
  return {
    format: 7,
    release: "pass-003",
    seed: 1,
    requests: [
      {
        id: 1,
        block: 6,
        respondLike: { enabled: true, weight: 0.3, source: token, code: [1, 0, 0], where: field(136), alsoBlocks: [], target: { kind: "point" }, radius: 1 },
        lookLike: { enabled: true, weight: 1, references: [{ token, source: cellsIn(136) }], where: field(136, 137) },
      },
    ],
    protect: Array.from({ length: CELLS }, () => false),
    rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: false, weight: 0 } },
    motion: { zoomPerUpdate: 0.01 },
    optimizer: { ...OPTIMIZER_BEFORE_FORMAT_5 },
  };
}

describe("parseRecipe at untrusted boundaries", () => {
  it("returns a complete recipe unchanged and drops unknown fields", () => {
    expect(parseRecipe(recipe())).toEqual(recipe());
    expect(parseRecipe({ ...recipe(), extra: "ignored" })).toEqual(recipe());
  });

  it("refuses the shape validateRecipe cannot see: missing rules and string protect cells", () => {
    // validateRecipe reports nothing for this shape; the parser must refuse it.
    const malformed = { ...recipe(), rules: undefined, protect: Array.from({ length: CELLS }, () => "no") };
    expect(() => parseRecipe(malformed)).toThrow("recipe.rules: expected an object");
    expect(() => parseRecipe({ ...recipe(), protect: Array.from({ length: CELLS }, () => "no") })).toThrow(
      "recipe.protect[0]: expected true or false",
    );
  });

  it("names the first wrong field in nested requests", () => {
    const short = recipe();
    short.requests[0]!.lookLike.where = [100];
    expect(() => parseRecipe(short)).toThrow("recipe.requests[0].lookLike.where: expected 256 cells");
    const weighted = recipe();
    (weighted.requests[0]!.respondLike as { where: unknown }).where = Array.from({ length: CELLS }, () => true);
    expect(() => parseRecipe(weighted)).toThrow("recipe.requests[0].respondLike.where[0]: expected an integer");
    const badCode = recipe();
    (badCode.requests[0]!.respondLike as { code: unknown }).code = [1, 2];
    expect(() => parseRecipe(badCode)).toThrow("recipe.requests[0].respondLike.code: expected 3 numbers");
    const badToken = recipe();
    badToken.requests[0]!.respondLike.source = { imageId: 1, role: "cls", slot: 9 };
    expect(() => parseRecipe(badToken)).toThrow("recipe.requests[0].respondLike.source: not a valid token");
    expect(() => parseRecipe({ ...recipe(), seed: "1" })).toThrow("recipe.seed: expected an integer");
  });

  it("keeps an incomplete draft for validateRecipe to report", () => {
    const draft = recipe();
    draft.requests[0]!.lookLike.references = [];
    expect(parseRecipe(draft)).toEqual(draft);
    expect(validateRecipe(parseRecipe(draft))).toEqual(["constraint 1: Look like is on but has no references"]);
  });

  it("refuses a format it does not know", () => {
    expect(() => parseRecipe({ ...recipe(), format: 8 })).toThrow("recipe.format: unsupported image-editing configuration format 8");
  });
});

describe("format 2 upgrade", () => {
  const token = { imageId: 7, role: "patch" as const, slot: 141 };

  it("drops the Whole canvas term, on or off, and the recipe is complete without it", () => {
    const saved = { ...legacyRecipe(2), wholeCanvas: { enabled: true, weight: 1, references: [token] } };
    const upgraded = parseRecipe(saved);
    expect(upgraded).toEqual(recipe());
    expect("wholeCanvas" in upgraded).toBe(false);
    expect(validateRecipe(upgraded)).toEqual([]);
  });

  it("marks a recipe whose image was made with an active Whole canvas, and not one whose term was off", () => {
    const active = { enabled: true, weight: 1, references: [token] };
    expect(recipeUpgradedFrom({ ...recipe(), format: 2, wholeCanvas: active })).toBe(2);
    expect(recipeUpgradedFrom({ ...recipe(), format: 2, wholeCanvas: { ...active, enabled: false } })).toBe(3);
    expect(recipeUpgradedFrom({ ...recipe(), format: 2, wholeCanvas: { ...active, weight: 0 } })).toBe(3);
    expect(recipeUpgradedFrom({ ...recipe(), format: 2, wholeCanvas: { ...active, references: [] } })).toBe(3);
    // Earlier marks take precedence; current recipes and junk are unmarked.
    expect(recipeUpgradedFrom({ ...recipe(), format: 1 })).toBe(1);
    expect(recipeUpgradedFrom(recipe())).toBeUndefined();
    expect(recipeUpgradedFrom("recipe")).toBeUndefined();
  });
});

describe("format 1 upgrade", () => {
  /** A format-1 recipe: one weight field per request, shared by both terms. */
  function format1() {
    const patch = { imageId: 7, role: "patch" as const, slot: 141 };
    const cls = { imageId: 8, role: "cls" as const, slot: 0 };
    const weights = Array.from({ length: CELLS }, (_, cell) => (cell === 136 ? 1 : cell === 137 ? 0.25 : 0));
    const term = (source: typeof patch | typeof cls) => ({
      where: weights,
      respondLike: { enabled: true, weight: 0.3, source, code: [1, 0, 0] },
      lookLike: { enabled: true, weight: 1, references: [{ token: source, source: cellsIn(136) }] },
    });
    return {
      format: 1,
      release: "pass-003",
      seed: 1,
      requests: [
        { id: 1, block: 6, ...term(patch) },
        { id: 2, block: 9, ...term(cls) },
      ],
      wholeCanvas: { enabled: false, weight: 1, references: [] },
      protect: Array.from({ length: CELLS }, () => false),
      rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: false, weight: 0 } },
    };
  }

  it("copies the cells with weight above 0 into both areas of a patch request", () => {
    const upgraded = parseRecipe(format1());
    expect(upgraded.format).toBe(7);
    expect(upgraded.motion).toEqual(MOTION_OFF);
    expect(upgraded.optimizer).toEqual(OPTIMIZER_BEFORE_FORMAT_5);
    const [patch] = upgraded.requests;
    expect(patch!.respondLike.where).toEqual(field(136, 137));
    expect(patch!.lookLike.where).toEqual(field(136, 137));
    expect("where" in patch!).toBe(false);
    expect(patch!.respondLike.weight).toBe(0.3);
    expect(validateRecipe(upgraded)).toEqual([]);
  });

  it("stores an empty Respond like area for a CLS or storage request, which measures its own slot", () => {
    const [, cls] = parseRecipe(format1()).requests;
    expect(cls!.respondLike.where).toEqual(field());
    expect(cls!.lookLike.where).toEqual(field(136, 137));
  });

  it("gives the two areas separate arrays, so painting one does not change the other", () => {
    const [patch] = parseRecipe(format1()).requests;
    expect(patch!.respondLike.where).not.toBe(patch!.lookLike.where);
  });

  it("still names a wrong format-1 field", () => {
    const short = format1();
    short.requests[0]!.where = [1];
    expect(() => parseRecipe(short)).toThrow("recipe.requests[0].where: expected 256 cells");
  });
});

describe("motion", () => {
  it("keeps the zoom a recipe carries", () => {
    expect(parseRecipe(recipe()).motion).toEqual({ zoomPerUpdate: 0.01 });
  });

  it("fills a missing motion with no motion, so earlier format-2 saves open", () => {
    const { motion: _, ...earlier } = recipe();
    const parsed = parseRecipe(earlier);
    expect(parsed.motion).toEqual(MOTION_OFF);
    expect(validateRecipe(parsed)).toEqual([]);
  });

  it("refuses a motion that is not an object with a number, and leaves the range to validateRecipe", () => {
    expect(() => parseRecipe({ ...recipe(), motion: 0.01 })).toThrow("recipe.motion: expected an object");
    expect(() => parseRecipe({ ...recipe(), motion: { zoomPerUpdate: "fast" } })).toThrow("recipe.motion.zoomPerUpdate: expected a finite number");
    const tooFast = parseRecipe({ ...recipe(), motion: { zoomPerUpdate: 1 } });
    expect(validateRecipe(tooFast)).toEqual([`zoom per optimizer update must be between 0 and ${MAX_ZOOM_PER_UPDATE}`]);
  });
});

/** A recipe as an earlier format saved it: Boolean fields, and no optimizer before format 5. */
function legacyRecipe(format = 3) {
  const { optimizer: _, ...current } = recipe();
  return {
    ...current,
    format,
    requests: current.requests.map((request) => ({
      ...request,
      respondLike: { ...request.respondLike, where: request.respondLike.where.map(Boolean) },
      lookLike: { ...request.lookLike, where: request.lookLike.where.map(Boolean) },
    })),
  };
}

describe("format 4 strengths", () => {
  it("upgrades binary fields without changing references, Protect or settings", () => {
    expect(parseRecipe(legacyRecipe())).toEqual(recipe());
    expect(recipeUpgradedFrom(legacyRecipe())).toBe(3);
    const codeOnly = legacyRecipe();
    codeOnly.requests[0]!.lookLike.enabled = false;
    expect(recipeUpgradedFrom(codeOnly)).toBeUndefined();
  });

  it("preserves each integer strength, including a full field", () => {
    const painted = recipe();
    painted.requests[0]!.respondLike.where = Array.from({ length: CELLS }, (_, cell) => cell % 101);
    painted.requests[0]!.lookLike.where.fill(100);
    expect(parseRecipe(JSON.parse(JSON.stringify(painted)))).toEqual(painted);
  });

  it.each([true, false, -1, 101, 0.5, NaN, Infinity, "50"])("refuses malformed strength %s", (value) => {
    const painted = recipe();
    (painted.requests[0]!.respondLike.where as unknown[])[7] = value;
    expect(() => parseRecipe(painted)).toThrow("recipe.requests[0].respondLike.where[7]");
  });

  it("canonicalizes unused prefix Code fields", () => {
    const prefix = legacyRecipe();
    prefix.requests[0]!.respondLike.source = { imageId: 7, role: "cls" as "patch", slot: 0 };
    expect(parseRecipe(prefix).requests[0]!.respondLike.where).toEqual(field());
  });
});

describe("in-memory field validation", () => {
  it.each([true, -1, 101, 1.5, NaN])("rejects an invalid editor strength %s", (value) => {
    const painted = recipe();
    (painted.requests[0]!.lookLike.where as unknown[])[2] = value;
    expect(validateRecipe(painted)).toContain("constraint 1: Appearance strengths must be integers between 0 and 100");
  });

  it("keeps an enabled empty Code field invalid even at zero weight", () => {
    const painted = recipe();
    painted.requests[0]!.respondLike.where.fill(0);
    painted.requests[0]!.respondLike.weight = 0;
    expect(validateRecipe(painted)).toContain("constraint 1: Respond like is on but no area is painted");
  });
});

describe("format 5 optimizer", () => {
  const chosen = { step: 0.1, scale: "coarse", robustView: true } as const;

  it("keeps the step, scale and robust view a recipe carries, and drops unknown optimizer fields", () => {
    const written = { ...recipe(), optimizer: { ...chosen, momentum: 0 } };
    expect(parseRecipe(JSON.parse(JSON.stringify(written))).optimizer).toEqual(chosen);
    for (const step of OPTIMIZER_STEPS) {
      expect(parseRecipe({ ...recipe(), optimizer: { ...chosen, step } }).optimizer.step).toBe(step);
    }
  });

  it("gives a format-4 recipe the step it ran with, and no migration mark", () => {
    const { optimizer: _, ...format4 } = { ...recipe(), format: 4 };
    const upgraded = parseRecipe(format4);
    expect(upgraded).toEqual(recipe());
    expect(upgraded.optimizer).toEqual({ step: 0.025, scale: "even", robustView: false });
    expect(recipeUpgradedFrom(format4)).toBeUndefined();
    expect(validateRecipe(upgraded)).toEqual([]);
  });

  it("gives every upgrade its own optimizer object", () => {
    const { optimizer: _, ...format4 } = { ...recipe(), format: 4 };
    expect(parseRecipe(format4).optimizer).not.toBe(parseRecipe(format4).optimizer);
    expect(parseRecipe(format4).optimizer).not.toBe(OPTIMIZER_BEFORE_FORMAT_5);
  });

  it("refuses a format-5 recipe without an optimizer", () => {
    const { optimizer: _, ...missing } = recipe();
    expect(() => parseRecipe(missing)).toThrow("recipe.optimizer: expected an object");
  });

  it.each([0.07, 0.2, 0, "0.05", NaN, null])("refuses step %s, which is not one of the four positions", (step) => {
    expect(() => parseRecipe({ ...recipe(), optimizer: { ...chosen, step } })).toThrow(
      "recipe.optimizer.step: expected one of 0.0125, 0.025, 0.05, 0.1",
    );
  });

  it("refuses an unknown scale and a robust view that is not true or false", () => {
    expect(() => parseRecipe({ ...recipe(), optimizer: { ...chosen, scale: "fine" } })).toThrow(
      "recipe.optimizer.scale: expected one of even, coarse",
    );
    expect(() => parseRecipe({ ...recipe(), optimizer: { ...chosen, robustView: 1 } })).toThrow(
      "recipe.optimizer.robustView: expected true or false",
    );
  });

  it("reports an in-memory step or scale outside the positions", () => {
    const stray = { ...recipe(), optimizer: { step: 0.07 as OptimizerStep, scale: "fine" as "even", robustView: false } };
    expect(validateRecipe(stray)).toEqual(["the step must be one of 0.0125, 0.025, 0.05, 0.1", "the scale must be one of even, coarse"]);
  });
});

describe("format 6 other blocks (the sparsity dial)", () => {
  const others = [
    { block: 9, code: [0, 1, 0] as [number, number, number] },
    { block: 12, code: [0, 0, 2] as [number, number, number] },
  ];
  /** The recipe with its request asking `alsoBlocks` too. */
  function asking(alsoBlocks: { block: number; code: [number, number, number] }[]): Recipe {
    const asked = recipe();
    asked.requests[0]!.respondLike.alsoBlocks = alsoBlocks;
    return asked;
  }
  /** The recipe as format 5 saved it: no other blocks. */
  function format5(): unknown {
    const saved = JSON.parse(JSON.stringify({ ...recipe(), format: 5 }));
    delete saved.requests[0].respondLike.alsoBlocks;
    return saved;
  }

  it("upgrades a format-5 recipe to its own block alone, with nothing else changed and no migration mark", () => {
    expect(parseRecipe(format5())).toEqual(recipe());
    expect(recipeUpgradedFrom(format5())).toBeUndefined();
    // A format-5 recipe cannot carry other blocks: a stray field is not read.
    const stray = format5() as { requests: { respondLike: Record<string, unknown> }[] };
    stray.requests[0]!.respondLike.alsoBlocks = others;
    expect(parseRecipe(stray).requests[0]!.respondLike.alsoBlocks).toEqual([]);
  });

  it("keeps a format-6 request's other blocks in their order", () => {
    const written = JSON.parse(JSON.stringify({ ...asking(others), format: 6 }));
    expect(parseRecipe(written)).toEqual(asking(others));
    expect(validateRecipe(parseRecipe(written), { blocks: 16384 })).toEqual([]);
  });

  it("names a wrong other block", () => {
    const missing = JSON.parse(JSON.stringify(recipe()));
    delete missing.requests[0].respondLike.alsoBlocks;
    expect(() => parseRecipe(missing)).toThrow("recipe.requests[0].respondLike.alsoBlocks: expected an array");
    expect(() => parseRecipe(asking([{ block: "9" as unknown as number, code: [0, 1, 0] }]))).toThrow(
      "recipe.requests[0].respondLike.alsoBlocks[0].block: expected an integer",
    );
    expect(() => parseRecipe(asking([{ block: 9, code: [0, 1] as unknown as [number, number, number] }]))).toThrow(
      "recipe.requests[0].respondLike.alsoBlocks[0].code: expected 3 numbers",
    );
  });

  it("allows 32 blocks in all, each once, inside the dictionary, each with a direction while Code is on", () => {
    const blocks = (count: number) => Array.from({ length: count }, (_, index) => ({ block: 100 + index, code: [1, 0, 0] as [number, number, number] }));
    expect(validateRecipe(asking(blocks(31)), { blocks: 16384 })).toEqual([]);
    expect(validateRecipe(asking(blocks(32)), { blocks: 16384 })).toEqual(["constraint 1: a constraint uses at most 32 basis groups"]);
    expect(validateRecipe(asking([{ block: 6, code: [1, 0, 0] }]))).toEqual(["constraint 1: basis group 6 is used twice"]);
    expect(validateRecipe(asking([others[0]!, others[0]!]))).toEqual(["constraint 1: basis group 9 is used twice"]);
    expect(validateRecipe(asking([{ block: 16384, code: [1, 0, 0] }]), { blocks: 16384 })).toEqual(["constraint 1: basis group 16384 is outside the basis collection"]);
    const flat = asking([{ block: 9, code: [0, 0, 0] }]);
    expect(validateRecipe(flat)).toEqual(["constraint 1: the response vector in basis group 9 has no direction"]);
    flat.requests[0]!.respondLike.enabled = false;
    expect(validateRecipe(flat)).toEqual([]);
  });

  it("keeps request ids below 2^24, so the engine's ids for the other blocks are free", () => {
    expect(MAX_REQUEST_ID).toBe(2 ** 24 - 1);
    const high = recipe();
    high.requests[0]!.id = 2 ** 24;
    expect(validateRecipe(high)).toEqual([`constraint ${2 ** 24}: id must be an integer between 0 and ${2 ** 24 - 1}`]);
  });
});
