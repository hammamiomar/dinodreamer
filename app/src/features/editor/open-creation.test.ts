import { describe, expect, it } from "vitest";
import { CELLS, MOTION_OFF, OPTIMIZER_DEFAULT, type Recipe } from "../../recipe";
import type { SavedCreation } from "../../storage/creations";
import type { GalleryEntry } from "../gallery/gallery-api";
import { createRequest } from "./model";
import { openGalleryAction, openSavedAction } from "./open-creation";
import { createEditorState, editorReducer, type EditorState } from "./state";

const recipe: Recipe = {
  format: 7,
  release: "pass-003",
  seed: 4,
  requests: [],
  protect: Array.from({ length: CELLS }, () => false),
  rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: false, weight: 0 } },
  motion: MOTION_OFF,
  optimizer: OPTIMIZER_DEFAULT,
};

function record(extra: Partial<SavedCreation> = {}): SavedCreation {
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 9])], { type: "image/png" });
  return { id: "r1", title: "Kept", createdAt: "", updatedAt: "", recipe, previewPng: png, ...extra };
}

/** The state after an open begun with `ticket`, as beginOpen dispatches it. */
function begun(state: EditorState, ticket: number): EditorState {
  return editorReducer(state, { type: "beginOpen", ticket });
}

describe("opening a saved creation", () => {
  it("continues from its picture at the step it was saved after", async () => {
    const action = await openSavedAction(record({ step: 150 }), 1);
    expect(action.picture?.step).toBe(150);
    expect(Array.from(action.picture!.png)).toEqual([137, 80, 78, 71, 9]);
    const opened = editorReducer(begun(createEditorState("pass-003"), 1), action);
    expect(opened.savedId).toBe("r1");
    expect(opened.fromGallery).toBe(false);
    expect(opened.openedPicture).toMatchObject({ step: 150, opened: 1, revision: 1 });
  });

  it("carries the picture's engine and mark, so the picture keeps them until an update replaces it", async () => {
    const action = await openSavedAction(record({ step: 150, engine: "old-runtime", upgradedFrom: 3 }), 1);
    expect(action.picture).toMatchObject({ step: 150, engine: "old-runtime", upgradedFrom: 3 });
    const opened = editorReducer(begun(createEditorState("pass-003"), 1), action);
    expect(opened.openedPicture).toMatchObject({ engine: "old-runtime", upgradedFrom: 3, opened: 1 });
    const unknown = (await openSavedAction(record({ step: 2 }), 1)).picture!;
    expect("engine" in unknown || "upgradedFrom" in unknown).toBe(false);
  });

  it("continues a record saved before steps were kept at step 0", async () => {
    expect((await openSavedAction(record(), 1)).picture?.step).toBe(0);
  });

  it("starts a placeholder picture from the seed, and a later open without a picture clears the last one", async () => {
    const action = await openSavedAction(record({ placeholder: true, step: 3 }), 2);
    expect(action.picture).toBeUndefined();
    const withPicture = editorReducer(begun(createEditorState("pass-003"), 1), await openSavedAction(record({ step: 2 }), 1));
    expect(editorReducer(begun(withPicture, 2), action).openedPicture).toBeNull();
  });
});

describe("opening a gallery entry", () => {
  const entry: GalleryEntry = {
    id: "20261013-044120-7fa6c1b5",
    title: "doggy ear",
    credit: "",
    imageUrl: "https://library.example/gallery/e/image.png",
    thumbnailUrl: null,
    recipeUrl: "https://library.example/gallery/e/recipe.json",
    publishedAt: "2026-10-13T04:48:39.996Z",
  };
  const answers = (image: Response) => (async (url: string) => (url === entry.recipeUrl ? Response.json(recipe) : image)) as typeof fetch;

  it("continues from its published image at step 0, as a new creation", async () => {
    const action = await openGalleryAction(entry, 1, answers(new Response(new Uint8Array([137, 80, 78, 71]))));
    expect(action.title).toBe("doggy ear");
    expect(action.source).toEqual({ kind: "gallery" });
    expect(action.picture?.step).toBe(0);
    expect(Array.from(action.picture!.png)).toEqual([137, 80, 78, 71]);
  });

  it("carries the engine the index names with the picture; a format-4 recipe gives no mark", async () => {
    const named = { ...entry, engine: "app/528a718f4e655b9c/dinodreamer_engine_bg.wasm" };
    const action = await openGalleryAction(named, 1, answers(new Response(new Uint8Array([137, 80, 78, 71]))));
    expect(action.picture?.engine).toBe(named.engine);
    expect("upgradedFrom" in action.picture!).toBe(false);
    const unnamed = await openGalleryAction(entry, 1, answers(new Response(new Uint8Array([137, 80, 78, 71]))));
    expect("engine" in unnamed.picture!).toBe(false);
  });

  it("starts from the seed when the image cannot be read", async () => {
    const action = await openGalleryAction(entry, 1, answers(new Response("gone", { status: 404 })));
    expect(action.recipe.seed).toBe(4);
    expect(action.picture).toBeUndefined();
  });
});

describe("the open rule: a late load never replaces newer work", () => {
  const start = () => createEditorState("pass-003");

  it("applies an open to the creation it began on", async () => {
    const state = begun(start(), 1);
    const opened = editorReducer(state, await openSavedAction(record({ title: "A" }), 1));
    expect(opened.title).toBe("A");
    expect(opened.pendingOpen).toBeNull();
  });

  it("keeps the newer of two opens when the older one finishes first", async () => {
    const both = begun(begun(start(), 1), 2);
    const afterA = editorReducer(both, await openSavedAction(record({ id: "a", title: "A" }), 1));
    expect(afterA).toBe(both);
    const afterB = editorReducer(afterA, await openSavedAction(record({ id: "b", title: "B" }), 2));
    expect(afterB.title).toBe("B");
  });

  it("keeps the newer of two opens when the older one finishes last", async () => {
    const both = begun(begun(start(), 1), 2);
    const afterB = editorReducer(both, await openSavedAction(record({ id: "b", title: "B" }), 2));
    const afterA = editorReducer(afterB, await openSavedAction(record({ id: "a", title: "A" }), 1));
    expect(afterA).toBe(afterB);
    expect(afterA.title).toBe("B");
  });

  it("keeps a title typed, or a numerical edit made, while the last creation was still loading", async () => {
    const restoring = begun(start(), 1);
    const retitled = editorReducer(restoring, { type: "setTitle", title: "Mine" });
    expect(editorReducer(retitled, await openSavedAction(record(), 1)).title).toBe("Mine");
    const reseeded = editorReducer(restoring, { type: "setSeed", seed: 9 });
    expect(editorReducer(reseeded, await openSavedAction(record(), 1)).recipe.seed).toBe(9);
  });

  it("does nothing for an open whose dialog closed before it loaded", async () => {
    const cancelled = editorReducer(begun(start(), 1), { type: "cancelOpen", ticket: 1 });
    expect(editorReducer(cancelled, await openSavedAction(record(), 1))).toBe(cancelled);
  });
});


it("keeps colour edits made while an open is loading, without changing the numerical revision", async () => {
  const withRequest = createRequest(recipe, {
    token: { imageId: 7, role: "patch", slot: 5 }, block: 3, code: [1, 0, 0],
  });
  const loading = begun({ ...createEditorState("pass-003"), recipe: withRequest }, 1);
  const picked = editorReducer(loading, { type: "pickInk", requestId: 1, target: "request", colour: "#ff0000" });
  expect(picked.revision).toBe(loading.revision);
  expect(editorReducer(picked, await openSavedAction(record(), 1))).toBe(picked);
});
