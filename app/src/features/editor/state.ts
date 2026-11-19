// The editor's state: the desired recipe, its revision, and presentation choices.
//
// Revision rule: an action that changes the recipe increments the revision;
// every other action leaves it alone. model.ts returns the same recipe object
// when an operation has no effect, so `withRecipe` is the only place the rule lives.
// The run session (run/session.ts) labels frames with the revision that produced them.
//
// Selection rule: the selected term (or Protect, or Noise) is what the brush paints
// and what the canvas shows. Choosing or editing a request's term selects it; Escape
// or a click beside the canvas clears the selection. See `selectionAfter*` below. A
// Noise stroke is not a recipe edit: it goes to the worker when it ends (noise.ts).
//
// Lock rule: a request's Code and Appearance areas are linked by default, so a stroke
// paints both, whichever of the two is selected. Unlinked, a stroke paints the selected
// term's area alone. A CLS or storage request has an Appearance area only. The lock is a
// way of painting, not part of the objective, so it is not in the recipe.
//
// Held rule: a token sent to the canvas from a basis group's page (look/look-page.tsx) is held, not yet a
// request, and selected. Its first painting stroke makes the request, with that stroke
// as both of its areas. A request without an area cannot run, so it stays out of the
// recipe until then. One token is held at a time; it counts toward the four requests.
//
// Gallery rule: a Gallery entry opened here is not the visitor's until
// they change it (`fromGallery`). Until then the autosave writes no record and no reopen
// pointer (app/creation-autosave.ts), so leaving the page discards it, and the canvas
// names it as from the gallery. The first change makes it theirs for good: a numerical
// edit (`withRecipe`: a stroke on an area, a drop, the seed, a weight, a run setting), a new title, a
// colour picked for a request (inks.ts), or a
// command that changes its image (`changeImage`: Play, Step, a Noise stroke).

import type { CodeTarget } from "../../recipe";
import type { Code, TokenHandoff } from "../../app/handoff";
import type { TokenAddress } from "../../library/addresses";
import { MAX_ZOOM_PER_UPDATE, RECIPE_DEFAULTS, type Optimizer, type Recipe, type Request, type Token } from "../../recipe";
import type { UpgradedFrom } from "../../recipe-parse";
import { DEFAULT_BRUSH, clampBrushOpacity, clampBrushSize, type Brush } from "./canvas/brush";
import {
  NO_INK_CHOICES,
  clearRequestInk,
  clearTermInk,
  forgetInk,
  linkInk,
  pickRequestInk,
  pickTermInk,
  unlockedByInks,
  type InkChoices,
  type InkTarget,
} from "./inks";
import {
  addReference,
  applyAreaStroke,
  applyProtectStroke,
  applyRequestStroke,
  createPaintedRequest,
  createRecipe,
  parseRequestTermId,
  removeReference,
  removeRequest,
  retargetRequest,
  setCodeTarget,
  setCodeRadius,
  setPathAnchor,
  setCodeBlockCount,
  setOptimizer,
  setProtect,
  setReferences,
  setSeed,
  setSourceWindow,
  setTermEnabled,
  setTermWeight,
  setZoomPerUpdate,
  hasPaintedRespondArea,
  type AreaTerm,
  type Stroke,
  type TermId,
} from "./model";
import { CELLS } from "../../recipe";

/** What the brush paints and the canvas shows: one term's area of one request, Protect, Noise, or the held token. */
export type Selection =
  | { kind: "term"; requestId: number; term: AreaTerm }
  | { kind: "protect" }
  | { kind: "noise" }
  /** The held token (`EditorState.heldRequest`): the first stroke makes its request. */
  | { kind: "held" };

/**
 * A saved creation's or Gallery entry's picture, which Open continues the run from: the PNG
 * bytes and the updates it had. Its provenance stays with it until an update of this session
 * replaces it (app/creation-autosave.ts): the engine build that made it, absent when unknown, and
 * `upgradedFrom` when an earlier objective made it (storage/creations.ts).
 */
