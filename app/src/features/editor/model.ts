// Pure operations on a creation's recipe. The editor's reducer calls them; the
// UI never edits a Recipe directly.
//
// Every operation returns a new Recipe when it changes a numerical input, and the
// same Recipe object when it has no effect. The reducer counts numerical edits by
// that identity: a new object is a new revision (see state.ts).

import { sameCodeTarget } from "../../code-target";
import { DEFAULT_BRUSH, quantizeDeposit, startStroke, type Brush } from "./canvas/brush";
import { MAX_STRONG_EXAMPLES, type Code, type TokenHandoff } from "../../app/handoff";
import type { TokenAddress } from "../../library/addresses";
import {
  CELLS,
  GRID,
  MAX_CODE_BLOCKS,
  MAX_ZOOM_PER_UPDATE,
  MOTION_OFF,
  OPTIMIZER_DEFAULT,
  PATCH_SLOT_OFFSET,
  RECIPE_DEFAULTS,
  isOptimizerScale,
  isOptimizerStep,
  type CodeTarget,
  type AddressBlock,
  type Area,
  type Optimizer,
  type Recipe,
  type Reference,
  type Request,
  type Term,
  type Token,
} from "../../recipe";

/** A position on the 16 × 16 token grid. */
export interface Cell {
  row: number;
  column: number;
}

/**
 * Where a request without a drop point is painted when its token has no position:
 * CLS and storage tokens. The 3 × 3 square around this cell is near the canvas centre.
 */
export const CANVAS_CENTRE: Cell = { row: GRID / 2 - 1, column: GRID / 2 - 1 };

/** Term ids, identical to the ids of protocol TermMeasurement, so the panels can join them. */
export type TermId =
  | `request:${number}:respond`
  | `request:${number}:look`
  | "rules:tv"
  | "rules:l2";

/** The two terms of a request that have a painted area on the canvas. */
export type AreaTerm = "respond" | "look";

/** Paint adds strength; erase subtracts it. */
export type BrushMode = "paint" | "erase";

/** One completed gesture: integer percentage deposits; Boolean tools use 0 or 100. */
export interface Stroke {
  mode: BrushMode;
  cells: Area;
}

// ---------------------------------------------------------------------------
// Creation and requests

export function createRecipe(release: string, seed = 1): Recipe {
  return {
    format: 7,
    release,
    seed,
    requests: [],
    protect: new Array<boolean>(CELLS).fill(false),
    rules: {
      tv: { enabled: false, weight: RECIPE_DEFAULTS.tvWeight },
      l2: { enabled: false, weight: RECIPE_DEFAULTS.l2Weight },
    },
    motion: { ...MOTION_OFF },
    optimizer: { ...OPTIMIZER_DEFAULT },
  };
}

export function canAddRequest(recipe: Recipe): boolean {
  return recipe.requests.length < RECIPE_DEFAULTS.maxRequests;
}

/**
 * Test/fixture builder for a request made from one recorded token. The UI captures
 * its drop field before reading the token, then calls createPaintedRequest.
 *
 * - Fields: one dab of the round brush at the given cell, for both terms. Without a
 *   cell, a patch token uses its own cell and a prefix token uses the canvas centre.
 *   The dab is clipped at the edge.
 * - Respond like: on, with the token's recorded code. A CLS or storage token measures
 *   its own slot, so its Respond like area is empty.
 * - Look like: on, with the token's picture first, then the block's strong examples
 *   for the token's role, up to MAX_STRONG_EXAMPLES distinct pictures in all. Each
 *   source window is a 3 × 3 square around its token, or the whole view for a prefix.
 *
 * Returns the same recipe when the creation already holds the maximum number of requests.
 */
export function createRequest(recipe: Recipe, handoff: TokenHandoff, at?: Cell, brush: Brush = DEFAULT_BRUSH): Recipe {
  const centre = at ?? defaultAreaCentre(handoff.token);
  const field = quantizeDeposit(startStroke({ x: centre.column + 0.5, y: centre.row + 0.5 }, brush));
  return createPaintedRequest(recipe, handoff, field);
}

