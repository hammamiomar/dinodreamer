// Translates a recipe into the engine's specs, and decides what an apply changes.
//
// The objective spec holds only active terms (enabled, weight > 0), and each term only
// the fields that determine it. Equal
// specs therefore build identical terms: an apply with an equal spec keeps Adam.
// Probes are loss-free code readouts of every request; changing them never resets Adam.
// The JSON field names match engine/src/objective.rs.
//
// A request that asks k blocks (recipe.ts alsoBlocks) reaches the engine as k Code requests
// on the same cells, each at weight ÷ k, so the engine's objective is unchanged. Block j of
// request `id` has the engine id id + j × ADDRESS_ID_STRIDE; j = 0 is the request itself and
// keeps its Appearance term. foldAddressTerms turns their k measured terms back into the
// request's one Code term, so every event after the worker names the visitor's requests only.
// The probe reads the request's own block.

// The explicit extension lets Node bench tools (engine/tools/bench) import this file.
import { MAX_REQUEST_ID, PATCH_SLOT_OFFSET, type AddressBlock, type Area, type Recipe, type Reference, type Request, type Term, type Token } from "../recipe.ts";
import { scaleCode } from "../code-target.ts";
import type { Code } from "../recipe.ts";
import type { TermMeasurement } from "./protocol.ts";

export interface ReferenceSpec {
  imageId: number;
  source: boolean[];
}

export interface CodeSpec {
  block: number;
  slot: number;
  code: [number, number, number];
  /** The Respond like area. Required for a patch slot; null for CLS and storage, which measure their own slot. */
  where: Area | null;
  target?: EngineTarget;
}

export type EngineTarget =
  | { kind: "path"; codes: [Code, Code]; anchors: [number, number] }
  | { kind: "region"; codes: Code[]; lambda: number };
export type RegionTargets = ReadonlyMap<number, Code[]>;

export interface RespondSpec extends CodeSpec {
  weight: number;
}

export interface LookSpec {
  weight: number;
  /** The Look like area. The engine requires it. */
  where: Area;
  references: ReferenceSpec[];
}

export interface RequestSpec {
  id: number;
  respond: RespondSpec | null;
  look: LookSpec | null;
}

export interface ObjectiveSpec {
  requests: RequestSpec[];
  tv: number | null;
  l2: number | null;
}

export interface ProbeSpec extends CodeSpec {
  requestId: number;
}

function active(term: Term): boolean {
  return term.enabled && term.weight > 0;
}

function activeWeight(term: Term): number | null {
  return active(term) ? term.weight : null;
}

function isPrefix(token: Token): boolean {
  return token.slot < PATCH_SLOT_OFFSET;
}

/** The engine ids of a request's blocks: block j of request `id` is id + j × this. Request ids stay below it (recipe.ts). */
export const ADDRESS_ID_STRIDE = MAX_REQUEST_ID + 1;

/** The blocks a request asks, its own first: { block, the token's code in it }. */
export function requestedBlocks(request: Request): AddressBlock[] {
  return [{ block: request.block, code: request.respondLike.code }, ...request.respondLike.alsoBlocks];
}

/** One requested block's code on the request's cells. */
function codeSpec(request: Request, { block, code }: AddressBlock, regions: RegionTargets): CodeSpec {
  const { source, target, radius } = request.respondLike;
  let prepared: EngineTarget | undefined;
  if (target.kind === "path") prepared = {
    kind: "path",
    codes: [scaleCode(target.codes[0], radius), scaleCode(target.codes[1], radius)],
    anchors: target.anchors,
  };
  if (target.kind === "region") {
    const codes = regions.get(request.id);
    if (!codes) throw new Error(`The response selection's response vectors for constraint ${request.id} have not loaded.`);
    prepared = { kind: "region", codes, lambda: target.lambda };
  }
  return {
    ...(prepared ? { target: prepared } : {}),
    block,
    slot: source.slot,
    code: radius === 1 ? code : scaleCode(code, radius),
    where: isPrefix(source) ? null : request.respondLike.where,
  };
}

function referenceSpec(reference: Reference): ReferenceSpec {
  return { imageId: reference.token.imageId, source: reference.source };
}

/** The request as engine requests: itself with its own block and Appearance, then one Code request per other block. */
function requestSpecs(request: Request, regions: RegionTargets): RequestSpec[] {
  const blocks = requestedBlocks(request);
  const codeWeight = request.respondLike.weight / blocks.length;
  const respond = active(request.respondLike) ? blocks.map((block) => ({ weight: codeWeight, ...codeSpec(request, block, regions) })) : [];
  const look = active(request.lookLike)
    ? { weight: request.lookLike.weight, where: request.lookLike.where, references: request.lookLike.references.map(referenceSpec) }
    : null;
  const specs: RequestSpec[] = [];
  if (respond.length > 0 || look) specs.push({ id: request.id, respond: respond[0] ?? null, look });
  for (let j = 1; j < respond.length; j++) specs.push({ id: request.id + j * ADDRESS_ID_STRIDE, respond: respond[j]!, look: null });
  return specs;
}

/**
 * The engine's terms as the visitor's requests: the Code terms of a request's k blocks become its
 * one Code term, in the place of its own block's. Its raw is the mean of the k raws and its
 * weighted value their sum, so weighted is still the request's weight times raw. Other terms pass.
 */
