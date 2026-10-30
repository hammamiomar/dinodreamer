import { describe, expect, it } from "vitest";
import type { TokenHandoff } from "../../app/handoff";
import { CELLS, GRID, patchSlot, type Token } from "../../recipe";
import { setZoomPerUpdate, type Cell } from "./model";
import {
  REQUEST_LIMIT_MESSAGE,
  areasLinked,
  canHoldRequest,
  paintedTerms,
  createEditorState,
  editorReducer,
  requestBlocks,
  strokeScope,
  type EditorAction,
  type EditorState,
} from "./state";

const token: Token = { imageId: 7, role: "patch", slot: patchSlot(2, 8) };
/** An action, or a step made of several. */
type Step = EditorAction | ((state: EditorState) => EditorState);

function run(state: EditorState, ...steps: Step[]): EditorState {
  return steps.reduce((current: EditorState, step) => (typeof step === "function" ? step(current) : editorReducer(current, step)), state);
}

/** A creation opened after its load: begun with a ticket, then applied under the open rule. */
function opened(open: Omit<Extract<EditorAction, { type: "openRecipe" }>, "type" | "ticket">): Step {
  return (state) => run(state, { type: "beginOpen", ticket: 1 }, { type: "openRecipe", ticket: 1, ...open });
}

/** A token held, then placed by one stroke on a cell: the way a request is made. */
function added(handoff: TokenHandoff, at: Cell = { row: 2, column: 8 }): Step {
  return (state) => run(state, { type: "holdRequest", handoff }, { type: "paintSelection", stroke: strokeOn(at.row * GRID + at.column) });
}

const create = added({ token, block: 1398, code: [0.4, -0.2, 0.9] });

function withOneRequest(): EditorState {
  return run(createEditorState("pass-003"), create);
}

function strokeOn(cell: number, mode: "paint" | "erase" = "paint") {
  const cells = new Array<number>(CELLS).fill(0);
  cells[cell] = 100;
  return { mode, cells };
}

describe("revision rule", () => {
  it("starts at zero and increments on each numerical edit", () => {
    const start = createEditorState("pass-003");
    expect(start.revision).toBe(0);

    const edited = run(
      start,
      create,
      { type: "setTermWeight", termId: "request:1:respond", weight: 0.5 },
      { type: "paintSelection", stroke: strokeOn(0) },
      { type: "select", selection: { kind: "protect" } },
      { type: "paintSelection", stroke: strokeOn(40) },
      { type: "setSeed", seed: 4 },
      { type: "setZoomOn", on: true },
      { type: "setOptimizer", change: { step: 0.1 } },
      { type: "setOptimizer", change: { step: 0.1 } },
    );
    expect(edited.revision).toBe(7);
  });

  it("does not change on presentation edits", () => {
    const state = withOneRequest();
    const after = run(
      state,
      { type: "setTitle", title: "Collar and ball" },
      { type: "activateRequest", requestId: 1 },
      { type: "select", selection: { kind: "term", requestId: 1, term: "look" } },
      { type: "select", selection: { kind: "protect" } },
      { type: "deselect" },
      { type: "setBrushSize", size: 5 },
      { type: "setBrushOpacity", opacity: 25 },
      { type: "setBrushErasing", erasing: true },
      { type: "saved", savedId: "creation-1", opened: 0 },
    );
    expect(after.revision).toBe(state.revision);
    expect(after.recipe).toBe(state.recipe);
    expect(after.title).toBe("Collar and ball");
    expect(after.savedId).toBe("creation-1");
    expect(after.brush).toEqual({ size: 5, opacity: 25, erasing: true });
  });

  it("does not change on numerical edits that have no effect", () => {
    const state = withOneRequest();
    const after = run(
      state,
      { type: "setTermWeight", termId: "request:1:respond", weight: state.recipe.requests[0].respondLike.weight },
      { type: "setTermEnabled", termId: "rules:tv", enabled: false },
      { type: "paintSelection", stroke: strokeOn(200, "erase") },
      { type: "clearProtect" },
      { type: "removeRequest", requestId: 99 },
    );
    expect(after).toBe(state);
  });

  it("counts a reopened recipe as a new revision", () => {
    const state = withOneRequest();
    const reopened = run(state, opened({ recipe: state.recipe, title: "Saved one", source: { kind: "saved", id: "creation-2" } }));
    expect(reopened.revision).toBe(state.revision + 1);
    expect(reopened.opened).toBe(state.opened + 1);
  });
});