/**
 * Adds a request whose areas are the cells of its first stroke: a token held on the
 * canvas (state.ts, the held rule) becomes a request where the visitor painted it.
 * Otherwise as createRequest. Returns the same recipe when the creation is full or
 * `area` is empty, since a request without an area cannot run.
 */
export function createPaintedRequest(recipe: Recipe, handoff: TokenHandoff, area: Area): Recipe {
  if (!area.some(Boolean) || !canAddRequest(recipe)) return recipe;
  const request: Request = {
    id: nextRequestId(recipe),
    block: handoff.block,
    respondLike: {
      enabled: true,
      weight: RECIPE_DEFAULTS.respondLikeWeight,
      source: handoff.token,
      code: [...handoff.code],
      where: hasPaintedRespondArea(handoff.token) ? area.slice() : emptyArea(),
      alsoBlocks: [],
      target: { kind: "point" },
      radius: 1,
    },
    lookLike: {
      enabled: true,
      weight: RECIPE_DEFAULTS.lookLikeWeight,
      references: initialReferences(handoff),
      where: area.slice(),
    },
  };
  return { ...recipe, requests: [...recipe.requests, request] };
}

/** The source picture first, then the block's strong examples, one reference per distinct picture. */
function initialReferences(handoff: TokenHandoff): Reference[] {
  const tokens = distinctImages([handoff.token, ...(handoff.strongExamples ?? [])]);
  return tokens.slice(0, MAX_STRONG_EXAMPLES).map(defaultReference);
}

/** Removes a request and its terms. */
export function removeRequest(recipe: Recipe, requestId: number): Recipe {
  if (!recipe.requests.some((request) => request.id === requestId)) return recipe;
  return { ...recipe, requests: recipe.requests.filter((request) => request.id !== requestId) };
}

/**
 * Whether two requests ask for the same thing: the same recorded code of the same token in
 * the same block. Their areas, weights and references may differ. Request ids can return
 * after a removal, so code readouts kept per id check this before they continue.
 */
export function sameTarget(a: Request, b: Request): boolean {
  const sourceA = a.respondLike.source;
  const sourceB = b.respondLike.source;
  return (
    a.respondLike.radius === b.respondLike.radius &&
    sameCodeTarget(a.respondLike.target, b.respondLike.target) &&
    a.block === b.block &&
    sourceA.imageId === sourceB.imageId &&
    sourceA.slot === sourceB.slot &&
    a.respondLike.code.every((value, axis) => value === b.respondLike.code[axis])
  );
}

export function findRequest(recipe: Recipe, requestId: number): Request | undefined {
  return recipe.requests.find((request) => request.id === requestId);
}

// ---------------------------------------------------------------------------
// The sparsity dial and the target: what a request's Code term asks (format 6)

/** How many blocks the request asks: its own and its other blocks (recipe.ts alsoBlocks). */
export function codeBlockCount(request: Request): number {
  return 1 + request.respondLike.alsoBlocks.length;
}

/**
 * The request asks `count` blocks: its own block, then the strongest other blocks of its
 * token's address. Fewer blocks keep the first ones. More blocks need `address`, the address
 * of the request's own token (Library.tokenAddress). A count outside 1 to MAX_CODE_BLOCKS,
 * more blocks without that address, or the address of another token leave the recipe unchanged.
 */
export function setCodeBlockCount(recipe: Recipe, requestId: number, count: number, address: TokenAddress | null): Recipe {
  if (!Number.isInteger(count) || count < 1 || count > MAX_CODE_BLOCKS) return recipe;
  return updateRequest(recipe, requestId, (request) => {
    if (request.respondLike.target.kind !== "point" && count > 1) return request;
    const current = request.respondLike.alsoBlocks;
    if (count === current.length + 1) return request;
    if (count < current.length + 1) return withAlsoBlocks(request, current.slice(0, count - 1));
    if (!address || !sameToken(address.token, request.respondLike.source)) return request;
    return withAlsoBlocks(request, otherBlocks(address, request.block).slice(0, count - 1));
  });
}