export function foldAddressTerms(terms: TermMeasurement[]): TermMeasurement[] {
  const folded: TermMeasurement[] = [];
  // Per request: where its Code term goes, and the sums over its blocks.
  const codeTerms = new Map<number, { index: number; blocks: number; raw: number; weighted: number }>();
  for (const term of terms) {
    const match = /^request:(\d+):respond$/.exec(term.id);
    if (!match) {
      folded.push(term);
      continue;
    }
    const requestId = Number(match[1]) % ADDRESS_ID_STRIDE;
    const sums = codeTerms.get(requestId);
    if (sums) {
      sums.blocks += 1;
      sums.raw += term.raw;
      sums.weighted += term.weighted;
      continue;
    }
    codeTerms.set(requestId, { index: folded.length, blocks: 1, raw: term.raw, weighted: term.weighted });
    folded.push(term);
  }
  for (const [requestId, sums] of codeTerms) {
    folded[sums.index] = { id: `request:${requestId}:respond`, raw: sums.raw / sums.blocks, weighted: sums.weighted };
  }
  return folded;
}

/** What the engine receives for the optimizer; the field names match engine/src/state.rs OptimizerSpec. */
export interface OptimizerSpec {
  step: number;
  /** One step multiplier per pyramid level, coarsest (16 × 16) first. */
  levelRates: number[];
  robustView: boolean;
}

/** Coarse-first rates, ×√2 per octave from the 256 level to the 16 level. */
export const COARSE_FIRST_RATES = [4, 2.83, 2, 1.41, 1] as const;
export const EVEN_RATES = [1, 1, 1, 1, 1] as const;

/** The recipe's optimizer settings as the engine reads them: the step, the scale's per-level rates and the far view. */
export function optimizerSpec(recipe: Recipe): OptimizerSpec {
  const { step, scale, robustView } = recipe.optimizer;
  return {
    step,
    levelRates: [...(scale === "coarse" ? COARSE_FIRST_RATES : EVEN_RATES)],
    robustView,
  };
}

export function objectiveSpec(recipe: Recipe, regions: RegionTargets = new Map()): ObjectiveSpec {
  return {
    requests: recipe.requests.flatMap((request) => requestSpecs(request, regions)),
    tv: activeWeight(recipe.rules.tv),
    l2: activeWeight(recipe.rules.l2),
  };
}

/** One probe per request, on its own block. */
export function probeSpecs(recipe: Recipe, regions: RegionTargets = new Map()): ProbeSpec[] {
  return recipe.requests.map((request) => ({ requestId: request.id, ...codeSpec(request, requestedBlocks(request)[0]!, regions) }));
}

/** One byte per cell for the engine: 1 = editable, 0 = protected. */
export function editableCells(recipe: Recipe): Uint8Array {
  return Uint8Array.from(recipe.protect, (isProtected) => (isProtected ? 0 : 1));
}

/** Blocks whose frames the engine must hold: active Respond like terms and every probe. */
export function neededBlocks(objective: ObjectiveSpec, probes: ProbeSpec[]): number[] {
  const blocks = new Set<number>(probes.map((probe) => probe.block));
  for (const request of objective.requests) if (request.respond) blocks.add(request.respond.block);
  return [...blocks];
}

/** Reference images the active Look like terms read. */
export function neededImages(objective: ObjectiveSpec): number[] {
  const images = new Set<number>();
  for (const request of objective.requests) for (const reference of request.look?.references ?? []) images.add(reference.imageId);
  return [...images];
}

// Change detection compares the domain fields of each spec, never serialized text.

function sameValues<T extends number | boolean>(a: readonly T[] | null, b: readonly T[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameCode(a: CodeSpec, b: CodeSpec): boolean {
  return a.block === b.block && a.slot === b.slot && sameValues(a.code, b.code) && sameValues(a.where, b.where) && sameEngineTarget(a.target, b.target);
}

function sameRespond(a: RespondSpec | null, b: RespondSpec | null): boolean {
  if (a === null || b === null) return a === b;
  return a.weight === b.weight && sameCode(a, b);
}

function sameLook(a: LookSpec | null, b: LookSpec | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.weight === b.weight &&
    sameValues(a.where, b.where) &&
    a.references.length === b.references.length &&
    a.references.every(
      (reference, index) => reference.imageId === b.references[index].imageId && sameValues(reference.source, b.references[index].source),
    )
  );
}

export function sameOptimizer(a: OptimizerSpec, b: OptimizerSpec): boolean {
  return a.step === b.step && sameValues(a.levelRates, b.levelRates) && a.robustView === b.robustView;
}

export function sameObjective(a: ObjectiveSpec, b: ObjectiveSpec): boolean {
  return (
    a.tv === b.tv &&
    a.l2 === b.l2 &&
    a.requests.length === b.requests.length &&
    a.requests.every((request, index) => {
      const other = b.requests[index];
      return request.id === other.id && sameRespond(request.respond, other.respond) && sameLook(request.look, other.look);
    })
  );
}

export function sameProbes(a: ProbeSpec[], b: ProbeSpec[]): boolean {
  return a.length === b.length && a.every((probe, index) => probe.requestId === b[index].requestId && sameCode(probe, b[index]));
}

export function sameEditable(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameEngineTarget(a: EngineTarget | undefined, b: EngineTarget | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind || a.codes.length !== b.codes.length) return false;
  if (!a.codes.every((code, index) => sameValues(code, b.codes[index]!))) return false;
  if (a.kind === "path" && b.kind === "path") return sameValues(a.anchors, b.anchors);
  return a.kind === "region" && b.kind === "region" && a.lambda === b.lambda;
}