describe("lock rule", () => {
  it("paints both areas of a linked request as one numerical edit, whichever term is selected, and keeps the selection", () => {
    for (const term of ["respond", "look"] as const) {
      const state = run(withOneRequest(), { type: "select", selection: { kind: "term", requestId: 1, term } });
      const painted = editorReducer(state, { type: "paintSelection", stroke: strokeOn(200) });
      expect(painted.revision).toBe(state.revision + 1);
      expect(painted.recipe.requests[0].respondLike.where[200]).toBe(100);
      expect(painted.recipe.requests[0].lookLike.where[200]).toBe(100);
      expect(painted.selectedTerm).toEqual(state.selectedTerm);
      expect(editorReducer(painted, { type: "paintSelection", stroke: strokeOn(200) })).toBe(painted);
    }
  });

  it("paints the selected term alone once the request is unlinked, and both again once linked", () => {
    const state = run(withOneRequest(), { type: "setAreasLinked", requestId: 1, linked: false }, { type: "select", selection: { kind: "term", requestId: 1, term: "look" } });
    expect(areasLinked(state, 1)).toBe(false);
    expect(state.revision).toBe(withOneRequest().revision);
    const painted = editorReducer(state, { type: "paintSelection", stroke: strokeOn(255) });
    expect(painted.recipe.requests[0].lookLike.where[255]).toBe(100);
    expect(painted.recipe.requests[0].respondLike).toBe(state.recipe.requests[0].respondLike);
    expect(painted.recipe.protect).toBe(state.recipe.protect);
    const relinked = run(painted, { type: "setAreasLinked", requestId: 1, linked: true }, { type: "paintSelection", stroke: strokeOn(254) });
    expect(relinked.recipe.requests[0].respondLike.where[254]).toBe(100);
    // Setting the lock it already has changes nothing.
    expect(run(relinked, { type: "setAreasLinked", requestId: 1, linked: true })).toBe(relinked);
  });

  it("tells the card which terms the brush paints: both while linked, the selected one while not, none on another request", () => {
    const linked = withOneRequest();
    expect(paintedTerms(linked, 1)).toEqual({ respond: true, look: true });
    const separate = run(linked, { type: "setAreasLinked", requestId: 1, linked: false });
    expect(paintedTerms(separate, 1)).toEqual({ respond: true, look: false });
    expect(paintedTerms(run(separate, { type: "deselect" }), 1)).toEqual({ respond: false, look: false });
    expect(paintedTerms(linked, 2)).toEqual({ respond: false, look: false });
    const cls = run(createEditorState("pass-003"), added({ token: { imageId: 9, role: "cls", slot: 0 }, block: 3, code: [1, 0, 0] }, { row: 7, column: 7 }), {
      type: "select",
      selection: { kind: "term", requestId: 1, term: "respond" },
    });
    expect(paintedTerms(cls, 1)).toEqual({ respond: false, look: false });
  });

  it("reaches one area for a CLS request, Protect and Noise", () => {
    const cls = run(createEditorState("pass-003"), added({ token: { imageId: 9, role: "cls", slot: 0 }, block: 3, code: [1, 0, 0] }, { row: 7, column: 7 }));
    expect(strokeScope(cls, cls.selectedTerm)).toBe("term");
    expect(strokeScope(cls, { kind: "protect" })).toBe("term");
    expect(strokeScope(withOneRequest(), withOneRequest().selectedTerm)).toBe("request");
  });

  it("starts a returning request id linked, and every request of an opened creation", () => {
    const unlinked = run(withOneRequest(), { type: "setAreasLinked", requestId: 1, linked: false });
    expect(areasLinked(run(unlinked, { type: "removeRequest", requestId: 1 }, create), 1)).toBe(true);
    expect(run(unlinked, opened({ recipe: unlinked.recipe, title: "Other", source: { kind: "gallery" } })).separateAreas).toEqual([]);
  });
});

