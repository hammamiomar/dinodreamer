import { describe, expect, it } from "vitest";
import { CELLS, MAX_ZOOM_PER_UPDATE, OPTIMIZER_DEFAULT, RECIPE_DEFAULTS, patchSlot, validateRecipe, type OptimizerScale, type OptimizerStep, type Recipe, type Token } from "../../recipe";
import {
  CANVAS_CENTRE,
  addReference,
  applyAreaStroke,
  applyProtectStroke,
  applyRequestStroke,
  areaSize,
  cellIndex,
  codeBlockCount,
  combineStroke,
  createPaintedRequest,
  createRecipe,
  createRequest,
  defaultAreaCentre,
  getTerm,
  removeReference,
  removeRequest,
  retargetRequest,
  setCodeBlockCount,
  setReferences,
  setSeed,
  setSourceWindow,
  setOptimizer,
  setZoomPerUpdate,
  percentOfZoom,
  zoomFromPercent,
  setTermEnabled,
  setTermWeight,
  squareArea,
  termIds,
  type Stroke,
} from "./model";

const RELEASE = "pass-003";

function patchToken(imageId: number, row: number, column: number): Token {
  return { imageId, role: "patch", slot: patchSlot(row, column) };
}

function handoff(token: Token, block = 1398) {
  return { token, block, code: [0.4, -0.2, 0.9] as [number, number, number] };
}

function area(cells: number[]): number[] {
  const result = new Array<number>(CELLS).fill(0);
  for (const cell of cells) result[cell] = 100;
  return result;
}

function oneRequest(token: Token = patchToken(7, 2, 8)): Recipe {
  return createRequest(createRecipe(RELEASE), handoff(token));
}

function cellsOf(where: (number | boolean)[]): number[] {
  return where.flatMap((inside, cell) => (inside ? [cell] : []));
}