export interface StoredPicture {
  png: Uint8Array;
  step: number;
  engine?: string;
  upgradedFrom?: UpgradedFrom;
}

/** The picture of the creation opened as generation `opened`, at the revision the open made. */
export interface OpenedPicture extends StoredPicture {
  opened: number;
  revision: number;
}

/** The one-line message of a refused request. */
export const REQUEST_LIMIT_MESSAGE = "the image holds at most four editing constraints";

export interface EditorState {
  title: string;
  /** The local save record, once the creation has been saved. */
  savedId?: string;
  recipe: Recipe;
  /** Increments on every numerical edit. Never reset, so labels from an older creation stay distinct. */
  revision: number;
  /** Increments when a saved or shared recipe replaces the creation; the run then starts a fresh image. */
  opened: number;
  /** Null: the brush is off and the canvas shows the clean picture (canvas/overlay.ts). */
  selectedTerm: Selection | null;
  /** The next grid click chooses this path anchor, without painting. */
  anchorPick: { requestId: number; endpoint: 0 | 1 } | null;
  /** The brush's size, opacity and erase toggle, for every area the visitor paints. */
  brush: Brush;
  /**
   * The zoom per update that the Zoom switch turns on: the last amount the
   * visitor set this session, or an opened recipe's zoom. It is not in the recipe, where
   * the zoom being off is a zoom of 0, so the recipe's format does not change.
   */
  zoomWhenOn: number;
  /** The visitor's colour picks by request id (inks.ts): with the creation and its Saved record, never in the recipe. */
  inks: InkChoices;
  /** Why the last request was refused, shown on the canvas until the next; null when none. */
  refusal: string | null;
  /**
   * The picture the opened creation continues from: the run restores it once the
   * opened recipe is applied (run/use-run.ts), and the stage shows it meanwhile. Null for a
   * new creation, a Gallery entry whose image could not be read, or a record whose picture
   * is the placeholder.
   */
  openedPicture: OpenedPicture | null;
  /** A token taken to the canvas by a click, waiting for its first stroke (the held rule above); null when none. */
  heldRequest: TokenHandoff | null;
  /** Requests whose two areas are unlinked (the lock rule above); every other request's stroke paints both. */
  separateAreas: number[];
  /** The open still loading, if any (the open rule below). */
  pendingOpen: PendingOpen | null;
  /** True while the creation is a Gallery entry the visitor has not changed (the gallery rule above). */
  fromGallery: boolean;
}

/** Where an opened recipe comes from: a record in Saved, which is the visitor's, or a Gallery entry (the gallery rule). */
export type OpenSource = { kind: "saved"; id: string } | { kind: "gallery" };

/**
 * The open rule. Opening a saved creation, a gallery entry, or the last creation
 * on load must first load it, and the visitor may act meanwhile. An open begins with a
 * ticket (beginOpen) and records the creation as it was then. Its loaded recipe applies
 * only while its ticket is the last one begun and the creation is still the one it began
 * on: no other open, numerical edit, title, colour or held token since. Closing what began
 * the load cancels it (cancelOpen).
 */
export interface PendingOpen {
  ticket: number;
  mark: CreationMark;
}

/** What the visitor's own acts change: opens and resets, numerical edits, the title, a held token. */
interface CreationMark {
  inks: InkChoices;
  opened: number;
  revision: number;
  title: string;
  heldRequest: TokenHandoff | null;
}

function creationMark(state: EditorState): CreationMark {
  return {
    opened: state.opened,
    revision: state.revision,
    title: state.title,
    heldRequest: state.heldRequest,
    inks: state.inks,
  };
}

/** A loaded open applies only if its ticket is the last begun and nothing changed the creation since. */
export function openStillWanted(state: EditorState, ticket: number): boolean {
  const pending = state.pendingOpen;
  if (pending === null || pending.ticket !== ticket) return false;
  const now = creationMark(state);
  return (
    pending.mark.opened === now.opened &&
    pending.mark.revision === now.revision &&
    pending.mark.title === now.title &&
    pending.mark.heldRequest === now.heldRequest &&
    pending.mark.inks === now.inks
  );
}

