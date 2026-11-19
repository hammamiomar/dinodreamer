// The structural parser for recipes that arrive as untrusted JSON: an imported
// file, a published gallery recipe, a gallery submission.
//
// Order at every untrusted boundary: `parseRecipe` first, then `validateRecipe`
// where the boundary requires a complete recipe. `parseRecipe` checks the shape
// the editor, the validator and the worker rely on (field types, array lengths,
// token slots) and rebuilds the recipe from those fields only. It does not check
// semantics: an incomplete local draft, such as Look like with no references,
// still parses. `validateRecipe` then reports those problems.
//
// Formats 1–3 upgrade to integer percentage fields. Formats 2 and 3 map true
// to 100 and false to 0. Format 1 follows its previous migration: any positive
// weight becomes full paint. Prefix Code fields are unused and become zeros.
// The former Whole canvas term is dropped. Missing motion becomes MOTION_OFF.
// Formats 1–4 get OPTIMIZER_BEFORE_FORMAT_5, the step they ran with.
// Formats 1–5 ask each request's own block alone (no other blocks), as they ran.
// Images keep a migration mark when the upgraded objective can change them.
//
// The gallery Worker imports this file under Node's type stripping, so it uses
// explicit .ts imports and no non-erasable TypeScript syntax.

import { decodeArray, decodeBoolean, decodeInteger, decodeNumber, decodeObject, decodeString } from "./decode.ts";
import {
  isOptimizerScale,
  isOptimizerStep,
  isPaintStrength,
  CELLS,
  DEFAULT_REGION_COVERAGE,
  MOTION_OFF,
  OPTIMIZER_BEFORE_FORMAT_5,
  OPTIMIZER_SCALES,
  OPTIMIZER_STEPS,
  PATCH_SLOT_OFFSET,
  TOKEN_SLOTS,
} from "./recipe.ts";
import type { AddressBlock, Area, CodeTarget, Optimizer, Recipe, Reference, Request, Role, Term, Token } from "./recipe.ts";

/** The earlier calculation that made a stored image; kept until a run replaces it. */
export type UpgradedFrom = 1 | 2 | 3;

/** Mark an earlier objective without replacing its stored picture or provenance. */
export function recipeUpgradedFrom(value: unknown): UpgradedFrom | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const recipe = value as Record<string, unknown>;
  if (recipe.format === 1) return 1;
  if (recipe.format !== 2 && recipe.format !== 3) return undefined;
  if (recipe.format === 2 && activeAppearance(recipe.wholeCanvas)) return 2;
  const requests = Array.isArray(recipe.requests) ? recipe.requests : [];
  return requests.some((request) => {
    if (typeof request !== "object" || request === null) return false;
    return activeAppearance((request as Record<string, unknown>).lookLike);
  }) ? 3 : undefined;
}

function activeAppearance(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { enabled, weight, references } = value as Record<string, unknown>;
  return enabled === true && typeof weight === "number" && weight > 0 && Array.isArray(references) && references.length > 0;
}

/** The role of a native slot: 0 CLS, 1–4 storage, 5–260 patch. */
export function slotRole(slot: number): Role {
  if (slot === 0) return "cls";
  if (slot < PATCH_SLOT_OFFSET) return "storage";
  return "patch";
}

/** True for a token whose role and slot agree and whose image id is exact in a JS number. */
export function isValidToken(token: Token): boolean {
  return (
    Number.isSafeInteger(token.imageId) &&
    token.imageId >= 0 &&
    Number.isInteger(token.slot) &&
    token.slot >= 0 &&
    token.slot < TOKEN_SLOTS &&
    slotRole(token.slot) === token.role
  );
}

/**
 * A format-7 recipe with the structure of recipe.ts, or an error naming the first
 * field that is wrong. An earlier recipe is upgraded (see the top of this file).
 */
