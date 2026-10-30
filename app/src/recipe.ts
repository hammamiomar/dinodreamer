import { targetProblems } from "./code-target.ts";

// Numerical inputs shared by the editor, Saved, gallery and worker.
// Format 2: each term has an area; cells are in or out, and only
// the global weight sets strength. Format 3: Whole canvas is removed;
// painting a request over the full grid serves that purpose.
// Format 4: integer strength fields let one soft brush paint each
// cell's pull. Relative strengths distribute the term; its peak scales the loss.
// Source windows, Protect and Noise stay Boolean.
// Format 5: the optimizer settings the visitor chooses (step, scale,
// robust view). They change the result, so the recipe carries them.
// Format 6: the sparsity dial. A Code request can ask for its token's
// codes in more blocks of the token's address, so it copies more of the token.
// Format 7: point, path or region targets, and a target radius multiplier.

export type Role = "cls" | "storage" | "patch";

/** One recorded token in one saved view of one image, as stored in an observation record. */
export interface Token {
  imageId: number;
  role: Role;
  /** 0 = CLS, 1–4 = storage tokens, 5–260 = patch grid in row-major order. */
  slot: number;
}

export interface Term {
  enabled: boolean;
  weight: number;
}

/** A reference picture and the subset of its patch tokens that enter the appearance template. */
export interface Reference {
  token: Token;
  /** 256 cells, row-major 16 × 16. A prefix token's reference starts with all cells selected. */
  source: boolean[];
}

/** 256 integer percentages in [0, 100], row-major on the 16 × 16 canvas grid. */
export type Area = number[];

/** A point, a spatial path, or a sphere that selects recorded patch codes. */
export type Code = [number, number, number];

/**
 * Look hands native dictionary codes to the Studio. This is not a Canvas recipe.
 * A library point from the full cloud may have no public picture; it says so with
 * publicPreview: false. Absent means public, as in every request before full clouds.
 */
export type MaterialPoint = { code: Code; slot: number } & (
  | { source: "library"; imageId: number; publicPreview?: false }
  | { source: "upload"; imageId?: never }
);

/** From the ring outward: Barely, Weakly, Strongly, Strongest. */
export type StrengthBand = "barely" | "weakly" | "strongly" | "strongest";

/**
 * The band rule's published inputs, in native code units. The ring is the block's
 * median winning gate. The three cuts divide the distance from the ring to the
 * maximum of the 4,096-patch public sample into quarters. A norm on a cut belongs
 * to the upper band; a norm inside the ring is Barely; a norm above the maximum
 * is Strongest.
 */
export interface StrengthCuts {
  ring: number;
  cuts: [number, number, number];
  maximum: number;
}

/** The patch a request asks Grow for. Its band is the first thing the request says. */
export type MaterialAnchor = { band: StrengthBand; norm: number; strength: StrengthCuts } & MaterialPoint;

/**
 * The rows a selection was made over. A selection over a loaded prefix covers those
 * rows only. selectedPoints is the region's size; a sent request may carry fewer points.
 */
export interface MaterialCoverage {
  source: "full" | "sample";
  loadedRows: number;
  blockRows: number;
  selectedPoints: number;
}

/** The Studio's request decoder accepts at most this many points; Send carries an even subsample of a larger region. */
export const MATERIAL_REQUEST_MAX_POINTS = 4352;

/**
 * anchor and coverage are optional so that older requests stay valid. Look writes
 * both. A reader that knows only block, points and mode reads a new request unchanged.
 */
export interface MaterialRequest {
  anchor?: MaterialAnchor;
  block: number;
  points: MaterialPoint[];
  mode?: "fill" | "plant";
  coverage?: MaterialCoverage;
}

export type CodeTarget =
  | { kind: "point" }
  | { kind: "path"; codes: [Code, Code]; anchors: [number, number] }
  | { kind: "region"; centre: Code; selectionRadius: number; lambda: number };

/** New regions use nearest-target attraction alone; saved explicit weights stay unchanged. */
export const DEFAULT_REGION_COVERAGE = 0;