describe("the Noise selection", () => {
  it("selects like Protect, and its strokes leave the recipe and the revision alone", () => {
    const state = withOneRequest();
    const noise = editorReducer(state, { type: "select", selection: { kind: "noise" } });
    expect(noise.selectedTerm).toEqual({ kind: "noise" });
    expect(editorReducer(noise, { type: "select", selection: { kind: "noise" } })).toBe(noise);
    const painted = editorReducer(noise, { type: "paintSelection", stroke: strokeOn(7) });
    expect(painted).toBe(noise);
    expect(painted.revision).toBe(noise.revision);
    expect(editorReducer(noise, { type: "deselect" }).selectedTerm).toBeNull();
  });
});

describe("save acknowledgements", () => {
  it("ignores an acknowledgement from a creation opened before the current one", () => {
    const openedB = run(withOneRequest(), opened({ recipe: withOneRequest().recipe, title: "B", source: { kind: "saved", id: "creation-b" } }));
    const late = editorReducer(openedB, { type: "saved", savedId: "creation-a", opened: openedB.opened - 1 });
    expect(late).toBe(openedB);
    expect(late.savedId).toBe("creation-b");

    const current = editorReducer(openedB, { type: "saved", savedId: "creation-b2", opened: openedB.opened });
    expect(current.savedId).toBe("creation-b2");
  });
});

describe("selection", () => {
  const second = added({ token: { ...token, imageId: 8 }, block: 12, code: [1, 0, 0] });

  it("selects a new request's Respond like, or Look like for a CLS or storage token", () => {
    const state = withOneRequest();
    expect(state.selectedTerm).toEqual({ kind: "term", requestId: 1, term: "respond" });

    const cls = run(state, added({ token: { imageId: 9, role: "cls", slot: 0 }, block: 3, code: [1, 0, 0] }, { row: 7, column: 7 }));
    expect(cls.selectedTerm).toEqual({ kind: "term", requestId: 2, term: "look" });
  });

  it("sends a stroke to Protect when Protect is selected, and nowhere when nothing is", () => {
    const selected = run(withOneRequest(), { type: "select", selection: { kind: "protect" } });
    const protect = editorReducer(selected, { type: "paintSelection", stroke: strokeOn(7) });
    expect(protect.recipe.protect[7]).toBe(true);
    expect(protect.recipe.requests).toBe(selected.recipe.requests);

    const none = run(withOneRequest(), { type: "deselect" });
    expect(none.selectedTerm).toBeNull();
    expect(editorReducer(none, { type: "paintSelection", stroke: strokeOn(7) })).toBe(none);
  });

  it("selects the term whose switch or weight changes, and its request", () => {
    let state = run(withOneRequest(), second);
    expect(state.selectedTerm).toEqual({ kind: "term", requestId: 2, term: "respond" });

    state = editorReducer(state, { type: "setTermEnabled", termId: "request:1:look", enabled: false });
    expect(state.selectedTerm).toEqual({ kind: "term", requestId: 1, term: "look" });

    state = editorReducer(state, { type: "setTermWeight", termId: "rules:tv", weight: 0.1 });
    expect(state.selectedTerm).toEqual({ kind: "term", requestId: 1, term: "look" });
  });

  it("selects Look like when a reference picture changes", () => {
    const state = run(withOneRequest(), { type: "addReference", requestId: 1, token: { ...token, imageId: 30 } });
    expect(state.selectedTerm).toEqual({ kind: "term", requestId: 1, term: "look" });
  });

  it("keeps a selected term when its request is chosen again, and picks Respond like for another request", () => {
    let state = run(withOneRequest(), second, { type: "select", selection: { kind: "term", requestId: 1, term: "look" } });
    const same = editorReducer(state, { type: "activateRequest", requestId: 1 });
    expect(same).toBe(state);

    state = editorReducer(state, { type: "activateRequest", requestId: 2 });
    expect(state.selectedTerm).toEqual({ kind: "term", requestId: 2, term: "respond" });
  });

  it("ignores a selection of a request that does not exist", () => {
    const state = withOneRequest();
    expect(editorReducer(state, { type: "select", selection: { kind: "term", requestId: 9, term: "look" } })).toBe(state);
    expect(editorReducer(state, { type: "activateRequest", requestId: 9 })).toBe(state);
  });

  it("clears the selection of a removed request, and keeps a selection elsewhere", () => {
    let state = run(withOneRequest(), second);
    state = editorReducer(state, { type: "removeRequest", requestId: 2 });
    expect(state.selectedTerm).toBeNull();

    state = run(state, { type: "select", selection: { kind: "protect" } }, { type: "removeRequest", requestId: 1 });
    expect(state.selectedTerm).toEqual({ kind: "protect" });
  });

  it("clears the selection when a recipe is opened", () => {
    const state = withOneRequest();
    const openedB = run(state, opened({ recipe: state.recipe, title: "B", source: { kind: "gallery" } }));
    expect(openedB.selectedTerm).toBeNull();
  });
});