export function parseRecipe(value: unknown): Recipe {
  const recipe = object(value, "recipe");
  const format = recipe.format;
  if (format !== 1 && format !== 2 && format !== 3 && format !== 4 && format !== 5 && format !== 6 && format !== 7) {
    throw new Error(`recipe.format: unsupported image-editing configuration format ${String(format)}`);
  }
  const parseRequest = (value: unknown, path: string) => format === 1
    ? parseFormat1Request(value, path)
    : parseAreaRequest(value, path, format >= 4, format >= 6, format === 7);
  const rules = object(recipe.rules, "recipe.rules");
  return {
    format: 7,
    release: string(recipe.release, "recipe.release"),
    seed: integer(recipe.seed, "recipe.seed"),
    requests: array(recipe.requests, "recipe.requests", parseRequest),
    protect: cells(recipe.protect, "recipe.protect", boolean),
    rules: {
      tv: term(rules.tv, "recipe.rules.tv"),
      l2: term(rules.l2, "recipe.rules.l2"),
    },
    motion: parseMotion(recipe.motion),
    optimizer: format >= 5 ? parseOptimizer(recipe.optimizer) : { ...OPTIMIZER_BEFORE_FORMAT_5 },
  };
}

/** Absent in recipes saved before motion existed: no motion. */
function parseMotion(value: unknown): Recipe["motion"] {
  if (value === undefined) return { ...MOTION_OFF };
  const motion = object(value, "recipe.motion");
  return { zoomPerUpdate: number(motion.zoomPerUpdate, "recipe.motion.zoomPerUpdate") };
}

/** Formats 5 and later: each setting is one of the positions the Canvas offers. */
function parseOptimizer(value: unknown): Optimizer {
  const optimizer = object(value, "recipe.optimizer");
  if (!isOptimizerStep(optimizer.step)) {
    throw new Error(`recipe.optimizer.step: expected one of ${OPTIMIZER_STEPS.join(", ")}`);
  }
  if (!isOptimizerScale(optimizer.scale)) {
    throw new Error(`recipe.optimizer.scale: expected one of ${OPTIMIZER_SCALES.join(", ")}`);
  }
  return {
    step: optimizer.step,
    scale: optimizer.scale,
    robustView: boolean(optimizer.robustView, "recipe.optimizer.robustView"),
  };
}

/**
 * Independent fields: formats 2 and 3 were Boolean; formats 4 and later are integer percentages.
 * Format 6 adds the request's other blocks.
 */
function parseAreaRequest(value: unknown, path: string, percentages: boolean, withAlsoBlocks: boolean, withTarget: boolean): Request {
  const request = object(value, path);
  const respondLike = object(request.respondLike, `${path}.respondLike`);
  const lookLike = object(request.lookLike, `${path}.lookLike`);
  const read = percentages ? percentage : (value: unknown, path: string) => boolean(value, path) ? 100 : 0;
  const areas = {
    respondLike: cells(respondLike.where, `${path}.respondLike.where`, read),
    lookLike: cells(lookLike.where, `${path}.lookLike.where`, read),
  };
  const others = withAlsoBlocks ? array(respondLike.alsoBlocks, `${path}.respondLike.alsoBlocks`, addressBlock) : [];
  return requestOf(request, path, areas, others, withTarget);
}

/** Format 1: both areas are the cells where the shared weight field is above 0. */
function parseFormat1Request(value: unknown, path: string): Request {
  const request = object(value, path);
  const painted: Area = cells(request.where, `${path}.where`, number).map((weight) => weight > 0 ? 100 : 0);
  const source = token(object(request.respondLike, `${path}.respondLike`).source, `${path}.respondLike.source`);
  const respondArea = source.role === "patch" ? painted : painted.map(() => 0);
  return requestOf(request, path, { respondLike: respondArea, lookLike: [...painted] }, []);
}