describe("createRequest", () => {
  it("paints the token's own cell and eight neighbours into both areas, with both terms on", () => {
    const recipe = oneRequest(patchToken(7, 2, 8));
    const [request] = recipe.requests;

    expect(request.id).toBe(1);
    expect(request.block).toBe(1398);
    const square = cellsOf(squareArea({ row: 2, column: 8 }, 1));
    expect(cellsOf(request.respondLike.where)).toEqual(square);
    expect(cellsOf(request.lookLike.where)).toEqual(square);
    expect(areaSize(request.respondLike.where)).toBe(9);
    expect(recipe.format).toBe(7);
    expect(recipe.optimizer).toEqual(OPTIMIZER_DEFAULT);

    expect(request.respondLike).toMatchObject({ enabled: true, weight: RECIPE_DEFAULTS.respondLikeWeight });
    expect(request.respondLike.code).toEqual([0.4, -0.2, 0.9]);
    expect(request.lookLike).toMatchObject({ enabled: true, weight: RECIPE_DEFAULTS.lookLikeWeight });
    expect(request.lookLike.references).toHaveLength(1);
    expect(request.lookLike.references[0].token.imageId).toBe(7);
    expect(request.lookLike.references[0].source.filter(Boolean)).toHaveLength(9);
    expect(validateRecipe(recipe)).toEqual([]);
  });

  it("lands at the drop cell, not the token's cell, and clips at the edge", () => {
    const recipe = createRequest(createRecipe(RELEASE), handoff(patchToken(7, 2, 8)), { row: 0, column: 15 });
    const [request] = recipe.requests;
    expect(cellsOf(request.respondLike.where)).toEqual([14, 15, 30, 31]);
    expect(cellsOf(request.lookLike.where)).toEqual([14, 15, 30, 31]);
    // The source window stays around the token in its own picture.
    expect(request.lookLike.references[0].source[cellIndex({ row: 2, column: 8 })]).toBe(true);
  });

  it("gives a prefix token an empty Respond like area, a Look like area at the centre and a whole-view source", () => {
    const cls: Token = { imageId: 9, role: "cls", slot: 0 };
    const recipe = oneRequest(cls);
    const [request] = recipe.requests;
    expect(areaSize(request.respondLike.where)).toBe(0);
    expect(request.lookLike.where[cellIndex(CANVAS_CENTRE)]).toBe(100);
    expect(areaSize(request.lookLike.where)).toBe(9);
    expect(request.lookLike.references[0].source.every(Boolean)).toBe(true);
    expect(validateRecipe(recipe)).toEqual([]);
  });

  it("previews the area a click would make where createRequest puts it: the token's cell, or the centre for a prefix token", () => {
    expect(defaultAreaCentre(patchToken(7, 2, 8))).toEqual({ row: 2, column: 8 });
    expect(defaultAreaCentre({ imageId: 9, role: "cls", slot: 0 })).toEqual(CANVAS_CENTRE);
    const [request] = oneRequest(patchToken(7, 2, 8)).requests;
    expect(cellsOf(request.lookLike.where)).toEqual(cellsOf(squareArea(defaultAreaCentre(patchToken(7, 2, 8)), 1)));
  });

  it("puts a dropped prefix token's Look like area at the drop cell", () => {
    const storage: Token = { imageId: 9, role: "storage", slot: 2 };
    const [request] = createRequest(createRecipe(RELEASE), handoff(storage), { row: 5, column: 5 }).requests;
    expect(cellsOf(request.lookLike.where)).toEqual(cellsOf(squareArea({ row: 5, column: 5 }, 1)));
    expect(areaSize(request.respondLike.where)).toBe(0);
  });

  it("starts the references with the source picture, then the block's strong examples, distinct pictures, eight in all", () => {
    // Ten examples, one of them the source's own picture again: the source stays first, the repeat is skipped, eight remain.
    const examples = [patchToken(7, 0, 0), ...Array.from({ length: 9 }, (_, index) => patchToken(100 + index, 4, 4))];
    const recipe = createRequest(createRecipe(RELEASE), { ...handoff(patchToken(7, 2, 8)), strongExamples: examples });
    const references = recipe.requests[0].lookLike.references;
    expect(references.map((reference) => reference.token.imageId)).toEqual([7, 100, 101, 102, 103, 104, 105, 106]);
    // Each reference's window is around its own token: the source's at (2, 8), an example's at (4, 4).
    expect(references[0].source[cellIndex({ row: 2, column: 8 })]).toBe(true);
    expect(references[1].source[cellIndex({ row: 4, column: 4 })]).toBe(true);
    expect(references[1].source.filter(Boolean)).toHaveLength(9);
    expect(validateRecipe(recipe)).toEqual([]);
  });

  it("gives a prefix token's examples whole-view windows", () => {
    const cls: Token = { imageId: 9, role: "cls", slot: 0 };
    const recipe = createRequest(createRecipe(RELEASE), { ...handoff(cls), strongExamples: [{ imageId: 10, role: "cls", slot: 0 }] });
    const references = recipe.requests[0].lookLike.references;
    expect(references.map((reference) => reference.token.imageId)).toEqual([9, 10]);
    expect(references.every((reference) => reference.source.every(Boolean))).toBe(true);
  });

  it("numbers requests in order", () => {
    const first = oneRequest(patchToken(7, 2, 8));
    const second = createRequest(first, handoff(patchToken(11, 5, 5)));
    expect(second.requests.map((request) => request.id)).toEqual([1, 2]);
  });

  it("stops at the maximum number of requests and returns the same recipe", () => {
    let recipe = createRecipe(RELEASE);
    for (let index = 0; index < RECIPE_DEFAULTS.maxRequests; index++) {
      recipe = createRequest(recipe, handoff(patchToken(index, 3, 3)));
    }
    expect(createRequest(recipe, handoff(patchToken(99, 3, 3)))).toBe(recipe);
  });

  it("does not reuse the id of a removed request", () => {
    let recipe = oneRequest();
    recipe = createRequest(recipe, handoff(patchToken(11, 5, 5)));
    recipe = removeRequest(recipe, 1);
    recipe = createRequest(recipe, handoff(patchToken(12, 5, 5)));
    expect(recipe.requests.map((request) => request.id)).toEqual([2, 3]);
  });
});

describe("createPaintedRequest", () => {
  it("makes both areas the painted cells, as separate arrays, and a valid request", () => {
    const area = squareArea({ row: 4, column: 4 }, 0).map((inside) => inside ? 100 : 0);
    const recipe = createPaintedRequest(createRecipe(RELEASE), handoff(patchToken(7, 2, 8)), area);
    const [request] = recipe.requests;
    expect(request.respondLike.where).toEqual(area);
    expect(request.lookLike.where).toEqual(area);
    expect(request.respondLike.where).not.toBe(request.lookLike.where);
    expect(request.respondLike.where).not.toBe(area);
    expect(validateRecipe(recipe)).toEqual([]);
  });

  it("refuses an empty area and a full creation", () => {
    const empty = createRecipe(RELEASE);
    expect(createPaintedRequest(empty, handoff(patchToken(7, 2, 8)), new Array<number>(CELLS).fill(0))).toBe(empty);
    let full = createRecipe(RELEASE);
    for (let index = 0; index < RECIPE_DEFAULTS.maxRequests; index++) full = createRequest(full, handoff(patchToken(index, 3, 3)));
    expect(createPaintedRequest(full, handoff(patchToken(99, 3, 3)), squareArea({ row: 1, column: 1 }, 1).map((inside) => inside ? 100 : 0))).toBe(full);
  });
});