describe("held rule", () => {
  const clicked: EditorAction = { type: "holdRequest", handoff: { token, block: 7656, code: [0.1, 0.5, -0.3] } };
  const cls: EditorAction = { type: "holdRequest", handoff: { token: { imageId: 9, role: "cls", slot: 0 }, block: 2, code: [0.3, 0.1, 0.2] } };

  it("holds a clicked token selected, outside the recipe, until a stroke paints it", () => {
    const start = withOneRequest();
    const held = run(start, clicked);
    expect(held.heldRequest?.block).toBe(7656);
    expect(held.selectedTerm).toEqual({ kind: "held" });
    expect(held.recipe).toBe(start.recipe);
    expect(held.revision).toBe(start.revision);
  });

  it("makes the request from the first painting stroke, as both areas, and selects it", () => {
    const placed = run(withOneRequest(), clicked, { type: "paintSelection", stroke: strokeOn(40) });
    const request = placed.recipe.requests[1]!;
    expect(placed.heldRequest).toBeNull();
    expect(request.block).toBe(7656);
    expect(request.respondLike.where.flatMap((inside, cell) => (inside ? [cell] : []))).toEqual([40]);
    expect(request.lookLike.where.flatMap((inside, cell) => (inside ? [cell] : []))).toEqual([40]);
    expect(placed.selectedTerm).toEqual({ kind: "term", requestId: request.id, term: "respond" });
    expect(placed.revision).toBe(withOneRequest().revision + 1);
  });

  it("gives a CLS token's stroke to its Appearance area alone", () => {
    const placed = run(createEditorState("pass-003"), cls, { type: "paintSelection", stroke: strokeOn(3) });
    const request = placed.recipe.requests[0]!;
    expect(request.respondLike.where.some(Boolean)).toBe(false);
    expect(request.lookLike.where[3]).toBe(100);
    expect(placed.selectedTerm).toEqual({ kind: "term", requestId: request.id, term: "look" });
  });

  it("places nothing on an erasing stroke, and keeps the token held", () => {
    const held = run(withOneRequest(), clicked);
    expect(run(held, { type: "paintSelection", stroke: strokeOn(40, "erase") })).toBe(held);
  });

  it("replaces a held token with the next click, and lets it go on release", () => {
    const second: EditorAction = { type: "holdRequest", handoff: { token, block: 11, code: [1, 0, 0] } };
    const replaced = run(withOneRequest(), clicked, second);
    expect(replaced.heldRequest?.block).toBe(11);
    const released = run(replaced, { type: "releaseHeld" });
    expect(released.heldRequest).toBeNull();
    expect(released.selectedTerm).toBeNull();
    // Deselecting keeps the token held; selecting it again arms the brush.
    const kept = run(replaced, { type: "deselect" }, { type: "select", selection: { kind: "held" } });
    expect(kept.heldRequest?.block).toBe(11);
    expect(kept.selectedTerm).toEqual({ kind: "held" });
    // Nothing held: selecting the held token changes nothing.
    const none = withOneRequest();
    expect(run(none, { type: "select", selection: { kind: "held" } })).toBe(none);
  });

  it("counts the held token toward the four requests, and refuses a token when the creation is full", () => {
    const three = run(withOneRequest(), create, create);
    expect(canHoldRequest(three)).toBe(true);
    const held = run(three, clicked);
    expect(canHoldRequest(held)).toBe(true);
    const full = run(three, create);
    expect(canHoldRequest(full)).toBe(false);
    const refused = run(full, clicked);
    expect(refused.heldRequest).toBeNull();
    expect(refused.refusal).toBe(REQUEST_LIMIT_MESSAGE);
  });

  it("lets go of the held token when another creation opens", () => {
    const held = run(withOneRequest(), clicked);
    const other = run(held, opened({ recipe: held.recipe, title: "Other", source: { kind: "gallery" } }));
    expect(other.heldRequest).toBeNull();
  });

  it("lists the blocks of the requests, then the held token's, each once", () => {
    const state = run(withOneRequest(), create, clicked);
    expect(requestBlocks(state)).toEqual([1398, 7656]);
    expect(requestBlocks(createEditorState("pass-003"))).toEqual([]);
  });
});