/** Tunable presentation defaults, kept together. */
export const EDITOR_DEFAULTS = {
  title: "Untitled canvas",
  brush: DEFAULT_BRUSH,
  /**
   * The initial zoom is 0.2 % per update, a gentle outward motion at a constant stride.
   */
  zoomWhenOn: 0.002,
} as const;

export function createEditorState(release: string): EditorState {
  return {
    title: EDITOR_DEFAULTS.title,
    recipe: createRecipe(release),
    revision: 0,
    opened: 0,
    selectedTerm: null,
    anchorPick: null,
    brush: EDITOR_DEFAULTS.brush,
    zoomWhenOn: EDITOR_DEFAULTS.zoomWhenOn,
    refusal: null,
    openedPicture: null,
    heldRequest: null,
    separateAreas: [],
    inks: NO_INK_CHOICES,
    pendingOpen: null,
    fromGallery: false,
  };
}

export type EditorAction =
  | { type: "setCodeTarget"; requestId: number; target: CodeTarget }
  | { type: "setCodeRadius"; requestId: number; radius: number }
  | { type: "pickPathAnchor"; requestId: number; endpoint: 0 | 1 }
  | { type: "placePathAnchor"; cell: number }
  | { type: "cancelPathAnchor" }

  // Numerical edits: each may change the recipe and so the revision.
  | { type: "removeRequest"; requestId: number }
  /** A token sent from the block viewer: held, selected, and made a request by its first stroke. */
  | { type: "holdRequest"; handoff: TokenHandoff }
  /** The held token is let go without a request. */
  | { type: "releaseHeld" }
  /** A finished stroke on the selected area, and on its linked area (the lock rule); ignored when nothing is selected. */
  | { type: "paintSelection"; stroke: Stroke; target?: StrokeTarget }
  | { type: "clearProtect" }
  | { type: "setReferences"; requestId: number; tokens: Token[] }
  | { type: "addReference"; requestId: number; token: Token }
  | { type: "removeReference"; requestId: number; imageId: number }
  | { type: "setSourceWindow"; requestId: number; imageId: number; source: boolean[] }
  | { type: "setTermEnabled"; termId: TermId; enabled: boolean }
  | { type: "setTermWeight"; termId: TermId; weight: number }
  /** The card's "blocks" stepper: how many blocks of its token's address the request asks; more need the token's address. */
  | { type: "setCodeBlocks"; requestId: number; count: number; address: TokenAddress | null }
  /** The code space's drag or "Random token": another recorded token of the block becomes the target (model.ts). */
  | {
      type: "retargetRequest";
      requestId: number;
      opened: number;
      expectedSource: Token;
      expectedTarget: CodeTarget;
      token: Token;
      code: Code;
      address: TokenAddress | null;
    }
  | { type: "setSeed"; seed: number }
  /** The Zoom switch: on applies the remembered amount (zoomWhenOn), off a zoom of 0. */
  | { type: "setZoomOn"; on: boolean }
  /** The Zoom stepper: the amount is remembered, and applied while the zoom is on. */
  | { type: "setZoomAmount"; zoomPerUpdate: number }
  /** A run setting under the transport: the stride, the scale or the far view (recipe.optimizer). */
  | { type: "setOptimizer"; change: Partial<Optimizer> }
  /** Clear: a new, empty creation of `release` in place of this one (clearCreation). */
  | { type: "clear"; release: string }
  /** An open began loading (open-creation.ts): it supersedes every open begun before it. */
  | { type: "beginOpen"; ticket: number }
  /** What began it closed: its load no longer applies. */
  | { type: "cancelOpen"; ticket: number }
  /**
   * A loaded open, applied under the open rule: a saved record or a Gallery entry replaces the
   * creation, and its picture continues the run.
   */
  | { type: "openRecipe"; ticket: number; recipe: Recipe; title: string; source: OpenSource; picture?: StoredPicture; inks?: InkChoices }
  /** The visitor asks the run to change the image (Play, Step, a Noise stroke): no revision, but a change (the gallery rule). */
  | { type: "changeImage" }
  // Presentation: never changes the revision.
  | { type: "setTitle"; title: string }
  | { type: "activateRequest"; requestId: number }
  | { type: "select"; selection: Selection }
  | { type: "deselect" }
  | { type: "setBrushSize"; size: number }
  | { type: "setBrushOpacity"; opacity: number }
  | { type: "setBrushErasing"; erasing: boolean }
  /** Links or unlinks a request's Code and Appearance areas (the lock rule). */
  | { type: "setAreasLinked"; requestId: number; linked: boolean }
  /** A colour from the request card's picker: for the request while its lock is closed, else for one term (inks.ts). */
  | { type: "pickInk"; requestId: number; target: InkTarget; colour: string }
  /** The picker's Default: the request's colours, or one term's, return to the palette's. */
  | { type: "clearInk"; requestId: number; target: InkTarget }
  /** A save finished. `opened` is the creation generation the save captured. */
  | { type: "saved"; savedId: string; opened: number };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "removeRequest":
      return removeRequestState(state, action.requestId);
    case "holdRequest":
      return holdRequest(state, action.handoff);
    case "releaseHeld":
      if (state.heldRequest === null) return state;
      return { ...state, heldRequest: null, selectedTerm: state.selectedTerm?.kind === "held" ? null : state.selectedTerm };
    case "paintSelection":
      return paintSelection(state, action.stroke, action.target);
    case "clearProtect":
      return withRecipe(state, setProtect(state.recipe, new Array<boolean>(CELLS).fill(false)));
    case "setReferences":
      return selectTerm(
        withRecipe(state, setReferences(state.recipe, action.requestId, action.tokens)),
        action.requestId,
        "look",
      );
    case "addReference":
      return selectTerm(withRecipe(state, addReference(state.recipe, action.requestId, action.token)), action.requestId, "look");
    case "removeReference":
      return selectTerm(
        withRecipe(state, removeReference(state.recipe, action.requestId, action.imageId)),
        action.requestId,
        "look",
      );
    case "setSourceWindow":
      return selectTerm(
        withRecipe(state, setSourceWindow(state.recipe, action.requestId, action.imageId, action.source)),
        action.requestId,
        "look",
      );
    case "setTermEnabled":
      return selectEditedTerm(withRecipe(state, setTermEnabled(state.recipe, action.termId, action.enabled)), action.termId);
    case "setTermWeight":
      return selectEditedTerm(withRecipe(state, setTermWeight(state.recipe, action.termId, action.weight)), action.termId);
    case "setCodeTarget": {
      const next = withRecipe(state, setCodeTarget(state.recipe, action.requestId, action.target));
      if (next === state && state.anchorPick === null) return state;
      return { ...next, anchorPick: null };
    }
    case "setCodeRadius":
      return withRecipe(state, setCodeRadius(state.recipe, action.requestId, action.radius));
    case "pickPathAnchor":
      return beginAnchorPick(state, action.requestId, action.endpoint);
    case "placePathAnchor": {
      if (!state.anchorPick) return state;
      const { requestId, endpoint } = state.anchorPick;
      return { ...withRecipe(state, setPathAnchor(state.recipe, requestId, endpoint, action.cell)), anchorPick: null };
    }
    case "cancelPathAnchor":
      return state.anchorPick === null ? state : { ...state, anchorPick: null };
    case "setCodeBlocks":
      return withRecipe(state, setCodeBlockCount(state.recipe, action.requestId, action.count, action.address));
    case "retargetRequest":
      return finishRetarget(state, action);
    case "setSeed":
      return withRecipe(state, setSeed(state.recipe, action.seed));
    case "setZoomOn":
      return turnZoom(state, action.on);
    case "setZoomAmount":
      return setZoomAmount(state, action.zoomPerUpdate);
    case "setOptimizer":
      return withRecipe(state, setOptimizer(state.recipe, action.change));
    case "beginOpen":
      return { ...state, pendingOpen: { ticket: action.ticket, mark: creationMark(state) } };
    case "cancelOpen":
      return state.pendingOpen?.ticket === action.ticket ? { ...state, pendingOpen: null } : state;
    case "openRecipe":
      return openCreation(state, action);
    case "clear":
      return clearCreation(state, action.release);
    case "changeImage":
      return state.fromGallery ? { ...state, fromGallery: false } : state;
    case "setTitle":
      // A new title is a change, so a Gallery entry becomes the visitor's (the gallery rule).
      return action.title === state.title ? state : { ...state, title: action.title, fromGallery: false };
    case "activateRequest":
      return selectRequest(state, action.requestId);
    case "select":
      return select(state, action.selection);
    case "deselect":
      return state.selectedTerm === null && !state.anchorPick ? state : { ...state, selectedTerm: null, anchorPick: null };
    case "setBrushSize":
      return setBrush(state, { ...state.brush, size: clampBrushSize(action.size) });
    case "setBrushOpacity":
      return setBrush(state, { ...state.brush, opacity: clampBrushOpacity(action.opacity) });
    case "setBrushErasing":
      return setBrush(state, { ...state.brush, erasing: action.erasing });
    case "setAreasLinked":
      return setAreasLinked(state, action.requestId, action.linked);
    case "pickInk":
      return withInks(
        state,
        action.target === "request"
          ? pickRequestInk(state.inks, action.requestId, action.colour)
          : pickTermInk(state.inks, action.requestId, action.target, action.colour),
      );
    case "clearInk":
      return withInks(
        state,
        action.target === "request" ? clearRequestInk(state.inks, action.requestId) : clearTermInk(state.inks, action.requestId, action.target),
      );
    case "saved":
      // A save of an earlier creation must not attach its record to the one opened since.
      if (action.opened !== state.opened || action.savedId === state.savedId) return state;
      return { ...state, savedId: action.savedId };
  }
}