describe("area strokes", () => {
  const paint = (cells: number[]): Stroke => ({ mode: "paint", cells: area(cells) });
  const erase = (cells: number[]): Stroke => ({ mode: "erase", cells: area(cells) });

  it("puts touched cells in with paint and takes them out with erase", () => {
    const where = area([0, 1]).map((inside) => inside ? 100 : 0);
    expect(cellsOf(combineStroke(where, paint([1, 2])))).toEqual([0, 1, 2]);
    expect(cellsOf(combineStroke(where, erase([1, 2])))).toEqual([0]);
  });

  it("returns the same area and recipe when a stroke changes nothing", () => {
    const recipe = oneRequest(patchToken(7, 2, 8));
    const where = recipe.requests[0].respondLike.where;
    const repaint = paint([cellIndex({ row: 2, column: 8 })]);
    expect(combineStroke(where, repaint)).toBe(where);
    expect(applyAreaStroke(recipe, 1, "respond", repaint)).toBe(recipe);
    expect(applyAreaStroke(recipe, 1, "look", erase([255]))).toBe(recipe);
    expect(applyAreaStroke(recipe, 42, "look", paint([0]))).toBe(recipe);
  });

  it("changes one term's area only", () => {
    const recipe = oneRequest(patchToken(7, 2, 8));
    const next = applyAreaStroke(recipe, 1, "look", paint([200]));
    const [before, after] = [recipe.requests[0], next.requests[0]];
    expect(after.lookLike.where[200]).toBe(100);
    expect(after.respondLike).toBe(before.respondLike);
    expect(after.lookLike.references).toBe(before.lookLike.references);

    const respond = applyAreaStroke(next, 1, "respond", erase([cellIndex({ row: 2, column: 8 })]));
    expect(areaSize(respond.requests[0].respondLike.where)).toBe(8);
    expect(respond.requests[0].lookLike).toBe(after.lookLike);
  });

  it("applies a stroke to one request only", () => {
    let recipe = oneRequest();
    recipe = createRequest(recipe, handoff(patchToken(11, 10, 10)));
    const next = applyAreaStroke(recipe, 2, "respond", paint([0]));
    expect(next.requests[0]).toBe(recipe.requests[0]);
    expect(next.requests[1].respondLike.where[0]).toBe(100);
  });

  it("never paints the Respond like area of a CLS or storage request", () => {
    const recipe = oneRequest({ imageId: 9, role: "cls", slot: 0 });
    expect(applyAreaStroke(recipe, 1, "respond", paint([0, 1, 2]))).toBe(recipe);
    expect(applyAreaStroke(recipe, 1, "look", paint([0])).requests[0].lookLike.where[0]).toBe(100);
  });

  it("makes erasing every cell of an active term a visible problem, not a silent default", () => {
    const recipe = oneRequest();
    const everything = erase(Array.from({ length: CELLS }, (_, cell) => cell));
    const noRespond = applyAreaStroke(recipe, 1, "respond", everything);
    expect(areaSize(noRespond.requests[0].respondLike.where)).toBe(0);
    expect(validateRecipe(noRespond)).toEqual(["constraint 1: Respond like is on but no area is painted"]);

    const noLook = applyAreaStroke(recipe, 1, "look", everything);
    expect(validateRecipe(noLook)).toEqual(["constraint 1: Look like is on but no area is painted"]);
  });
});