/**
 * The request's target becomes another recorded token of its block, with that token's
 * recorded code: the code space's drag and its "Random token". The request's cells, weights
 * and Appearance stay. It asks as many blocks as before, the new token's: with more than
 * one, that needs `address`, the new token's address. Without it, or for a token of another
 * role, or for the request's own token, the recipe is unchanged.
 */
export function retargetRequest(recipe: Recipe, requestId: number, target: { token: Token; code: Code }, address: TokenAddress | null): Recipe {
  return updateRequest(recipe, requestId, (request) => {
    const { source } = request.respondLike;
    if (target.token.role !== source.role || sameToken(target.token, source)) return request;
    const count = codeBlockCount(request);
    if (count > 1 && (!address || !sameToken(address.token, target.token))) return request;
    const alsoBlocks = count > 1 && address ? otherBlocks(address, request.block).slice(0, count - 1) : [];
    return { ...request, respondLike: { ...request.respondLike, source: { ...target.token }, code: [...target.code], alsoBlocks } };
  });
}

/** Palette targets own one patch block. The point kind can still ask the full address. */
export function setCodeTarget(recipe: Recipe, requestId: number, target: CodeTarget): Recipe {
  return updateRequest(recipe, requestId, (request) => {
    if (target.kind !== "point" && request.respondLike.source.role !== "patch") return request;
    if (sameCodeTarget(request.respondLike.target, target)) return request;
    return {
      ...request,
      respondLike: { ...request.respondLike, target, alsoBlocks: target.kind === "point" ? request.respondLike.alsoBlocks : [] },
    };
  });
}

export function setCodeRadius(recipe: Recipe, requestId: number, radius: number): Recipe {
  if (!Number.isFinite(radius) || radius < 0.5 || radius > 8) return recipe;
  return updateRequest(recipe, requestId, (request) => request.respondLike.radius === radius ? request : {
    ...request, respondLike: { ...request.respondLike, radius },
  });
}

export function setPathAnchor(recipe: Recipe, requestId: number, endpoint: 0 | 1, cell: number): Recipe {
  const request = findRequest(recipe, requestId);
  if (!request || !Number.isInteger(cell) || cell < 0 || cell >= CELLS) return recipe;
  const target = request.respondLike.target;
  if (target.kind !== "path" || target.anchors[endpoint] === cell) return recipe;
  const anchors: [number, number] = [...target.anchors];
  anchors[endpoint] = cell;
  return setCodeTarget(recipe, requestId, { ...target, anchors });
}

/** A token's address without the request's own block, which the request always asks first. */
function otherBlocks(address: TokenAddress, ownBlock: number): AddressBlock[] {
  return address.blocks.filter(({ block }) => block !== ownBlock).map(({ block, code }) => ({ block, code: [...code] }));
}

function withAlsoBlocks(request: Request, alsoBlocks: AddressBlock[]): Request {
  return { ...request, respondLike: { ...request.respondLike, alsoBlocks } };
}

function sameToken(a: Token, b: Token): boolean {
  return a.imageId === b.imageId && a.slot === b.slot;
}

function nextRequestId(recipe: Recipe): number {
  return recipe.requests.reduce((largest, request) => Math.max(largest, request.id), 0) + 1;
}

/** Replaces one request through `change`; keeps the recipe when `change` returns the same request. */
function updateRequest(recipe: Recipe, requestId: number, change: (request: Request) => Request): Recipe {
  const index = recipe.requests.findIndex((request) => request.id === requestId);
  if (index < 0) return recipe;
  const before = recipe.requests[index];
  const after = change(before);
  if (after === before) return recipe;
  const requests = recipe.requests.slice();
  requests[index] = after;
  return { ...recipe, requests };
}

// ---------------------------------------------------------------------------
// Areas: the cells where a term is measured, and Protect