export interface Request {
  id: number;
  block: number;
  /**
   * Respond like: push painted codes toward `code`. The term is the strength-weighted
   * mean of d² ÷ ‖code‖², scaled by peak strength and averaged over views. A CLS or storage
   * request measures its own slot instead; its area is stored empty and ignored.
   */
  respondLike: Term & {
    source: Token;
    /** The recorded code of `source` in `block`, copied from the observation record. Never recomputed. */
    code: [number, number, number];
    target: CodeTarget;
    /** Scales target codes about the origin after selecting a region. */
    radius: number;
    where: Area;
    /**
     * More blocks of the source token's address, strongest first, that this request also asks
     * for the token's codes (format 6). With k = 1 + this length blocks, `block` and each of these
     * are asked on the same cells at weight ÷ k. Empty: `block` alone, as in formats 1–5.
     */
    alsoBlocks: AddressBlock[];
  };
  /**
   * Look like: match the feature distribution of the painted cells to the references' windows.
   * Independent of the Respond like area.
   */
  lookLike: Term & {
    /** At most 12, distinct images. */
    references: Reference[];
    where: Area;
  };
}

/**
 * One block of a token's address and the token's gain-free code in it, copied from the
 * release's address file. Never recomputed.
 */
export interface AddressBlock {
  block: number;
  code: [number, number, number];
}

/** Every token is read by its 32 strongest blocks (the dictionary's top K), so a request asks at most 32. */
export const MAX_CODE_BLOCKS = 32;

export interface Recipe {
  format: 7;
  /** Release name; pins library, encoder, dictionary and calibration. */
  release: string;
  seed: number;
  /** At most 4. */
  requests: Request[];
  /** 256 cells. A protected cell keeps the base image's pixels; the optimizer cannot change them. */
  protect: boolean[];
  rules: { tv: Term; l2: Term };
  /**
   * Motion applied to the image once per update, outside the objective. `zoomPerUpdate` scales the
   * image about its centre by (1 + this fraction) every update, like DeepDream's zoom; 0 = no motion.
   * The structural parser fills a missing `motion` with MOTION_OFF so earlier format-2 recipes open.
   */
  motion: { zoomPerUpdate: number };
  /** How the optimizer moves the picture. Adam's coefficients and the jitter are the engine's. */
  optimizer: Optimizer;
}

/**
 * The settings of the optimizer that change where a request lands or what the change looks like.
 */
export interface Optimizer {
  /**
   * Adam's step size, the peak of each update's move. Bigger arrives sooner and lands farther
   * from the start.
   */
  step: OptimizerStep;
  /**
   * The step's multiplier per pyramid level: "even" is 1 at every level; "coarse" is 4, 2.83, 2,
   * 1.41 and 1 from the 16 × 16 level to the 256 × 256 level (synthesis/objective.ts). The
   * Canvas calls it "detail": "even" shows as fine, "coarse" as coarse (presentation.ts).
   */
  scale: OptimizerScale;
  /** The shifted second view is also blurred (Gaussian, σ = 1 px), so the code survives a blur; about a quarter more updates. */
  robustView: boolean;
}

/** The four step sizes: a half, one, two and four times the default; the Canvas reads them ½, 1, 2 and 4. */
export const OPTIMIZER_STEPS = [0.0125, 0.025, 0.05, 0.1] as const;
export type OptimizerStep = (typeof OPTIMIZER_STEPS)[number];
export const OPTIMIZER_SCALES = ["even", "coarse"] as const;
export type OptimizerScale = (typeof OPTIMIZER_SCALES)[number];

/**
 * A new canvas starts at step 0.025, also used before format 5. Step 0.05 converges sooner
 * but can paint a blocky texture on real pictures.
 */
export const OPTIMIZER_DEFAULT: Optimizer = { step: 0.025, scale: "even", robustView: false };
/** A recipe saved before format 5: the engine's former constant step, so its run repeats. */
export const OPTIMIZER_BEFORE_FORMAT_5: Optimizer = { step: 0.025, scale: "even", robustView: false };