describe("applyRequestStroke", () => {
  it("paints and erases both areas of a request with one stroke, and returns the same recipe for no change", () => {
    const recipe = oneRequest(patchToken(7, 2, 8));
    const cells = new Array<number>(CELLS).fill(0);
    cells[cellIndex({ row: 10, column: 10 })] = 100;
    const painted = applyRequestStroke(recipe, 1, { mode: "paint", cells });
    expect(painted.requests[0].respondLike.where[cellIndex({ row: 10, column: 10 })]).toBe(100);
    expect(painted.requests[0].lookLike.where[cellIndex({ row: 10, column: 10 })]).toBe(100);
    expect(areaSize(painted.requests[0].respondLike.where)).toBe(10);
    expect(applyRequestStroke(painted, 1, { mode: "paint", cells })).toBe(painted);
    const erased = applyRequestStroke(painted, 1, { mode: "erase", cells: new Array<number>(CELLS).fill(100) });
    expect(areaSize(erased.requests[0].respondLike.where)).toBe(0);
    expect(areaSize(erased.requests[0].lookLike.where)).toBe(0);
    expect(applyRequestStroke(recipe, 9, { mode: "paint", cells })).toBe(recipe);
  });

  it("leaves a CLS request's Code area empty and paints its Appearance area", () => {
    const recipe = oneRequest({ imageId: 9, role: "cls", slot: 0 });
    const cells = new Array<number>(CELLS).fill(0);
    cells[3] = 100;
    const painted = applyRequestStroke(recipe, 1, { mode: "paint", cells });
    expect(areaSize(painted.requests[0].respondLike.where)).toBe(0);
    expect(painted.requests[0].lookLike.where[3]).toBe(100);
  });
});

describe("protect", () => {
  it("protects touched cells with paint and releases them with erase", () => {
    const recipe = createRecipe(RELEASE);
    const painted = applyProtectStroke(recipe, { mode: "paint", cells: area([3, 4]) });
    expect(cellsOf(painted.protect)).toEqual([3, 4]);

    const released = applyProtectStroke(painted, { mode: "erase", cells: area([3]) });
    expect(cellsOf(released.protect)).toEqual([4]);

    expect(applyProtectStroke(released, { mode: "erase", cells: area([3]) })).toBe(released);
  });
});

describe("references and source windows", () => {
  it("keeps the edited window of a picture that stays and defaults new ones", () => {
    let recipe = oneRequest(patchToken(7, 2, 8));
    const window = squareArea({ row: 0, column: 0 }, 0);
    recipe = setSourceWindow(recipe, 1, 7, window);
    recipe = setReferences(recipe, 1, [patchToken(5, 4, 4), patchToken(7, 2, 8)]);

    const [added, kept] = recipe.requests[0].lookLike.references;
    expect(added.token.imageId).toBe(5);
    expect(added.source.filter(Boolean)).toHaveLength(9);
    expect(kept.source).toEqual(window);
  });

  it("keeps references to distinct images and at most the maximum", () => {
    const tokens = Array.from({ length: 20 }, (_, index) => patchToken(index % 15, 1, 1));
    const recipe = setReferences(oneRequest(), 1, tokens);
    const ids = recipe.requests[0].lookLike.references.map((reference) => reference.token.imageId);
    expect(ids).toHaveLength(RECIPE_DEFAULTS.maxReferences);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ignores a duplicate picture and removes by image", () => {
    const recipe = oneRequest(patchToken(7, 2, 8));
    expect(addReference(recipe, 1, patchToken(7, 9, 9))).toBe(recipe);
    const removed = removeReference(recipe, 1, 7);
    expect(removed.requests[0].lookLike.references).toEqual([]);
  });

  it("refuses an empty source window", () => {
    const recipe = oneRequest(patchToken(7, 2, 8));
    expect(setSourceWindow(recipe, 1, 7, new Array<boolean>(CELLS).fill(false))).toBe(recipe);
  });

});

describe("terms", () => {
  it("lists terms with the protocol's ids", () => {
    let recipe = oneRequest();
    recipe = createRequest(recipe, handoff(patchToken(11, 10, 10)));
    expect(termIds(recipe)).toEqual([
      "request:1:respond",
      "request:1:look",
      "request:2:respond",
      "request:2:look",
      "rules:tv",
      "rules:l2",
    ]);
  });

  it("toggles and weights each term independently", () => {
    let recipe = oneRequest();
    recipe = setTermEnabled(recipe, "request:1:respond", false);
    recipe = setTermWeight(recipe, "request:1:look", 0.5);
    recipe = setTermEnabled(recipe, "rules:tv", true);
    recipe = setTermWeight(recipe, "rules:tv", 0.02);

    expect(getTerm(recipe, "request:1:respond")?.enabled).toBe(false);
    expect(getTerm(recipe, "request:1:look")?.weight).toBe(0.5);
    expect(recipe.rules.tv).toEqual({ enabled: true, weight: 0.02 });
    expect(recipe.rules.l2).toEqual({ enabled: false, weight: RECIPE_DEFAULTS.l2Weight });
    // The term object carries its sources along.
    expect(recipe.requests[0].lookLike.references).toHaveLength(1);
  });

  it("returns the same recipe for no-op, negative and unknown term edits", () => {
    const recipe = oneRequest();
    expect(setTermEnabled(recipe, "request:1:respond", true)).toBe(recipe);
    expect(setTermWeight(recipe, "request:1:respond", RECIPE_DEFAULTS.respondLikeWeight)).toBe(recipe);
    expect(setTermWeight(recipe, "request:1:respond", -1)).toBe(recipe);
    expect(setTermWeight(recipe, "request:1:respond", Number.NaN)).toBe(recipe);
    expect(setTermEnabled(recipe, "request:9:look", false)).toBe(recipe);
  });
});

