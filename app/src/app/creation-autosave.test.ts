import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { CELLS, MOTION_OFF, OPTIMIZER_BEFORE_FORMAT_5, type Recipe } from "../recipe";
import { openGalleryAction, openSavedAction } from "../features/editor/open-creation";
import { createRunState, runReducer, type RunState } from "../features/editor/run/session";
import { createEditorState, editorReducer, type EditorState, type OpenedPicture } from "../features/editor/state";
import type { GalleryEntry } from "../features/gallery/gallery-api";
import { parseRecipe } from "../recipe-parse";
import type { Event } from "../synthesis/protocol";
import { getCreation, openCreationDatabase, saveCreation } from "../storage/creations";
import {
  creationImage,
  creationInput,
  imageOfCreation,
  isNewImage,
  pictureToStore,
  saveTarget,
  worthSaving,
  type CreationImage,
} from "./creation-autosave";

const empty: Recipe = {
  format: 7,
  release: "pass-003",
  seed: 4,
  requests: [],
  protect: Array.from({ length: CELLS }, () => false),
  rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: false, weight: 0 } },
  motion: MOTION_OFF,
  optimizer: OPTIMIZER_BEFORE_FORMAT_5,
};

describe("what the autosave writes", () => {
  // The autosave reads only the number of requests.
  const withRequest = { ...empty, requests: [{} as Recipe["requests"][number]] };

  it("writes a new creation once it has a request, and never an empty one", () => {
    expect(worthSaving({ recipe: empty, fromGallery: false })).toBe(false);
    expect(worthSaving({ recipe: withRequest, fromGallery: false })).toBe(true);
  });

  it("writes no Gallery entry the visitor has not changed: leaving it discards it (the gallery rule)", () => {
    expect(worthSaving({ recipe: withRequest, fromGallery: true })).toBe(false);
  });

  it("always writes a creation that has a record", () => {
    expect(worthSaving({ recipe: empty, savedId: "r1", fromGallery: false })).toBe(true);
  });
});

describe("save identity", () => {
  it("writes the creation's own record when it has one", () => {
    expect(saveTarget({ opened: 2, savedId: "b" }, { opened: 2, id: "other" })).toBe("b");
  });

  it("reuses the record a previous save of the same creation created", () => {
    // The first save's acknowledgement can precede the reducer applying it.
    expect(saveTarget({ opened: 2 }, { opened: 2, id: "new" })).toBe("new");
  });

  it("never redirects a save to an earlier creation's record", () => {
    // Creation 1's save finished after creation 2 was opened.
    expect(saveTarget({ opened: 2 }, { opened: 1, id: "a" })).toBeUndefined();
    expect(saveTarget({ opened: 0 }, null)).toBeUndefined();
  });
});

describe("image of the current creation", () => {
  const pixels = new Uint8ClampedArray(4);

  it("accepts frames produced at or after the creation was opened, with their step", () => {
    expect(imageOfCreation({ revision: 7, step: 3, pixels }, 7)).toEqual({ step: 3, pixels });
    expect(imageOfCreation({ revision: 9, step: 0, pixels }, 7)?.pixels).toBe(pixels);
  });

  it("refuses a late frame of the previous creation, and no frame at all", () => {
    expect(imageOfCreation({ revision: 6, step: 1, pixels }, 7)).toBeUndefined();
    expect(imageOfCreation(undefined, 0)).toBeUndefined();
  });
});