describe("gallery rule", () => {
  /** "doggy ear" opened from the Gallery over a new creation: one request, no record. */
  const galleryEntry = (): EditorState =>
    run(createEditorState("pass-003"), opened({ recipe: withOneRequest().recipe, title: "doggy ear", source: { kind: "gallery" } }));

  it("marks a Gallery entry, and neither a record from Saved nor a cleared canvas", () => {
    expect(galleryEntry().fromGallery).toBe(true);
    expect(galleryEntry().savedId).toBeUndefined();
    const saved = run(createEditorState("pass-003"), opened({ recipe: withOneRequest().recipe, title: "Kept", source: { kind: "saved", id: "r1" } }));
    expect(saved.fromGallery).toBe(false);
    expect(saved.savedId).toBe("r1");
    expect(editorReducer(galleryEntry(), { type: "clear", release: "pass-003" }).fromGallery).toBe(false);
  });

  it("makes the entry the visitor's at the first change: a numerical edit, a new title or a command on the image", () => {
    const changes: [string, Step[]][] = [
      ["a stroke", [{ type: "select", selection: { kind: "term", requestId: 1, term: "respond" } }, { type: "paintSelection", stroke: strokeOn(200) }]],
      ["a request", [added({ token: { ...token, imageId: 8 }, block: 7656, code: [0, 1, 0] }, { row: 5, column: 5 })]],
      ["the seed", [{ type: "setSeed", seed: 77 }]],
      ["a weight", [{ type: "setTermWeight", termId: "request:1:respond", weight: 0.5 }]],
      ["a run setting", [{ type: "setOptimizer", change: { robustView: true } }]],
      ["a colour", [{ type: "pickInk", requestId: 1, target: "request", colour: "#ff0000" }]],
      ["a new title", [{ type: "setTitle", title: "doggy ear, mine" }]],
      ["Play, Step or a Noise stroke", [{ type: "changeImage" }]],
    ];
    for (const [change, steps] of changes) expect(run(galleryEntry(), ...steps).fromGallery, change).toBe(false);
  });

  it("keeps the mark through acts that change nothing of the entry", () => {
    const entry = galleryEntry();
    const looked = run(
      entry,
      { type: "setTitle", title: "doggy ear" },
      { type: "setSeed", seed: entry.recipe.seed },
      { type: "setOptimizer", change: { scale: entry.recipe.optimizer.scale } },
      { type: "select", selection: { kind: "term", requestId: 1, term: "look" } },
      { type: "setBrushSize", size: 5 },
      { type: "setAreasLinked", requestId: 1, linked: false },
      { type: "holdRequest", handoff: { token, block: 5, code: [1, 0, 0] } },
    );
    expect(looked.fromGallery).toBe(true);
    expect(looked.revision).toBe(entry.revision);
  });

  it("changes nothing for a command on the image of a creation that is already the visitor's", () => {
    const own = withOneRequest();
    expect(editorReducer(own, { type: "changeImage" })).toBe(own);
  });
});