/** Remove a request and clear any selection, anchor pick, unlink state, or custom ink tied to it. */
function removeRequestState(state: EditorState, requestId: number): EditorState {
  const next = withRecipe(state, removeRequest(state.recipe, requestId));
  if (next === state) return state;
  return {
    ...next,
    selectedTerm: selectionOn(state.selectedTerm, requestId) ? null : state.selectedTerm,
    anchorPick: state.anchorPick?.requestId === requestId ? null : state.anchorPick,
    // Request ids can return after a removal; a new request starts linked, in its default colours.
    separateAreas: state.separateAreas.filter((id) => id !== requestId),
    inks: forgetInk(state.inks, requestId),
  };
}

/** Replace the current creation with an opened saved record or gallery entry if its ticket is still active. */
function openCreation(state: EditorState, action: Extract<EditorAction, { type: "openRecipe" }>): EditorState {
  if (!openStillWanted(state, action.ticket)) return state;
  const inks = action.inks ?? NO_INK_CHOICES;
  return {
    ...state,
    pendingOpen: null,
    title: action.title,
    savedId: action.source.kind === "saved" ? action.source.id : undefined,
    fromGallery: action.source.kind === "gallery",
    recipe: action.recipe,
    revision: state.revision + 1,
    opened: state.opened + 1,
    // A zooming recipe brings its amount; one without zoom keeps the session's.
    zoomWhenOn: action.recipe.motion.zoomPerUpdate > 0 ? action.recipe.motion.zoomPerUpdate : state.zoomWhenOn,
    selectedTerm: null,
    anchorPick: null,
    refusal: null,
    heldRequest: null,
    // A Saved record's colours come back; a request with its own Appearance colour reopens unlocked.
    inks,
    separateAreas: unlockedByInks(inks).filter((id) => action.recipe.requests.some((request) => request.id === id)),
    openedPicture: action.picture ? { ...action.picture, opened: state.opened + 1, revision: state.revision + 1 } : null,
  };
}