export const MOTION_OFF = { zoomPerUpdate: 0 } as const;
/** The largest zoom per update the engine accepts: 5% per update is already a fast dive. */
export const MAX_ZOOM_PER_UPDATE = 0.05;

/** Tunable defaults, kept together. Adam's coefficients are fixed by the numerical profile; its step is `optimizer.step`. */
export const RECIPE_DEFAULTS = {
  /** Code starts level with Appearance. */
  respondLikeWeight: 1,
  lookLikeWeight: 1,
  tvWeight: 0,
  l2Weight: 0,
  maxRequests: 4,
  maxReferences: 12,
  /** A reference patch starts with its own cell and the eight neighbours as its source window. */
  initialWhereRadius: 1,
} as const;

export const GRID = 16;
export const CELLS = GRID * GRID;
export const PATCH_SLOT_OFFSET = 5;
export const TOKEN_SLOTS = 261;

export function patchSlot(row: number, column: number): number {
  return PATCH_SLOT_OFFSET + row * GRID + column;
}

/** Integer domains the engine's wire format can carry. */
export const MAX_SEED = 2 ** 32 - 1;
/**
 * The engine asks a request's other blocks as requests of their own, with the ids
 * id + j × 2^24 (synthesis/objective.ts), so a recipe's request ids stay below 2^24.
 */
export const MAX_REQUEST_ID = 2 ** 24 - 1;

/**
 * Returns the semantic problems with a structurally valid recipe, or an empty list. It assumes the
 * shape is already right: every boundary that receives untrusted JSON (file import, gallery
 * submissions) must run the structural parser first, then this. At most 4 × 12 = 48 reference
 * images can be required by one recipe; the engine's reference cache relies on that bound.
 * Pass `limits.blocks` (the release's block count) wherever the release is known.
 */