describe("clear", () => {
  it("clears the name, the requests, the held token and Protect as a new creation, and keeps the brush", () => {
    const busy = run(
      withOneRequest(),
      { type: "setTitle", title: "Collar and ball" },
      { type: "select", selection: { kind: "protect" } },
      { type: "paintSelection", stroke: strokeOn(30) },
      { type: "holdRequest", handoff: { token, block: 5, code: [1, 0, 0] } },
      { type: "setBrushSize", size: 5 },
      { type: "setSeed", seed: 9 },
    );
    const cleared = editorReducer(busy, { type: "clear", release: "pass-003" });
    expect(cleared.title).toBe(createEditorState("pass-003").title);
    expect(cleared.recipe.requests).toEqual([]);
    expect(cleared.recipe.protect.some(Boolean)).toBe(false);
    expect(cleared.recipe.seed).toBe(createEditorState("pass-003").recipe.seed);
    expect(cleared.heldRequest).toBeNull();
    expect(cleared.selectedTerm).toBeNull();
    expect(cleared.savedId).toBeUndefined();
    expect(cleared.openedPicture).toBeNull();
    // A new creation: the run starts a fresh image, and saves of the one before cannot attach to it.
    expect(cleared.opened).toBe(busy.opened + 1);
    expect(cleared.revision).toBe(busy.revision + 1);
    expect(cleared.brush.size).toBe(5);
  });
});

describe("painted fields", () => {
  it("applies one deposit independently to unequal fields while locked", () => {
    const state = withOneRequest();
    const request = state.recipe.requests[0];
    request.respondLike.where[200] = 80;
    request.lookLike.where[200] = 10;
    const stroke = strokeOn(200);
    stroke.cells[200] = 30;
    const next = editorReducer(state, { type: "paintSelection", stroke });
    expect(next.recipe.requests[0].respondLike.where[200]).toBe(100);
    expect(next.recipe.requests[0].lookLike.where[200]).toBe(40);
    const unlocked = editorReducer(next, { type: "setAreasLinked", requestId: 1, linked: false });
    const erased = editorReducer(unlocked, { type: "paintSelection", stroke: { ...stroke, mode: "erase" } });
    expect(erased.recipe.requests[0].respondLike.where[200]).toBe(70);
    expect(erased.recipe.requests[0].lookLike.where[200]).toBe(40);
  });

  it("keeps the target and lock scope captured at pointer-down", () => {
    const before = withOneRequest();
    const target = { selection: { kind: "term" as const, requestId: 1, term: "respond" as const }, scope: "request" as const, opened: before.opened };
    const selectedElsewhere = run(before, { type: "setAreasLinked", requestId: 1, linked: false }, { type: "select", selection: { kind: "protect" } });
    const after = editorReducer(selectedElsewhere, { type: "paintSelection", stroke: strokeOn(200), target });
    expect(after.recipe.requests[0].respondLike.where[200]).toBe(100);
    expect(after.recipe.requests[0].lookLike.where[200]).toBe(100);
    expect(after.recipe.protect[200]).toBe(false);
    const withResolvedDrop = run(before, added({ token: { ...token, imageId: 9 }, block: 10, code: [0, 1, 0] }));
    const kept = editorReducer(withResolvedDrop, { type: "paintSelection", stroke: strokeOn(200), target });
    expect(kept.recipe.requests).toHaveLength(2);
    expect(kept.recipe.requests[0].respondLike.where[200]).toBe(100);
    const replaced = editorReducer(before, { type: "clear", release: "pass-003" });
    expect(editorReducer(replaced, { type: "paintSelection", stroke: strokeOn(200), target })).toBe(replaced);
  });

  it("keeps a token held and makes no numerical edit for a zero stroke", () => {
    const initial = run(createEditorState("pass-003"), { type: "setBrushOpacity", opacity: 0 });
    const held = run(initial, { type: "holdRequest", handoff: { token, block: 1398, code: [0.4, -0.2, 0.9] } });
    expect(held.recipe).toBe(initial.recipe);
    expect(held.heldRequest?.token).toEqual(token);
    const zero = { mode: "paint" as const, cells: new Array<number>(CELLS).fill(0) };
    expect(editorReducer(held, { type: "paintSelection", stroke: zero })).toBe(held);
  });
});