/**
 * Clear removes the name, requests, held token and selections. The run starts a fresh
 * image from the default seed, since a new creation opens. The record of the
 * creation it replaces stays in Saved. The brush and the zoom's remembered amount stay: they
 * are the visitor's settings, not the creation's.
 */
function clearCreation(state: EditorState, release: string): EditorState {
  return {
    ...createEditorState(release),
    // Counters never go back, so frames and saves of the creation before stay distinct.
    revision: state.revision + 1,
    opened: state.opened + 1,
    brush: state.brush,
    zoomWhenOn: state.zoomWhenOn,
  };
}

/**
 * The revision rule: a different recipe object is a numerical edit. A numerical edit is
 * also a change, so a Gallery entry becomes the visitor's (the gallery rule).
 */
function withRecipe(state: EditorState, recipe: Recipe): EditorState {
  if (recipe === state.recipe) return state;
  return { ...state, recipe, revision: state.revision + 1, fromGallery: false };
}

/** Whether the creation has room to hold a token: a held token is replaced, so it does not count. */
export function canHoldRequest(state: EditorState): boolean {
  return state.recipe.requests.length < RECIPE_DEFAULTS.maxRequests;
}

/**
 * Holds a clicked token, selected for the brush, in place of one already held; refused when
 * the creation is full.
 */