describe("removeRequest and seed", () => {
  it("removes one request and returns the same recipe for an unknown id", () => {
    const recipe = createRequest(oneRequest(patchToken(7, 2, 8)), handoff(patchToken(11, 5, 5)));
    const removed = removeRequest(recipe, 1);
    expect(removed.requests.map((request) => request.id)).toEqual([2]);
    expect(removeRequest(removed, 1)).toBe(removed);
  });

  it("accepts only non-negative integer seeds", () => {
    const recipe = createRecipe(RELEASE, 1);
    expect(setSeed(recipe, 7).seed).toBe(7);
    expect(setSeed(recipe, 1)).toBe(recipe);
    expect(setSeed(recipe, -2)).toBe(recipe);
    expect(setSeed(recipe, 1.5)).toBe(recipe);
  });
});

describe("motion", () => {
  it("starts without motion and accepts a zoom between 0 and the maximum", () => {
    const recipe = createRecipe(RELEASE);
    expect(recipe.motion.zoomPerUpdate).toBe(0);
    const zooming = setZoomPerUpdate(recipe, 0.01);
    expect(zooming.motion.zoomPerUpdate).toBe(0.01);
    expect(zooming.requests).toBe(recipe.requests);
    expect(validateRecipe(zooming)).toEqual([]);
  });

  it("returns the same recipe for no change and for values outside the range", () => {
    const recipe = setZoomPerUpdate(createRecipe(RELEASE), 0.01);
    expect(setZoomPerUpdate(recipe, 0.01)).toBe(recipe);
    expect(setZoomPerUpdate(recipe, -0.01)).toBe(recipe);
    expect(setZoomPerUpdate(recipe, MAX_ZOOM_PER_UPDATE * 2)).toBe(recipe);
    expect(setZoomPerUpdate(recipe, Number.NaN)).toBe(recipe);
  });

  it("reads in percent per update and back, exactly on the 0.1 % grid", () => {
    expect(percentOfZoom(0.005)).toBe(0.5);
    expect(percentOfZoom(0.007)).toBe(0.7);
    expect(zoomFromPercent(0.7)).toBe(0.007);
    expect(zoomFromPercent(5)).toBe(MAX_ZOOM_PER_UPDATE);
    for (let tenths = 1; tenths <= 50; tenths++) expect(percentOfZoom(zoomFromPercent(tenths / 10))).toBe(tenths / 10);
  });
});

describe("optimizer", () => {
  it("starts a new canvas at the default and changes one run setting at a time", () => {
    const recipe = createRecipe(RELEASE);
    const longer = setOptimizer(recipe, { step: 0.1 });
    expect(longer.optimizer).toEqual({ ...OPTIMIZER_DEFAULT, step: 0.1 });
    expect(longer.requests).toBe(recipe.requests);
    expect(setOptimizer(longer, { scale: "coarse", robustView: true }).optimizer).toEqual({ step: 0.1, scale: "coarse", robustView: true });
    expect(validateRecipe(longer)).toEqual([]);
  });

  it("returns the same recipe for no change and for a setting outside its positions", () => {
    const recipe = createRecipe(RELEASE);
    expect(setOptimizer(recipe, {})).toBe(recipe);
    expect(setOptimizer(recipe, { step: OPTIMIZER_DEFAULT.step, robustView: false })).toBe(recipe);
    expect(setOptimizer(recipe, { step: 0.07 as OptimizerStep })).toBe(recipe);
    expect(setOptimizer(recipe, { scale: "fine" as OptimizerScale })).toBe(recipe);
  });
});