describe("ink picks (inks.ts)", () => {
  it("colours a locked request with one pick, and one term of an unlocked one, outside the recipe and the revision", () => {
    const state = withOneRequest();
    const picked = editorReducer(state, { type: "pickInk", requestId: 1, target: "request", colour: "#ff0000" });
    expect(picked.inks).toEqual({ 1: { code: "#ff0000" } });
    expect(picked.recipe).toBe(state.recipe);
    expect(picked.revision).toBe(state.revision);
    expect(editorReducer(picked, { type: "pickInk", requestId: 1, target: "request", colour: "#ff0000" })).toBe(picked);
    const unlocked = editorReducer(picked, { type: "setAreasLinked", requestId: 1, linked: false });
    expect(unlocked.inks).toBe(picked.inks);
    const look = editorReducer(unlocked, { type: "pickInk", requestId: 1, target: "look", colour: "#0000ff" });
    expect(look.inks).toEqual({ 1: { code: "#ff0000", look: "#0000ff" } });
    expect(editorReducer(look, { type: "clearInk", requestId: 1, target: "respond" }).inks).toEqual({ 1: { look: "#0000ff" } });
    expect(editorReducer(look, { type: "clearInk", requestId: 1, target: "request" }).inks).toEqual({});
  });

  it("joins the colours when the lock closes: a separate Appearance pick goes", () => {
    const state = run(
      withOneRequest(),
      { type: "setAreasLinked", requestId: 1, linked: false },
      { type: "pickInk", requestId: 1, target: "respond", colour: "#ff0000" },
      { type: "pickInk", requestId: 1, target: "look", colour: "#0000ff" },
      { type: "setAreasLinked", requestId: 1, linked: true },
    );
    expect(state.inks).toEqual({ 1: { code: "#ff0000" } });
  });

  it("forgets a removed request's picks, and Clear removes every pick", () => {
    const picked = run(withOneRequest(), { type: "pickInk", requestId: 1, target: "request", colour: "#ff0000" });
    expect(editorReducer(picked, { type: "removeRequest", requestId: 1 }).inks).toEqual({});
    expect(editorReducer(picked, { type: "clear", release: "pass-003" }).inks).toEqual({});
  });

  it("reopens a Saved creation with its picks, a request with its own Appearance colour unlocked; a Gallery entry in the palette's", () => {
    const recipe = withOneRequest().recipe;
    const inks = { 1: { code: "#ff0000", look: "#0000ff" }, 9: { look: "#00ff00" } };
    const saved = run(createEditorState("pass-003"), opened({ recipe, title: "Kept", source: { kind: "saved", id: "r1" }, inks }));
    expect(saved.inks).toEqual(inks);
    expect(areasLinked(saved, 1)).toBe(false);
    expect(saved.separateAreas).toEqual([1]);
    const plain = run(createEditorState("pass-003"), opened({ recipe, title: "Kept", source: { kind: "saved", id: "r1" }, inks: { 1: { code: "#ff0000" } } }));
    expect(areasLinked(plain, 1)).toBe(true);
    const gallery = run(saved, opened({ recipe, title: "doggy ear", source: { kind: "gallery" } }));
    expect(gallery.inks).toEqual({});
  });
});