function holdRequest(state: EditorState, handoff: TokenHandoff): EditorState {
  if (!canHoldRequest(state)) return { ...state, refusal: REQUEST_LIMIT_MESSAGE };
  return { ...state, heldRequest: handoff, selectedTerm: { kind: "held" }, anchorPick: null, refusal: null };
}

/**
 * The held token's first painting stroke makes its request, with the stroke as both of its
 * areas, and selects it. An erasing or empty stroke has nothing to place.
 */
function placeHeld(state: EditorState, stroke: Stroke): EditorState {
  const handoff = state.heldRequest;
  if (!handoff || stroke.mode !== "paint" || !stroke.cells.some(Boolean)) return state;
  const released = { ...state, heldRequest: null };
  const recipe = createPaintedRequest(state.recipe, handoff, stroke.cells);
  if (recipe === state.recipe) return { ...released, selectedTerm: null, refusal: REQUEST_LIMIT_MESSAGE };
  const created = recipe.requests[recipe.requests.length - 1];
  return selectRequest(withRecipe(released, recipe), created.id);
}

/** A gesture keeps its target and lock scope from pointer-down. */
export interface StrokeTarget {
  selection: Selection;
  scope: StrokeScope;
  opened: number;
}

function paintSelection(state: EditorState, stroke: Stroke, target?: StrokeTarget): EditorState {
  // Only a different creation cancels the gesture; an unrelated edit keeps it.
  if (target && target.opened !== state.opened) return state;
  const selection = target?.selection ?? state.selectedTerm;
  if (selection === null) return state;
  if (selection.kind === "held") return placeHeld(state, stroke);
  const scope = target?.scope ?? strokeScope(state, selection);
  return withRecipe(state, applyScopedStroke(state.recipe, selection, stroke, scope));
}

function setBrush(state: EditorState, brush: Brush): EditorState {
  const before = state.brush;
  if (before.size === brush.size && before.opacity === brush.opacity && before.erasing === brush.erasing) return state;
  return { ...state, brush };
}

/** Whether a request's two areas take one stroke together: linked unless the visitor unlinked them. */
export function areasLinked(state: Pick<EditorState, "separateAreas">, requestId: number): boolean {
  return !state.separateAreas.includes(requestId);
}

/**
 * The lock rule: what a stroke on the selection reaches. A selected term of a request with
 * both areas reaches both while they are linked; otherwise the selection alone.
 */
export function strokeScope(state: Pick<EditorState, "recipe" | "separateAreas">, selection: Selection | null): StrokeScope {
  if (selection?.kind !== "term") return "term";
  const request = state.recipe.requests.find((candidate) => candidate.id === selection.requestId);
  if (!request || !hasPaintedRespondArea(request.respondLike.source)) return "term";
  return areasLinked(state, request.id) ? "request" : "term";
}