describe("the sparsity dial and the target", () => {
  const source = patchToken(7, 2, 8);
  const other = patchToken(9, 5, 5);
  /** An address of `token`: 32 blocks from 500 down, the request's block 1398 at rank 3. */
  function addressOf(token: Token) {
    const blocks = Array.from({ length: 32 }, (_, rank) => ({
      block: rank === 3 ? 1398 : 500 + rank + token.imageId * 100,
      code: [32 - rank, token.imageId, 1] as [number, number, number],
    }));
    return { token, blocks };
  }
  const oneRequest = () => createRequest(createRecipe(RELEASE), handoff(source));
  const alsoBlocksOf = (recipe: Recipe) => recipe.requests[0]!.respondLike.alsoBlocks;

  it("starts a request on its own block alone", () => {
    const recipe = oneRequest();
    expect(recipe.format).toBe(7);
    expect(alsoBlocksOf(recipe)).toEqual([]);
    expect(codeBlockCount(recipe.requests[0]!)).toBe(1);
  });

  it("adds the token's strongest other blocks in address order, skipping its own block, and keeps their codes", () => {
    const recipe = setCodeBlockCount(oneRequest(), 1, 5, addressOf(source));
    expect(alsoBlocksOf(recipe).map((entry) => entry.block)).toEqual([1200, 1201, 1202, 1204]);
    expect(alsoBlocksOf(recipe)[3]!.code).toEqual([28, 7, 1]);
    expect(codeBlockCount(recipe.requests[0]!)).toBe(5);
    expect(validateRecipe(recipe, { blocks: 16384 })).toEqual([]);
    // 32 in all: the own block and the 31 others.
    const all = setCodeBlockCount(recipe, 1, 32, addressOf(source));
    expect(alsoBlocksOf(all)).toHaveLength(31);
    expect(alsoBlocksOf(all).some((entry) => entry.block === 1398)).toBe(false);
  });

  it("keeps the first blocks when the count falls, without the address", () => {
    const five = setCodeBlockCount(oneRequest(), 1, 5, addressOf(source));
    const two = setCodeBlockCount(five, 1, 2, null);
    expect(alsoBlocksOf(two)).toEqual(alsoBlocksOf(five).slice(0, 1));
    expect(setCodeBlockCount(two, 1, 1, null).requests[0]!.respondLike.alsoBlocks).toEqual([]);
  });

  it("leaves the recipe unchanged for a count outside 1 to 32, more blocks without the address, or another token's address", () => {
    const recipe = oneRequest();
    for (const count of [0, 33, 2.5, 1]) expect(setCodeBlockCount(recipe, 1, count, addressOf(source))).toBe(recipe);
    expect(setCodeBlockCount(recipe, 1, 4, null)).toBe(recipe);
    expect(setCodeBlockCount(recipe, 1, 4, addressOf(other))).toBe(recipe);
    expect(setCodeBlockCount(recipe, 2, 4, addressOf(source))).toBe(recipe);
  });

  it("moves the target to another recorded token with its code, and keeps the cells, the weights and Appearance", () => {
    const recipe = oneRequest();
    const moved = retargetRequest(recipe, 1, { token: other, code: [1, 2, 3] }, null);
    const before = recipe.requests[0]!;
    const after = moved.requests[0]!;
    expect(after.respondLike.source).toEqual(other);
    expect(after.respondLike.code).toEqual([1, 2, 3]);
    expect(after.block).toBe(before.block);
    expect(after.respondLike.where).toEqual(before.respondLike.where);
    expect(after.respondLike.weight).toBe(before.respondLike.weight);
    expect(after.lookLike).toEqual(before.lookLike);
  });

  it("gives a moved request asking k blocks the new token's blocks, and needs that token's address", () => {
    const five = setCodeBlockCount(oneRequest(), 1, 5, addressOf(source));
    expect(retargetRequest(five, 1, { token: other, code: [1, 2, 3] }, null)).toBe(five);
    expect(retargetRequest(five, 1, { token: other, code: [1, 2, 3] }, addressOf(source))).toBe(five);
    const moved = retargetRequest(five, 1, { token: other, code: [1, 2, 3] }, addressOf(other));
    expect(alsoBlocksOf(moved).map((entry) => entry.block)).toEqual([1400, 1401, 1402, 1404]);
    expect(codeBlockCount(moved.requests[0]!)).toBe(5);
  });

  it("leaves the recipe unchanged for its own token or a token of another role", () => {
    const recipe = oneRequest();
    expect(retargetRequest(recipe, 1, { token: source, code: [1, 2, 3] }, null)).toBe(recipe);
    expect(retargetRequest(recipe, 1, { token: { imageId: 9, role: "cls", slot: 0 }, code: [1, 2, 3] }, null)).toBe(recipe);
  });
});