describe("the zoom switch and its amount", () => {
  const zoomOf = (state: EditorState) => state.recipe.motion.zoomPerUpdate;

  it("turns on at 0.2 % at first, and off to 0", () => {
    const start = withOneRequest();
    expect(zoomOf(start)).toBe(0);
    const on = editorReducer(start, { type: "setZoomOn", on: true });
    expect(zoomOf(on)).toBe(0.002);
    expect(on.revision).toBe(start.revision + 1);
    const off = editorReducer(on, { type: "setZoomOn", on: false });
    expect(zoomOf(off)).toBe(0);
  });

  it("keeps the last amount for the session: off and on again gives it back", () => {
    const set = run(withOneRequest(), { type: "setZoomOn", on: true }, { type: "setZoomAmount", zoomPerUpdate: 0.012 });
    expect(zoomOf(set)).toBe(0.012);
    const again = run(set, { type: "setZoomOn", on: false }, { type: "setZoomOn", on: true });
    expect(zoomOf(again)).toBe(0.012);
  });

  it("changes only the remembered amount while off: no recipe edit, no revision", () => {
    const start = withOneRequest();
    const set = editorReducer(start, { type: "setZoomAmount", zoomPerUpdate: 0.02 });
    expect(zoomOf(set)).toBe(0);
    expect(set.revision).toBe(start.revision);
    expect(set.zoomWhenOn).toBe(0.02);
    expect(zoomOf(editorReducer(set, { type: "setZoomOn", on: true }))).toBe(0.02);
  });

  it("ignores an amount of 0 or past the maximum: the switch is the off", () => {
    const start = withOneRequest();
    expect(editorReducer(start, { type: "setZoomAmount", zoomPerUpdate: 0 })).toBe(start);
    expect(editorReducer(start, { type: "setZoomAmount", zoomPerUpdate: 0.06 })).toBe(start);
  });

  it("takes a zooming recipe's amount when it opens, keeps the session's for one without zoom, and keeps it through Clear", () => {
    const zooming = setZoomPerUpdate(withOneRequest().recipe, 0.003);
    const reopened = run(withOneRequest(), { type: "setZoomAmount", zoomPerUpdate: 0.02 }, opened({ recipe: zooming, title: "Zooming", source: { kind: "saved", id: "z" } }));
    expect(reopened.zoomWhenOn).toBe(0.003);
    const still = run(reopened, opened({ recipe: withOneRequest().recipe, title: "Still", source: { kind: "saved", id: "s" } }));
    expect(still.zoomWhenOn).toBe(0.003);
    expect(editorReducer(still, { type: "clear", release: "pass-003" }).zoomWhenOn).toBe(0.003);
  });
});


describe("path anchor selection lifetime", () => {
  const pathState = () => run(withOneRequest(), {
    type: "setCodeTarget", requestId: 1,
    target: { kind: "path", codes: [[1, 0, 0], [0, 1, 0]], anchors: [0, 255] },
  }, { type: "pickPathAnchor", requestId: 1, endpoint: 0 });

  it("cancels when the request is removed or another creation opens", () => {
    const picking = pathState();
    expect(run(picking, { type: "removeRequest", requestId: 1 }).anchorPick).toBeNull();
    expect(run(picking, opened({ recipe: picking.recipe, title: "Other", source: { kind: "gallery" } })).anchorPick).toBeNull();
  });

  it("cancels on deselection and when another tool is selected", () => {
    const picking = pathState();
    expect(run(picking, { type: "deselect" }).anchorPick).toBeNull();
    expect(run(picking, { type: "select", selection: { kind: "protect" } }).anchorPick).toBeNull();
    expect(run(picking, { type: "select", selection: { kind: "term", requestId: 1, term: "look" } }).anchorPick).toBeNull();
  });

  it("does not start an anchor pick for a missing request or a point target", () => {
    const initial = withOneRequest();
    expect(run(initial, { type: "pickPathAnchor", requestId: 2, endpoint: 0 })).toBe(initial);
    expect(run(initial, { type: "pickPathAnchor", requestId: 1, endpoint: 0 })).toBe(initial);
  });
});