describe("the stored picture", () => {
  const pixels = new Uint8ClampedArray(4);
  const image = (step: number, startStep: number): CreationImage => ({ step, pixels, startStep });
  const png = new Uint8Array([137, 80, 78, 71]);
  const opened: OpenedPicture = { png, step: 0, engine: "app/528a718f4e655b9c/dinodreamer_engine_bg.wasm", upgradedFrom: 3, opened: 3, revision: 9 };

  it("is new only past the step at which the image began", () => {
    // A seed image (a start or a Reset), and a restored picture with its measurements, carry no update of this session.
    expect(isNewImage(image(0, 0))).toBe(false);
    expect(isNewImage(image(150, 150))).toBe(false);
    expect(isNewImage(image(1, 0))).toBe(true);
    expect(isNewImage(image(151, 150))).toBe(true);
  });

  it("of a record is replaced only by a new image; otherwise the record keeps its picture, mark and engine", () => {
    expect(pictureToStore(image(151, 150), true, null, 3)).toEqual({ kind: "image", step: 151, pixels });
    // A reopen from Saved: the restored picture at its step, and the seed image after a Reset.
    expect(pictureToStore(image(150, 150), true, opened, 3)).toEqual({ kind: "keep" });
    expect(pictureToStore(image(0, 0), true, null, 3)).toEqual({ kind: "keep" });
    expect(pictureToStore(undefined, true, null, 3)).toEqual({ kind: "keep" });
  });

  it("of a new record is a new image, else the opened picture with its provenance, else the image shown, else the placeholder", () => {
    expect(pictureToStore(image(4, 0), false, opened, 3)).toEqual({ kind: "image", step: 4, pixels });
    // A Gallery entry changed before any update: its published picture, whether or not the run restored it already.
    expect(pictureToStore(image(0, 0), false, opened, 3)).toEqual({ kind: "opened", picture: opened });
    expect(pictureToStore(undefined, false, opened, 3)).toEqual({ kind: "opened", picture: opened });
    // A picture of an earlier generation is not this creation's: a new canvas takes its seed image.
    expect(pictureToStore(image(0, 0), false, { ...opened, opened: 2 }, 3)).toEqual({ kind: "image", step: 0, pixels });
    expect(pictureToStore(undefined, false, null, 3)).toEqual({ kind: "placeholder" });
  });

  it("names this client's engine only with an image it made; an opened picture keeps its own engine and mark", async () => {
    const creation = { id: "r1", title: "Kept", recipe: empty };
    const encode = async () => new Blob([new Uint8Array([7])], { type: "image/png" });
    expect(await creationInput(creation, { kind: "keep" }, "fake", encode)).toEqual(creation);
    const made = await creationInput(creation, { kind: "image", step: 5, pixels }, "fake", encode);
    expect(made).toMatchObject({ step: 5, engine: "fake" });
    expect(made.upgradedFrom).toBeUndefined();
    const kept = await creationInput(creation, { kind: "opened", picture: opened }, "fake", encode);
    expect(kept).toMatchObject({ step: 0, engine: opened.engine, upgradedFrom: 3 });
    expect(new Uint8Array(await kept.previewPng!.arrayBuffer())).toEqual(png);
    // An unknown engine stays unknown: the picture is not this client's.
    const unknown = await creationInput(creation, { kind: "opened", picture: { png, step: 0 } }, "fake", encode);
    expect("engine" in unknown).toBe(false);
  });

  it("carries the creation's picked colours with every save, whatever the picture", async () => {
    const inks = { 1: { code: "#ff0000" } };
    const encode = async () => new Blob([new Uint8Array([7])], { type: "image/png" });
    const creation = { id: "r1", title: "Inks", recipe: empty, inks };
    expect((await creationInput(creation, { kind: "keep" }, "fake", encode)).inks).toBe(inks);
    expect((await creationInput(creation, { kind: "image", step: 5, pixels }, "fake", encode)).inks).toBe(inks);
  });
});