/** Add or subtract a completed integer deposit, saturating at 0 and 100. */
export function combineStroke(area: Area, stroke: Stroke): Area {
  const direction = stroke.mode === "paint" ? 1 : -1;
  const combined = area.map((value, cell) => Math.max(0, Math.min(100, value + direction * stroke.cells[cell])));
  return combined.every((value, cell) => value === area[cell]) ? area : combined;
}

/**
 * Only a patch token's Respond like has a painted area. A CLS or storage token
 * measures its own slot (computation.md §6), so its area stays empty.
 */
export function hasPaintedRespondArea(token: Token): boolean {
  return token.role === "patch";
}

export function termArea(request: Request, term: AreaTerm): Area {
  return term === "respond" ? request.respondLike.where : request.lookLike.where;
}

/** Paints or erases one stroke on the area of one term of a request. */
export function applyAreaStroke(recipe: Recipe, requestId: number, term: AreaTerm, stroke: Stroke): Recipe {
  return updateRequest(recipe, requestId, (request) => {
    if (term === "respond" && !hasPaintedRespondArea(request.respondLike.source)) return request;
    const before = termArea(request, term);
    const where = combineStroke(before, stroke);
    if (where === before) return request;
    if (term === "respond") return { ...request, respondLike: { ...request.respondLike, where } };
    return { ...request, lookLike: { ...request.lookLike, where } };
  });
}

/**
 * Paints or erases both areas of a linked request: Code where the request has one,
 * and Appearance. Returns the same recipe when nothing changes.
 */
export function applyRequestStroke(recipe: Recipe, requestId: number, stroke: Stroke): Recipe {
  const withRespond = applyAreaStroke(recipe, requestId, "respond", stroke);
  return applyAreaStroke(withRespond, requestId, "look", stroke);
}

/** The number of cells in an area: the tokens its term measures. */
export function areaSize(area: readonly (number | boolean)[]): number {
  return area.filter(Boolean).length;
}

export function setProtect(recipe: Recipe, protect: boolean[]): Recipe {
  if (sameBooleans(protect, recipe.protect)) return recipe;
  return { ...recipe, protect: protect.slice() };
}

/** Protect is an area too: paint protects the touched cells, erase releases them. */
export function applyProtectStroke(recipe: Recipe, stroke: Stroke): Recipe {
  const inside = stroke.mode === "paint";
  const protect = recipe.protect.map((value, cell) => stroke.cells[cell] ? inside : value);
  return setProtect(recipe, protect);
}

// ---------------------------------------------------------------------------
// Look like: references and source windows

/** A new reference: a patch token's 3 × 3 neighbourhood, or the whole view for a prefix token. */
export function defaultReference(token: Token): Reference {
  const cell = tokenCell(token);
  const source = cell ? squareArea(cell, RECIPE_DEFAULTS.initialWhereRadius) : new Array<boolean>(CELLS).fill(true);
  return { token, source };
}

/**
 * Replaces a request's reference pictures. A picture that stays keeps its edited
 * source window (computation.md §11); a new picture gets the default window.
 * Duplicate images keep their first occurrence, and the list stops at the maximum.
 */
export function setReferences(recipe: Recipe, requestId: number, tokens: Token[]): Recipe {
  return updateRequest(recipe, requestId, (request) => {
    const current = request.lookLike.references;
    const references = distinctImages(tokens)
      .slice(0, RECIPE_DEFAULTS.maxReferences)
      .map((token) => current.find((reference) => reference.token.imageId === token.imageId) ?? defaultReference(token));
    const unchanged =
      references.length === current.length && references.every((reference, index) => reference === current[index]);
    if (unchanged) return request;
    return { ...request, lookLike: { ...request.lookLike, references } };
  });
}

export function addReference(recipe: Recipe, requestId: number, token: Token): Recipe {
  const request = findRequest(recipe, requestId);
  if (!request) return recipe;
  const tokens = request.lookLike.references.map((reference) => reference.token);
  return setReferences(recipe, requestId, [...tokens, token]);
}