/** The fields every format shares, with the areas and the other blocks already read. */
function requestOf(
  request: Record<string, unknown>,
  path: string,
  areas: { respondLike: Area; lookLike: Area },
  alsoBlocks: AddressBlock[],
  withTarget = false,
): Request {
  const respondLike = object(request.respondLike, `${path}.respondLike`);
  const lookLike = object(request.lookLike, `${path}.lookLike`);
  const source = token(respondLike.source, `${path}.respondLike.source`);
  return {
    id: integer(request.id, `${path}.id`),
    block: integer(request.block, `${path}.block`),
    respondLike: {
      ...term(respondLike, `${path}.respondLike`),
      source,
      code: code(respondLike.code, `${path}.respondLike.code`),
      where: source.role === "patch" ? areas.respondLike : areas.respondLike.map(() => 0),
      alsoBlocks,
      target: withTarget ? parseCodeTarget(respondLike.target, `${path}.respondLike.target`) : { kind: "point" },
      radius: withTarget ? number(respondLike.radius, `${path}.respondLike.radius`) : 1,
    },
    lookLike: {
      ...term(lookLike, `${path}.lookLike`),
      references: array(lookLike.references, `${path}.lookLike.references`, reference),
      where: areas.lookLike,
    },
  };
}

/** One of a request's other blocks: the block and the token's code in it. */
function addressBlock(value: unknown, path: string): AddressBlock {
  const record = object(value, path);
  return { block: integer(record.block, `${path}.block`), code: code(record.code, `${path}.code`) };
}

function code(value: unknown, path: string): [number, number, number] {
  const values = array(value, path, number);
  if (values.length !== 3) throw new Error(`${path}: expected 3 numbers`);
  return [values[0]!, values[1]!, values[2]!];
}

function reference(value: unknown, path: string): Reference {
  const record = object(value, path);
  return { token: token(record.token, `${path}.token`), source: cells(record.source, `${path}.source`, boolean) };
}

function token(value: unknown, path: string): Token {
  const record = object(value, path);
  const parsed = { imageId: record.imageId, role: record.role, slot: record.slot } as Token;
  if (!isValidToken(parsed)) throw new Error(`${path}: not a valid token`);
  return parsed;
}

function term(value: unknown, path: string): Term {
  const record = object(value, path);
  return { enabled: boolean(record.enabled, `${path}.enabled`), weight: number(record.weight, `${path}.weight`) };
}

/** One value per cell of the 16 × 16 grid. */
function cells<T>(value: unknown, path: string, read: (value: unknown, path: string) => T): T[] {
  const values = array(value, path, read);
  if (values.length !== CELLS) throw new Error(`${path}: expected ${CELLS} cells`);
  return values;
}

const object = decodeObject;
const array = decodeArray;
const string = decodeString;
const number = decodeNumber;
const integer = decodeInteger;

function boolean(value: unknown, path: string): boolean {
  return decodeBoolean(value, path, (field) => `${field}: expected true or false`);
}

function percentage(value: unknown, path: string): number {
  if (!isPaintStrength(value)) throw new Error(`${path}: expected an integer percentage between 0 and 100`);
  return value;
}

/** Format 7 keeps explicit coverage weights and defaults only a missing weight. */
function parseCodeTarget(value: unknown, path: string): CodeTarget {
  const target = object(value, path);
  if (target.kind === "point") return { kind: "point" };
  if (target.kind === "region") return {
    kind: "region",
    centre: code(target.centre, `${path}.centre`),
    selectionRadius: number(target.selectionRadius, `${path}.selectionRadius`),
    lambda: target.lambda === undefined ? DEFAULT_REGION_COVERAGE : number(target.lambda, `${path}.lambda`),
  };
  if (target.kind === "path") {
    const codes = array(target.codes, `${path}.codes`, code);
    const anchors = array(target.anchors, `${path}.anchors`, integer);
    if (codes.length !== 2 || anchors.length !== 2 || anchors.some((cell) => cell < 0 || cell >= CELLS)) {
      throw new Error(`${path}: a path needs two response vectors and two endpoint cells in 0–255`);
    }
    return { kind: "path", codes: [codes[0]!, codes[1]!], anchors: [anchors[0]!, anchors[1]!] };
  }
  throw new Error(`${path}.kind: expected point, path or region`);
}