describe("the picture's provenance from the open to the stored record", () => {
  // Each test opens, runs the run session's events and saves as the hook does: pictureToStore on
  // creationImage, then creationInput into saveCreation.
  let databases = 0;
  const database = () => openCreationDatabase(`autosave-provenance-${++databases}`);
  const picturePng = new Uint8Array([137, 80, 78, 71, 13, 10]);
  const encode = async () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: "image/png" });
  const token = { imageId: 8356286050491528, role: "patch" as const, slot: 87 };
  const area = Array.from({ length: CELLS }, (_, cell) => cell === 87);
  /** A format-3 recipe with Appearance on: an earlier objective made its picture (upgradedFrom 3). */
  const formatThree = {
    format: 3,
    release: "pass-003",
    seed: 12,
    requests: [
      {
        id: 1,
        block: 13345,
        respondLike: { enabled: true, weight: 1.9, source: token, code: [0.5, -1.25, 2], where: area },
        lookLike: { enabled: true, weight: 1, references: [{ token, source: area }], where: area },
      },
    ],
    protect: Array.from({ length: CELLS }, () => false),
    rules: { tv: { enabled: false, weight: 0.5 }, l2: { enabled: false, weight: 0 } },
    motion: { zoomPerUpdate: 0 },
  };
  const pixels = () => new Uint8ClampedArray(4);
  const event = (event: Event) => ({ type: "event" as const, event, receivedAt: 0 });
  const measurement = (revision: number, step: number): Event => ({ type: "measurement", revision, step, terms: [], codes: [], pixels: pixels() });
  const frame = (revision: number, step: number): Event => ({ type: "frame", revision, step, views: 2, loss: 0, terms: [], pixels: pixels(), elapsedMs: 100 });
  /** The open asks the run to restore the picture (run/use-run.ts); the worker restores it and measures it. */
  const restored = (run: RunState, editor: EditorState, openedAt: number) => {
    const picture = editor.openedPicture!;
    let next = runReducer(run, { type: "requestRestore", restore: { picture: picture.png, step: picture.step, afterRevision: openedAt, opened: editor.opened } });
    next = runReducer(next, event({ type: "restored", revision: openedAt, step: picture.step }));
    return runReducer(next, event(measurement(openedAt, picture.step)));
  };

  /** What the autosave writes now, and the record as the store then reads it. */
  async function save(editor: EditorState, run: RunState, openedAt: number, id: string | undefined, db: Promise<IDBDatabase>) {
    const picture = pictureToStore(creationImage(run, openedAt), id !== undefined, editor.openedPicture, editor.opened);
    const saved = await saveCreation(await creationInput({ id, title: editor.title, recipe: editor.recipe }, picture, "fake", encode), db);
    return (await getCreation(saved.id, db))!;
  }

  it("a Gallery entry renamed before any update keeps its published picture, its mark and its engine", async () => {
    const db = database();
    const entry: GalleryEntry = {
      id: "20261013-044120-7fa6c1b5",
      title: "doggy ear",
      credit: "",
      imageUrl: "https://library.example/gallery/e/image.png",
      thumbnailUrl: null,
      recipeUrl: "https://library.example/gallery/e/recipe.json",
      publishedAt: "2026-10-13T04:48:39.996Z",
      engine: "app/528a718f4e655b9c/dinodreamer_engine_bg.wasm",
    };
    const fetcher = (async (url: string) => (url === entry.recipeUrl ? Response.json(formatThree) : new Response(picturePng))) as typeof fetch;
    let editor = editorReducer(createEditorState("pass-003"), { type: "beginOpen", ticket: 1 });
    editor = editorReducer(editor, await openGalleryAction(entry, 1, fetcher));
    const openedAt = editor.revision;
    editor = editorReducer(editor, { type: "setTitle", title: "doggy ear, mine" });
    expect(worthSaving(editor)).toBe(true);

    // The engine not loaded yet, then loaded with the picture restored and measured: no update either way.
    const runs = [createRunState(), restored(createRunState(), editor, openedAt)];
    for (const run of runs) {
      const record = await save(editor, run, openedAt, undefined, db);
      expect(record.recipe).toMatchObject({ format: 7, optimizer: OPTIMIZER_BEFORE_FORMAT_5 });
      expect(record.upgradedFrom).toBe(3);
      expect(record.engine).toBe(entry.engine);
      expect(record.step).toBe(0);
      expect(new Uint8Array(await record.previewPng.arrayBuffer())).toEqual(picturePng);
    }

    // The first update of this session makes the picture the new objective's, by this client's engine.
    const updated = runReducer(runReducer(runs[1]!, event(frame(openedAt, 0))), event(measurement(openedAt, 1)));
    const record = await save(editor, updated, openedAt, undefined, db);
    expect(record.upgradedFrom).toBeUndefined();
    expect(record.engine).toBe("fake");
    expect(record.step).toBe(1);
  });

  it("a marked Saved record opened into a loaded, paused engine keeps its picture, mark and engine until an update", async () => {
    const db = database();
    // As Import writes a release-13 file (saved-page.tsx importFile).
    const imported = await saveCreation(
      { title: "old look", recipe: parseRecipe(formatThree), previewPng: new Blob([picturePng], { type: "image/png" }), upgradedFrom: 3, engine: "old-runtime", step: 150 },
      db,
    );
    let editor = editorReducer(createEditorState("pass-003"), { type: "beginOpen", ticket: 1 });
    editor = editorReducer(editor, await openSavedAction((await getCreation(imported.id, db))!, 1));
    const openedAt = editor.revision;
    // The engine shows an earlier image at step 40 and is paused; the open restores the picture at 150.
    let run = runReducer(runReducer(createRunState(), event(measurement(0, 40))), { type: "requestPause" });
    run = restored(run, editor, openedAt);
    expect(run.wantsRunning).toBe(false);

    for (const shown of [run, runReducer(run, event(frame(openedAt, 150)))]) {
      const record = await save(editor, shown, openedAt, editor.savedId, db);
      expect(record.id).toBe(imported.id);
      expect(record.upgradedFrom).toBe(3);
      expect(record.engine).toBe("old-runtime");
      expect(record.step).toBe(150);
      expect(new Uint8Array(await record.previewPng.arrayBuffer())).toEqual(picturePng);
    }

    // One Step: the measurement of the updated image, at 151, replaces the picture.
    run = runReducer(runReducer(run, event(frame(openedAt, 150))), event(measurement(openedAt, 151)));
    const record = await save(editor, run, openedAt, editor.savedId, db);
    expect(record.upgradedFrom).toBeUndefined();
    expect(record.engine).toBe("fake");
    expect(record.step).toBe(151);
  });
});