export function removeReference(recipe: Recipe, requestId: number, imageId: number): Recipe {
  const request = findRequest(recipe, requestId);
  if (!request) return recipe;
  const tokens = request.lookLike.references.map((reference) => reference.token);
  return setReferences(
    recipe,
    requestId,
    tokens.filter((token) => token.imageId !== imageId),
  );
}

/**
 * Sets which of a reference picture's patch tokens enter the appearance template.
 * An empty window is never valid, so it leaves the recipe unchanged.
 */
export function setSourceWindow(recipe: Recipe, requestId: number, imageId: number, source: boolean[]): Recipe {
  if (!source.some(Boolean)) return recipe;
  return updateRequest(recipe, requestId, (request) => {
    const references = request.lookLike.references;
    const index = references.findIndex((reference) => reference.token.imageId === imageId);
    if (index < 0 || sameBooleans(references[index].source, source)) return request;
    const updated = references.slice();
    updated[index] = { ...references[index], source: source.slice() };
    return { ...request, lookLike: { ...request.lookLike, references: updated } };
  });
}

function distinctImages(tokens: Token[]): Token[] {
  const seen = new Set<number>();
  return tokens.filter((token) => {
    if (seen.has(token.imageId)) return false;
    seen.add(token.imageId);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Terms: switches and weights, addressed by the protocol's term ids.
// Image rules are terms too ("rules:tv", "rules:l2"), so they use the same operations.

export function respondTermId(requestId: number): TermId {
  return `request:${requestId}:respond`;
}

export function lookTermId(requestId: number): TermId {
  return `request:${requestId}:look`;
}

/** Every term of a recipe in display order: per request Respond then Look, then the rules. */
export function termIds(recipe: Recipe): TermId[] {
  const requestTerms = recipe.requests.flatMap((request) => [respondTermId(request.id), lookTermId(request.id)]);
  return [...requestTerms, "rules:tv", "rules:l2"];
}

export function getTerm(recipe: Recipe, id: TermId): Term | undefined {
  if (id === "rules:tv") return recipe.rules.tv;
  if (id === "rules:l2") return recipe.rules.l2;
  const { requestId, row } = parseRequestTermId(id);
  const request = findRequest(recipe, requestId);
  if (!request) return undefined;
  return row === "respond" ? request.respondLike : request.lookLike;
}

/** True when the term contributes to the loss: switched on with a positive weight. */
export function isTermActive(term: Term): boolean {
  return term.enabled && term.weight > 0;
}

export function setTermEnabled(recipe: Recipe, id: TermId, enabled: boolean): Recipe {
  return updateTerm(recipe, id, (term) => (term.enabled === enabled ? term : { ...term, enabled }));
}

/** Weights are non-negative; a negative or non-finite weight leaves the recipe unchanged. */
export function setTermWeight(recipe: Recipe, id: TermId, weight: number): Recipe {
  if (!(Number.isFinite(weight) && weight >= 0)) return recipe;
  return updateTerm(recipe, id, (term) => (term.weight === weight ? term : { ...term, weight }));
}

function updateTerm(recipe: Recipe, id: TermId, change: <T extends Term>(term: T) => T): Recipe {
  if (id === "rules:tv" || id === "rules:l2") {
    const key = id === "rules:tv" ? "tv" : "l2";
    const rule = change(recipe.rules[key]);
    return rule === recipe.rules[key] ? recipe : { ...recipe, rules: { ...recipe.rules, [key]: rule } };
  }
  const { requestId, row } = parseRequestTermId(id);
  return updateRequest(recipe, requestId, (request) => {
    if (row === "respond") {
      const respondLike = change(request.respondLike);
      return respondLike === request.respondLike ? request : { ...request, respondLike };
    }
    const lookLike = change(request.lookLike);
    return lookLike === request.lookLike ? request : { ...request, lookLike };
  });
}

function parseRequestTermId(id: `request:${number}:${"respond" | "look"}`): {
  requestId: number;
  row: "respond" | "look";
} {
  const [, requestId, row] = id.split(":");
  return { requestId: Number(requestId), row: row as "respond" | "look" };
}

// ---------------------------------------------------------------------------
// Seed

/** The seed is not part of the objective; it chooses the noise image of the next restart. */
export function setSeed(recipe: Recipe, seed: number): Recipe {
  if (!(Number.isInteger(seed) && seed >= 0) || seed === recipe.seed) return recipe;
  return { ...recipe, seed };
}

// ---------------------------------------------------------------------------
// Motion

/**
 * The DeepDream zoom: every update scales the image about its centre by this fraction.
 * It is not a term of the objective, but it changes what the optimizer works on, so
 * it is a numerical edit. A value outside 0 to MAX_ZOOM_PER_UPDATE leaves the recipe unchanged.
 */
export function setZoomPerUpdate(recipe: Recipe, zoomPerUpdate: number): Recipe {
  const valid = Number.isFinite(zoomPerUpdate) && zoomPerUpdate >= 0 && zoomPerUpdate <= MAX_ZOOM_PER_UPDATE;
  if (!valid || zoomPerUpdate === recipe.motion.zoomPerUpdate) return recipe;
  return { ...recipe, motion: { ...recipe.motion, zoomPerUpdate } };
}

/**
 * Zoom as percent per update, at the stepper's 0.1 % resolution: 0.005 reads 0.5.
 * The recipe keeps the fraction.
 */
export function percentOfZoom(zoomPerUpdate: number): number {
  return Math.round(zoomPerUpdate * 1000) / 10;
}

/** A percent per update as the recipe's fraction, on the stepper's 0.1 % grid, so 0.7 % is exactly 0.007. */
export function zoomFromPercent(percent: number): number {
  return Math.round(percent * 10) / 1000;
}

// ---------------------------------------------------------------------------
// Optimizer

/**
 * The optimizer's settings: the step, the scale and the robust view (recipe.optimizer).
 * They change the result, so a change is a numerical edit; the worker applies it from the
 * next update without resetting Adam. A setting outside its positions leaves the recipe unchanged.
 */
export function setOptimizer(recipe: Recipe, change: Partial<Optimizer>): Recipe {
  const optimizer = { ...recipe.optimizer, ...change };
  const valid = isOptimizerStep(optimizer.step) && isOptimizerScale(optimizer.scale) && typeof optimizer.robustView === "boolean";
  const unchanged =
    optimizer.step === recipe.optimizer.step &&
    optimizer.scale === recipe.optimizer.scale &&
    optimizer.robustView === recipe.optimizer.robustView;
  if (!valid || unchanged) return recipe;
  return { ...recipe, optimizer };
}

// ---------------------------------------------------------------------------
// Grid geometry

/** The grid cell of a patch token; undefined for CLS and storage tokens, which have no position. */
export function tokenCell(token: Token): Cell | undefined {
  if (token.role !== "patch") return undefined;
  const index = token.slot - PATCH_SLOT_OFFSET;
  return { row: Math.floor(index / GRID), column: index % GRID };
}

/**
 * The default centre for a fixture request: the token's own cell, or the canvas centre
 * for a CLS or storage token. Interactive requests use the painted field instead.
 */
export function defaultAreaCentre(token: Token): Cell {
  return tokenCell(token) ?? CANVAS_CENTRE;
}

export function cellIndex(cell: Cell): number {
  return cell.row * GRID + cell.column;
}

export function emptyArea(): Area {
  return new Array<number>(CELLS).fill(0);
}

/** The square of half-width `radius` around `centre`, clipped at the edge. */
export function squareArea(centre: Cell, radius: number): boolean[] {
  const area = new Array<boolean>(CELLS).fill(false);
  for (let row = centre.row - radius; row <= centre.row + radius; row++) {
    for (let column = centre.column - radius; column <= centre.column + radius; column++) {
      if (row < 0 || row >= GRID || column < 0 || column >= GRID) continue;
      area[cellIndex({ row, column })] = true;
    }
  }
  return area;
}

function sameBooleans(a: boolean[], b: boolean[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