export function validateRecipe(recipe: Recipe, limits: { blocks?: number } = {}): string[] {
  const problems: string[] = [];
  if (recipe.format !== 7) problems.push("unsupported image-editing configuration format");
  if (!recipe.release) problems.push("the image-editing configuration does not name a release");
  if (!Number.isInteger(recipe.seed) || recipe.seed < 0 || recipe.seed > MAX_SEED) {
    problems.push(`seed must be an integer between 0 and ${MAX_SEED}`);
  }
  if (recipe.requests.length > RECIPE_DEFAULTS.maxRequests) problems.push("too many editing constraints");
  if (recipe.protect.length !== CELLS) problems.push("protect must have 256 cells");
  const ids = new Set<number>();
  for (const request of recipe.requests) {
    if (ids.has(request.id)) problems.push(`duplicate constraint id ${request.id}`);
    ids.add(request.id);
    if (!Number.isInteger(request.id) || request.id < 0 || request.id > MAX_REQUEST_ID) {
      problems.push(`constraint ${request.id}: id must be an integer between 0 and ${MAX_REQUEST_ID}`);
    }
    if (!Number.isInteger(request.block) || request.block < 0 || (limits.blocks !== undefined && request.block >= limits.blocks)) {
      problems.push(`constraint ${request.id}: basis group ${request.block} is outside the basis collection`);
    }
    const { respondLike, lookLike } = request;
    if (!Number.isInteger(respondLike.source.slot) || respondLike.source.slot < 0 || respondLike.source.slot >= TOKEN_SLOTS) {
      problems.push(`constraint ${request.id}: source slot must be between 0 and ${TOKEN_SLOTS - 1}`);
    }
    if (respondLike.where.length !== CELLS) problems.push(`constraint ${request.id}: the Respond like area must have 256 cells`);
    if (lookLike.where.length !== CELLS) problems.push(`constraint ${request.id}: the Look like area must have 256 cells`);
    if (!respondLike.where.every(isPaintStrength)) problems.push(`constraint ${request.id}: Response strengths must be integers between 0 and 100`);
    if (!lookLike.where.every(isPaintStrength)) problems.push(`constraint ${request.id}: Appearance strengths must be integers between 0 and 100`);
    const codeNorm = respondLike.code.reduce((sum, c) => sum + c * c, 0);
    problems.push(...targetProblems(request).map((problem) => `constraint ${request.id}: ${problem}`));
    if (respondLike.target.kind === "point" && respondLike.enabled && codeNorm <= 1e-12) problems.push(`constraint ${request.id}: the target response vector has no direction`);
    problems.push(...alsoBlockProblems(request, limits));
    if (respondLike.enabled && respondLike.source.role === "patch" && !respondLike.where.some(Boolean)) {
      problems.push(`constraint ${request.id}: Respond like is on but no area is painted`);
    }
    if (lookLike.references.length > RECIPE_DEFAULTS.maxReferences) problems.push(`constraint ${request.id}: too many references`);
    const images = new Set(lookLike.references.map((r) => r.token.imageId));
    if (images.size !== lookLike.references.length) problems.push(`constraint ${request.id}: references must be distinct images`);
    if (lookLike.enabled && lookLike.weight > 0 && lookLike.references.length === 0) {
      problems.push(`constraint ${request.id}: Look like is on but has no references`);
    }
    if (lookLike.enabled && lookLike.weight > 0 && !lookLike.where.some(Boolean)) {
      problems.push(`constraint ${request.id}: Look like is on but no area is painted`);
    }
    for (const reference of lookLike.references) {
      if (reference.source.length !== CELLS || !reference.source.some(Boolean)) {
        problems.push(`constraint ${request.id}: a reference needs a non-empty source window`);
      }
    }
  }
  const terms: Array<[string, Term]> = [
    ["TV", recipe.rules.tv],
    ["L2", recipe.rules.l2],
    ...recipe.requests.flatMap((r): Array<[string, Term]> => [
      [`constraint ${r.id} Respond like`, r.respondLike],
      [`constraint ${r.id} Look like`, r.lookLike],
    ]),
  ];
  for (const [name, term] of terms) {
    if (!Number.isFinite(term.weight) || term.weight < 0) problems.push(`${name}: weight must be a finite non-negative number`);
  }
  const zoom = recipe.motion.zoomPerUpdate;
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > MAX_ZOOM_PER_UPDATE) {
    problems.push(`zoom per optimizer update must be between 0 and ${MAX_ZOOM_PER_UPDATE}`);
  }
  if (!isOptimizerStep(recipe.optimizer.step)) problems.push(`the step must be one of ${OPTIMIZER_STEPS.join(", ")}`);
  if (!isOptimizerScale(recipe.optimizer.scale)) problems.push(`the scale must be one of ${OPTIMIZER_SCALES.join(", ")}`);
  return problems;
}

/** The request's other blocks: at most 31, distinct, inside the dictionary, not its own block, each with a direction. */
function alsoBlockProblems(request: Request, limits: { blocks?: number }): string[] {
  const problems: string[] = [];
  const { alsoBlocks } = request.respondLike;
  if (alsoBlocks.length > MAX_CODE_BLOCKS - 1) problems.push(`constraint ${request.id}: a constraint uses at most ${MAX_CODE_BLOCKS} basis groups`);
  const blocks = new Set<number>([request.block]);
  for (const { block, code } of alsoBlocks) {
    if (!Number.isInteger(block) || block < 0 || (limits.blocks !== undefined && block >= limits.blocks)) {
      problems.push(`constraint ${request.id}: basis group ${block} is outside the basis collection`);
    }
    if (blocks.has(block)) problems.push(`constraint ${request.id}: basis group ${block} is used twice`);
    blocks.add(block);
    const norm = code.reduce((sum, c) => sum + c * c, 0);
    if (request.respondLike.enabled && norm <= 1e-12) problems.push(`constraint ${request.id}: the response vector in basis group ${block} has no direction`);
  }
  return problems;
}

export function isOptimizerStep(value: unknown): value is OptimizerStep {
  return OPTIMIZER_STEPS.some((step) => step === value);
}

export function isOptimizerScale(value: unknown): value is OptimizerScale {
  return OPTIMIZER_SCALES.some((scale) => scale === value);
}

/** The stored percentage domain, shared by parsing and in-memory validation. */
export function isPaintStrength(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}