/** The selection the brush can paint: Protect, Noise, the held token, or a term with a paintable area. */
export function paintableSelection(recipe: Recipe, selection: Selection | null): Selection | null {
  if (selection?.kind !== "term") return selection;
  const request = recipe.requests.find((candidate) => candidate.id === selection.requestId);
  if (!request) return null;
  if (selection.term === "respond" && !hasPaintedRespondArea(request.respondLike.source)) return null;
  return selection;
}

/**
 * The terms of a request that a stroke paints now, for the card's brush glyphs: none unless a
 * term of this request is selected; both while the lock rule links them; else the selected
 * one, where it has an area (a CLS or storage request's Code has none).
 */
export function paintedTerms(state: Pick<EditorState, "recipe" | "separateAreas" | "selectedTerm">, requestId: number): { respond: boolean; look: boolean } {
  const selection = state.selectedTerm;
  if (selection?.kind !== "term" || selection.requestId !== requestId) return { respond: false, look: false };
  if (strokeScope(state, selection) === "request") return { respond: true, look: true };
  const request = state.recipe.requests.find((candidate) => candidate.id === requestId);
  const respondPaints = selection.term === "respond" && request !== undefined && hasPaintedRespondArea(request.respondLike.source);
  return { respond: respondPaints, look: selection.term === "look" };
}

function setAreasLinked(state: EditorState, requestId: number, linked: boolean): EditorState {
  if (!state.recipe.requests.some((request) => request.id === requestId)) return state;
  if (areasLinked(state, requestId) === linked) return state;
  const separateAreas = linked ? state.separateAreas.filter((id) => id !== requestId) : [...state.separateAreas, requestId];
  // Closing the lock joins the colours too: the Appearance tone follows the ink again (inks.ts).
  return { ...state, separateAreas, inks: linked ? linkInk(state.inks, requestId) : state.inks };
}

/** A colour pick is the visitor's change: a Gallery entry becomes theirs (the gallery rule). */
function withInks(state: EditorState, inks: InkChoices): EditorState {
  return inks === state.inks ? state : { ...state, inks, fromGallery: false };
}

/**
 * A stroke goes to the selected area: a term of a request, or Protect. The canvas
 * previews a draft stroke with it. A Noise stroke changes no recipe (noise.ts sends it).
 */
export function applySelectionStroke(recipe: Recipe, selection: Selection, stroke: Stroke): Recipe {
  if (selection.kind === "noise" || selection.kind === "held") return recipe;
  if (selection.kind === "protect") return applyProtectStroke(recipe, stroke);
  return applyAreaStroke(recipe, selection.requestId, selection.term, stroke);
}

/** What a stroke reaches: the selected term alone, or both areas of its request (the lock rule). */
export type StrokeScope = "term" | "request";

/** The stroke applied to what it reaches: one term, or both areas of a linked request. */
export function applyScopedStroke(recipe: Recipe, selection: Selection, stroke: Stroke, scope: StrokeScope): Recipe {
  if (scope === "request" && selection.kind === "term") return applyRequestStroke(recipe, selection.requestId, stroke);
  return applySelectionStroke(recipe, selection, stroke);
}

/** Selects a term, Protect, Noise or the held token. A term of a request that does not exist, or no held token, leaves the state unchanged. */
function select(state: EditorState, selection: Selection): EditorState {
  if (selection.kind === "held") {
    if (state.heldRequest === null) return state;
    return state.selectedTerm?.kind === "held" ? state : { ...state, selectedTerm: selection, anchorPick: null };
  }
  if (selection.kind !== "term") {
    return state.selectedTerm?.kind === selection.kind ? state : { ...state, selectedTerm: selection, anchorPick: null };
  }
  return selectTerm(state, selection.requestId, selection.term);
}

/** Selects one term of a request. */
function selectTerm(state: EditorState, requestId: number, term: AreaTerm): EditorState {
  if (!state.recipe.requests.some((request) => request.id === requestId)) return state;
  const current = state.selectedTerm;
  const unchanged = current?.kind === "term" && current.requestId === requestId && current.term === term;
  if (unchanged) return state;
  return { ...state, selectedTerm: { kind: "term", requestId, term }, anchorPick: null };
}

/** Selecting a request shows its area: a term of it that is already selected stays, else its first area term. */
function selectRequest(state: EditorState, requestId: number): EditorState {
  const request = state.recipe.requests.find((candidate) => candidate.id === requestId);
  if (!request) return state;
  const current = state.selectedTerm;
  const term = current?.kind === "term" && current.requestId === requestId ? current.term : firstAreaTerm(request);
  return selectTerm(state, requestId, term);
}

/** Respond like, or Look like when the request's Respond like has no painted area (a CLS or storage token). */
function firstAreaTerm(request: Request): AreaTerm {
  return hasPaintedRespondArea(request.respondLike.source) ? "respond" : "look";
}

/** Editing a request term's switch or weight selects that term; other terms leave the selection alone. */
function selectEditedTerm(state: EditorState, termId: TermId): EditorState {
  const parsed = parseRequestTermId(termId);
  if (!parsed) return state;
  return selectTerm(state, parsed.requestId, parsed.row);
}

function selectionOn(selection: Selection | null, requestId: number): boolean {
  return selection?.kind === "term" && selection.requestId === requestId;
}

/** The Zoom switch: on applies the remembered amount, off a zoom of 0; the amount is kept either way. */
function turnZoom(state: EditorState, on: boolean): EditorState {
  return withRecipe(state, setZoomPerUpdate(state.recipe, on ? state.zoomWhenOn : 0));
}

/**
 * The Zoom stepper: the amount is remembered for the session, and while the zoom is on it is
 * the recipe's zoom too. While the zoom is off, nothing of the recipe changes. A zoom of 0 is
 * the switch's, not the stepper's, so an amount outside 0 (excluded) to the maximum changes nothing.
 */
function setZoomAmount(state: EditorState, zoomPerUpdate: number): EditorState {
  if (!(zoomPerUpdate > 0 && zoomPerUpdate <= MAX_ZOOM_PER_UPDATE)) return state;
  const remembered = zoomPerUpdate === state.zoomWhenOn ? state : { ...state, zoomWhenOn: zoomPerUpdate };
  if (state.recipe.motion.zoomPerUpdate === 0) return remembered;
  return withRecipe(remembered, setZoomPerUpdate(remembered.recipe, zoomPerUpdate));
}

/** The blocks of the creation's requests in recipe order, then the held token's, each once: the Atlas's "In use". */
export function requestBlocks(state: Pick<EditorState, "recipe" | "heldRequest">): number[] {
  const blocks = state.recipe.requests.map((request) => request.block);
  if (state.heldRequest) blocks.push(state.heldRequest.block);
  return [...new Set(blocks)];
}


/** An anchor pick belongs to an existing path and ends when its tool or creation changes. */
function beginAnchorPick(state: EditorState, requestId: number, endpoint: 0 | 1): EditorState {
  const request = state.recipe.requests.find((candidate) => candidate.id === requestId);
  if (request?.respondLike.target.kind !== "path") return state;
  return {
    ...state,
    anchorPick: { requestId, endpoint },
    selectedTerm: { kind: "term", requestId, term: "respond" },
  };
}


/** A loaded token can replace only the source and target that started the request. */
function finishRetarget(state: EditorState, action: Extract<EditorAction, { type: "retargetRequest" }>): EditorState {
  const request = state.recipe.requests.find((candidate) => candidate.id === action.requestId);
  if (action.opened !== state.opened || request?.respondLike.source !== action.expectedSource ||
      request.respondLike.target !== action.expectedTarget) return state;
  return withRecipe(state, retargetRequest(state.recipe, action.requestId, { token: action.token, code: action.code }, action.address));
}
