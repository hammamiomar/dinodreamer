import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CELLS, OPTIMIZER_BEFORE_FORMAT_5, validateRecipe } from "../recipe";
import type { Recipe } from "../recipe";
import { deleteCreation, getCreation, listAllCreations, listCreations, openCreationDatabase, renameCreation, saveCreation } from "./creations";
import { parseRecipe } from "../recipe-parse";
import { decodeCreationFile, encodeCreationFile } from "./recipe-file";

/** Sets the wall clock the store stamps createdAt and updatedAt with; only Date is faked, so IndexedDB's timers run. */
function clockAt(time: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(time));
}

afterEach(() => {
  vi.useRealTimers();
});

let databases = 0;
/** A fresh database per test, so tests do not share records. */
function freshDatabase(): Promise<IDBDatabase> {
  databases += 1;
  return openCreationDatabase(`creations-test-${databases}`);
}

function recipe(seed = 1): Recipe {
  const source = Array.from({ length: CELLS }, (_, cell) => cell === 136);
  const token = { imageId: 9007199254740991, role: "patch" as const, slot: 141 };
  return {
    format: 7,
    release: "fixture",
    seed,
    requests: [
      {
        id: 1,
        block: 6,
        respondLike: { enabled: true, weight: 0.3, source: token, code: [0.5, -1.25, 2], where: source.map((inside) => inside ? 100 : 0), alsoBlocks: [], target: { kind: "point" }, radius: 1 },
        lookLike: { enabled: true, weight: 1, references: [{ token, source }], where: source.map((inside) => inside ? 100 : 0) },
      },
    ],
    protect: Array.from({ length: CELLS }, () => false),
    rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: false, weight: 0 } },
    motion: { zoomPerUpdate: 0 },
    optimizer: { ...OPTIMIZER_BEFORE_FORMAT_5 },
  };
}

const png = (byte: number) => new Blob([new Uint8Array([137, 80, 78, 71, byte])], { type: "image/png" });

/** Format 1: one weight field per request, shared by both terms. */
function format1Recipe() {
  const { requests, ...rest } = recipe();
  const { respondLike, lookLike, ...request } = requests[0]!;
  const weights = Array.from({ length: CELLS }, (_, cell) => (cell === 136 ? 0.5 : 0));
  return {
    ...rest,
    format: 1,
    requests: [{ ...request, where: weights, respondLike: { ...respondLike, where: undefined }, lookLike: { ...lookLike, where: undefined } }],
  };
}

/** Format 2 with its Whole canvas term, active or off. */
function format2Recipe(wholeCanvasOn: boolean) {
  const token = { imageId: 9007199254740991, role: "patch" as const, slot: 141 };
  const current = recipe();
  const requests = current.requests.map((request) => ({
    ...request,
    respondLike: { ...request.respondLike, where: request.respondLike.where.map(Boolean) },
    lookLike: { ...request.lookLike, enabled: wholeCanvasOn, where: request.lookLike.where.map(Boolean) },
  }));
  return { ...current, requests, format: 2, wholeCanvas: { enabled: wholeCanvasOn, weight: 1, references: [token] } };
}

/** Writes a creation with a recipe of an earlier format straight into the store, as an older app version did. */
async function putOldCreation(database: Promise<IDBDatabase>, recipe: unknown): Promise<void> {
  const old = { id: "old", title: "Old", createdAt: "2026-10-10T10:00:00.000Z", updatedAt: "2026-10-10T10:00:00.000Z", recipe, previewPng: png(1) };
  const store = (await database).transaction("creations", "readwrite").objectStore("creations");
  await new Promise((resolve) => (store.put(old).onsuccess = resolve));
}

describe("creation store", () => {
  it("creates a creation, then updates it in place and keeps createdAt", async () => {
    const database = freshDatabase();
    clockAt("2026-10-23T10:00:00.000Z");
    const created = await saveCreation({ title: "First", recipe: recipe(1), previewPng: png(1) }, database);
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.createdAt).toBe(created.updatedAt);

    clockAt("2026-10-23T10:00:01.000Z");
    const updated = await saveCreation({ id: created.id, title: "First", recipe: recipe(2), previewPng: png(2) }, database);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt > created.updatedAt).toBe(true);

    const stored = await getCreation(created.id, database);
    expect(stored?.recipe.seed).toBe(2);
    expect(new Uint8Array(await stored!.previewPng.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 2]));
  });

  it("keeps the stored image when an update brings none, and refuses a new creation without one", async () => {
    const database = freshDatabase();
    const created = await saveCreation({ title: "Image kept", recipe: recipe(1), previewPng: png(5) }, database);
    const updated = await saveCreation({ id: created.id, title: "Image kept", recipe: recipe(2) }, database);
    expect(updated.recipe.seed).toBe(2);
    expect(new Uint8Array(await updated.previewPng.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 5]));
    await expect(saveCreation({ title: "No image", recipe: recipe() }, database)).rejects.toThrow(/needs a picture/);
    expect(await listCreations(database)).toHaveLength(1);
  });

  it("survives a reopen of the database, as after a reload", async () => {
    const name = `creations-reload-${Date.now()}`;
    const first = openCreationDatabase(name);
    const saved = await saveCreation({ title: "Kept", recipe: recipe(), previewPng: png(1) }, first);
    (await first).close();

    const reopened = openCreationDatabase(name);
    const stored = await getCreation(saved.id, reopened);
    expect(stored?.title).toBe("Kept");
    expect(stored?.recipe).toEqual(recipe());
  });

  it("opens a creation saved before recipe format 2 in the current format, marked as having a format-1 image", async () => {
    const database = freshDatabase();
    await putOldCreation(database, format1Recipe());
    const opened = (await getCreation("old", database))!;
    expect(opened.recipe).toEqual(recipe());
    expect(opened.upgradedFrom).toBe(1);
    expect((await listCreations(database))[0]!.upgradedFrom).toBe(1);
  });

  it("marks a format-2 creation whose Whole canvas was active, and opens one whose term was off unmarked", async () => {
    const active = freshDatabase();
    await putOldCreation(active, format2Recipe(true));
    const marked = (await getCreation("old", active))!;
    expect(marked.recipe).toEqual(recipe());
    expect(marked.upgradedFrom).toBe(2);
    expect((await listCreations(active))[0]!.upgradedFrom).toBe(2);
    // The mark goes like a format-1 mark: a run under format 3 brings a new image.
    const rerun = await saveCreation({ id: "old", title: "Old", recipe: recipe(4), previewPng: png(7) }, active);
    expect(rerun.upgradedFrom).toBeUndefined();

    const off = freshDatabase();
    await putOldCreation(off, format2Recipe(false));
    const clean = (await getCreation("old", off))!;
    expect(clean.recipe).toEqual(parseRecipe(format2Recipe(false)));
    expect(clean.upgradedFrom).toBeUndefined();
  });

  it("keeps the mark through saves without a new image and a rename, and clears it with a new image", async () => {
    const database = freshDatabase();
    await putOldCreation(database, format1Recipe());
    // The editor opened it and saved an edit before any new frame: the old image stays, so does the mark.
    const edited = await saveCreation({ id: "old", title: "Old, edited", recipe: recipe(4) }, database);
    expect(edited.upgradedFrom).toBe(1);
    expect((await getCreation("old", database))!.upgradedFrom).toBe(1);
    expect((await renameCreation("old", "Renamed", database)).upgradedFrom).toBe(1);
    // A run under format 2 produced a frame: the new image clears the mark.
    const rerun = await saveCreation({ id: "old", title: "Renamed", recipe: recipe(4), previewPng: png(7) }, database);
    expect(rerun.upgradedFrom).toBeUndefined();
    expect((await getCreation("old", database))!.upgradedFrom).toBeUndefined();
  });

  it("marks an imported image that came from a format-1 recipe, and nothing else", async () => {
    const database = freshDatabase();
    const imported = await saveCreation({ title: "Imported", recipe: recipe(), previewPng: png(3), upgradedFrom: 1 }, database);
    expect((await getCreation(imported.id, database))!.upgradedFrom).toBe(1);
    const fresh = await saveCreation({ title: "Fresh", recipe: recipe(), previewPng: png(4) }, database);
    expect((await getCreation(fresh.id, database))!.upgradedFrom).toBeUndefined();
  });

  it("keeps the requests' picked colours with the record, outside the recipe; an empty set is stored as none", async () => {
    const database = freshDatabase();
    const inks = { 1: { code: "#ff0000", look: "oklch(86% 0.150 175)" } };
    const saved = await saveCreation({ title: "Inks", recipe: recipe(), previewPng: png(1), inks }, database);
    expect((await getCreation(saved.id, database))!.inks).toEqual(inks);
    expect((await getCreation(saved.id, database))!.recipe).toEqual(recipe());
    const renamed = await renameCreation(saved.id, "Inks 2", database);
    expect(renamed.inks).toEqual(inks);
    const plain = await saveCreation({ title: "Plain", recipe: recipe(), previewPng: png(2), inks: {} }, database);
    expect("inks" in (await getCreation(plain.id, database))!).toBe(false);
  });

  it("opens a format-2 creation saved before motion existed with no motion", async () => {
    const database = freshDatabase();
    const { motion: _, ...earlier } = recipe();
    const old = { id: "before-motion", title: "Old", createdAt: "2026-10-11T01:00:00.000Z", updatedAt: "2026-10-11T01:00:00.000Z", recipe: earlier, previewPng: png(1) };
    const store = (await database).transaction("creations", "readwrite").objectStore("creations");
    await new Promise((resolve) => (store.put(old).onsuccess = resolve));
    expect((await getCreation("before-motion", database))?.recipe).toEqual(recipe());
  });

  it("lists the most recently updated first, renames and deletes", async () => {
    const database = freshDatabase();
    clockAt("2026-10-23T10:00:00.000Z");
    const older = await saveCreation({ title: "Older", recipe: recipe(), previewPng: png(1) }, database);
    clockAt("2026-10-23T10:00:01.000Z");
    const newer = await saveCreation({ title: "Newer", recipe: recipe(), previewPng: png(2) }, database);
    expect((await listCreations(database)).map((creation) => creation.id)).toEqual([newer.id, older.id]);

    clockAt("2026-10-23T10:00:02.000Z");
    const renamed = await renameCreation(older.id, "Renamed", database);
    expect(renamed.recipe).toEqual(older.recipe);
    expect((await listCreations(database)).map((creation) => creation.title)).toEqual(["Renamed", "Newer"]);

    await deleteCreation(newer.id, database);
    expect(await getCreation(newer.id, database)).toBeNull();
    await expect(renameCreation(newer.id, "Gone", database)).rejects.toThrow(/No saved image/);
  });
});

describe("creation files", () => {
  it("carries the format-1 image mark through export and import", async () => {
    const exported = await encodeCreationFile({
      title: "Old",
      createdAt: "2026-10-10T10:00:00.000Z",
      updatedAt: "2026-10-10T11:00:00.000Z",
      recipe: recipe(),
      previewPng: png(9),
      upgradedFrom: 1,
    });
    expect(decodeCreationFile(exported).upgradedFrom).toBe(1);
    const file = JSON.parse(exported);
    // A file written before the mark existed, with its format-1 recipe, is marked from the recipe.
    expect(decodeCreationFile(JSON.stringify({ ...file, upgradedFrom: undefined, recipe: format1Recipe() })).upgradedFrom).toBe(1);
    expect(decodeCreationFile(JSON.stringify({ ...file, upgradedFrom: undefined })).upgradedFrom).toBeUndefined();
  });

  it("carries the format-2 Whole canvas mark through export and import, and reads it from an unmarked file's recipe", async () => {
    const exported = await encodeCreationFile({
      title: "Old",
      createdAt: "2026-10-12T10:00:00.000Z",
      updatedAt: "2026-10-12T11:00:00.000Z",
      recipe: recipe(),
      previewPng: png(9),
      upgradedFrom: 2,
    });
    expect(decodeCreationFile(exported).upgradedFrom).toBe(2);
    const file = JSON.parse(exported);
    expect(decodeCreationFile(JSON.stringify({ ...file, upgradedFrom: undefined, recipe: format2Recipe(true) })).upgradedFrom).toBe(2);
    expect(decodeCreationFile(JSON.stringify({ ...file, upgradedFrom: undefined, recipe: format2Recipe(false) })).upgradedFrom).toBeUndefined();
    // Unsupported upgrade marks are ignored.
    expect(decodeCreationFile(JSON.stringify({ ...file, upgradedFrom: 7 })).upgradedFrom).toBeUndefined();
  });

  it("round-trips the title, recipe and image through an exported file", async () => {
    const text = await encodeCreationFile({
      title: "Exported",
      createdAt: "2026-10-10T10:00:00.000Z",
      updatedAt: "2026-10-10T11:00:00.000Z",
      recipe: recipe(),
      previewPng: png(9),
    });
    const decoded = decodeCreationFile(text);
    expect(decoded.title).toBe("Exported");
    expect(decoded.recipe).toEqual(recipe());
    expect(validateRecipe(decoded.recipe)).toEqual([]);
    expect(new Uint8Array(await decoded.previewPng.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 9]));
  });

  it("refuses a file that is not a creation or whose recipe is malformed", async () => {
    expect(() => decodeCreationFile("not json")).toThrow(/not JSON/);
    expect(() => decodeCreationFile(JSON.stringify({ format: "other" }))).toThrow(/not a saved DinoDreamer image/);
    const broken = { ...recipe(), protect: [true] };
    expect(() => parseRecipe(broken)).toThrow(/recipe.protect: expected 256 cells/);
    const badToken = recipe();
    badToken.requests[0]!.respondLike.source = { imageId: 1, role: "cls", slot: 9 };
    expect(() => parseRecipe(badToken)).toThrow(/respondLike.source: not a valid token/);
  });

  it("accepts a draft that validateRecipe would still flag", () => {
    const draft = recipe();
    draft.requests[0]!.lookLike.references = [];
    expect(validateRecipe(draft)).not.toEqual([]);
    expect(parseRecipe(draft)).toEqual(draft);
  });
});

describe("engine provenance", () => {
  it("stores the picture's step and placeholder mark with the image, and keeps them while the image is kept", async () => {
    const database = freshDatabase();
    const blank = await saveCreation({ title: "New", recipe: recipe(), previewPng: png(1), placeholder: true }, database);
    expect(blank.placeholder).toBe(true);
    expect(blank.step).toBeUndefined();
    const ran = await saveCreation({ id: blank.id, title: "New", recipe: recipe(), previewPng: png(2), step: 40 }, database);
    expect(ran.step).toBe(40);
    expect(ran.placeholder).toBeUndefined();
    // An edit without a new image keeps the picture, its step and its mark.
    const edited = await saveCreation({ id: blank.id, title: "Renamed", recipe: recipe(3) }, database);
    expect(edited.step).toBe(40);
    expect((await getCreation(blank.id, database))!.step).toBe(40);
  });

  it("keeps the picture's step and placeholder mark through export and import", async () => {
    const exported = await encodeCreationFile({ title: "T", createdAt: "", updatedAt: "", recipe: recipe(), previewPng: png(9), step: 150 });
    expect(decodeCreationFile(exported).step).toBe(150);
    const blank = await encodeCreationFile({ title: "T", createdAt: "", updatedAt: "", recipe: recipe(), previewPng: png(9), placeholder: true });
    expect(decodeCreationFile(blank)).toMatchObject({ placeholder: true });
    expect(decodeCreationFile(blank).step).toBeUndefined();
    expect(() => decodeCreationFile(JSON.stringify({ ...JSON.parse(exported), step: -1 }))).toThrow("file.step: expected a non-negative integer");
  });

  it("stores the engine build with the image, keeps it while the image is kept, and reads old records without it", async () => {
    const database = freshDatabase();
    const saved = await saveCreation({ title: "Collar", recipe: recipe(), previewPng: png(1), engine: "fake" }, database);
    expect(saved.engine).toBe("fake");
    expect((await getCreation(saved.id, database))?.engine).toBe("fake");

    // A save that keeps the image keeps the build that made it, whatever the app runs now.
    const kept = await saveCreation({ id: saved.id, title: "Collar", recipe: recipe(2), engine: "engine-b.wasm" }, database);
    expect(kept.engine).toBe("fake");

    // A new image brings its own build.
    const renewed = await saveCreation({ id: saved.id, title: "Collar", recipe: recipe(3), previewPng: png(2), engine: "engine-b.wasm" }, database);
    expect(renewed.engine).toBe("engine-b.wasm");

    const old = await saveCreation({ title: "Old", recipe: recipe(), previewPng: png(3) }, database);
    expect(old.engine).toBeUndefined();
    expect("engine" in old).toBe(false);
    // A kept image of an unknown build stays unknown: the app's build did not make it.
    const keptOld = await saveCreation({ id: old.id, title: "Old, renamed", recipe: recipe(4), engine: "engine-b.wasm" }, database);
    expect("engine" in keptOld).toBe(false);
    // Two saves in the same millisecond list in either order, so read each record by id.
    expect((await getCreation(old.id, database))?.engine).toBeUndefined();
    expect((await getCreation(saved.id, database))?.engine).toBe("engine-b.wasm");
    expect((await listCreations(database)).map((creation) => creation.engine).sort()).toEqual(["engine-b.wasm", undefined]);
  });
});

describe("creation files and the engine build", () => {
  it("keeps the engine build through export and import, and reads a file without one", async () => {
    const base = { title: "Collar", createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z", recipe: recipe(), previewPng: png(1) };
    const withEngine = decodeCreationFile(await encodeCreationFile({ ...base, engine: "fake" }));
    expect(withEngine.engine).toBe("fake");
    const without = decodeCreationFile(await encodeCreationFile(base));
    expect(without.engine).toBeUndefined();
    expect("engine" in without).toBe(false);
    const text = await encodeCreationFile(base);
    expect(() => decodeCreationFile(JSON.stringify({ ...JSON.parse(text), engine: 7 }))).toThrow("file.engine");
  });
});

describe("one read for both lists", () => {
  it("reads the store once for the readable and the unreadable records together, the unreadable one apart with its export possible", async () => {
    const database = freshDatabase();
    await saveCreation({ title: "Good", recipe: recipe(), previewPng: png(1) }, database);
    // A record an older or a broken app version wrote: its recipe is not one the parser knows.
    const broken = { id: "broken", title: "Broken", createdAt: "2026-10-12T10:00:00.000Z", updatedAt: "2026-10-12T10:00:00.000Z", recipe: { format: 9, requests: "no" }, previewPng: png(2) };
    const store = (await database).transaction("creations", "readwrite").objectStore("creations");
    await new Promise((resolve) => (store.put(broken).onsuccess = resolve));

    const reads = vi.spyOn(IDBObjectStore.prototype, "getAll");
    const { readable, unreadable } = await listAllCreations(database);
    expect(reads).toHaveBeenCalledTimes(1);
    reads.mockRestore();
    expect(readable.map((creation) => creation.title)).toEqual(["Good"]);
    expect(unreadable).toHaveLength(1);
    const [record] = unreadable;
    expect(record).toMatchObject({ id: "broken", title: "Broken", problem: "recipe.format: unsupported image-editing configuration format 9" });
    expect(record!.stored).toEqual({ format: 9, requests: "no" });
    const exported = await encodeCreationFile({ ...record!, recipe: record!.stored });
    expect(JSON.parse(exported).recipe).toEqual({ format: 9, requests: "no" });
    expect(() => decodeCreationFile(exported)).toThrow("recipe.format: unsupported image-editing configuration format 9");
    // One bad record never hides the others.
    expect((await listCreations(database)).map((creation) => creation.title)).toEqual(["Good"]);
  });
});

describe("painted field storage", () => {
  it("keeps nonbinary paint through Saved, reopen and a creation file", async () => {
    const database = freshDatabase();
    const painted = recipe();
    painted.requests[0]!.respondLike.where = Array.from({ length: CELLS }, (_, cell) => cell % 101);
    painted.requests[0]!.lookLike.where.fill(100);
    const saved = await saveCreation({ title: "Paint", recipe: painted, previewPng: png(9), engine: "painting-build", step: 42 }, database);
    const opened = (await getCreation(saved.id, database))!;
    expect(opened.recipe).toEqual(painted);
    const imported = decodeCreationFile(await encodeCreationFile(opened));
    expect(imported.recipe).toEqual(painted);
    expect(imported.engine).toBe("painting-build");
    expect(imported.step).toBe(42);
    expect(imported.upgradedFrom).toBeUndefined();
    expect(await imported.previewPng.arrayBuffer()).toEqual(await png(9).arrayBuffer());
  });

  it("preserves a format-3 picture and its mark until a new run image replaces it", async () => {
    const database = freshDatabase();
    const earlier = { ...format2Recipe(true), format: 3 };
    await putOldCreation(database, earlier);
    const opened = (await getCreation("old", database))!;
    expect(opened.recipe).toEqual(recipe());
    expect(opened.upgradedFrom).toBe(3);
    const edited = await saveCreation({ id: "old", title: "Paint", recipe: opened.recipe }, database);
    expect(edited.upgradedFrom).toBe(3);
    expect(await edited.previewPng.arrayBuffer()).toEqual(await opened.previewPng.arrayBuffer());
    const imported = decodeCreationFile(await encodeCreationFile(edited));
    expect(imported.upgradedFrom).toBe(3);
    const rerun = await saveCreation({ id: "old", title: "Paint", recipe: opened.recipe, previewPng: png(8) }, database);
    expect(rerun.upgradedFrom).toBeUndefined();
  });
});

describe("picture storage", () => {
  it("stores a new picture as its bytes and type, and gives it back as a Blob", async () => {
    const database = freshDatabase();
    const saved = await saveCreation({ title: "Bytes", recipe: recipe(), previewPng: png(5) }, database);
    const store = (await database).transaction("creations", "readonly").objectStore("creations");
    const raw = await new Promise<{ previewPng: unknown }>((resolve) => {
      const reading = store.get(saved.id);
      reading.onsuccess = () => resolve(reading.result);
    });
    // WebKit's private sessions refuse a Blob in IndexedDB; bytes go everywhere.
    expect(raw.previewPng).not.toBeInstanceOf(Blob);
    expect(raw.previewPng).toMatchObject({ type: "image/png" });
    expect(new Uint8Array((raw.previewPng as { bytes: ArrayBuffer }).bytes)).toEqual(new Uint8Array([137, 80, 78, 71, 5]));
    const read = (await getCreation(saved.id, database))!;
    expect(read.previewPng).toBeInstanceOf(Blob);
    expect(read.previewPng.type).toBe("image/png");
    expect(await read.previewPng.arrayBuffer()).toEqual(await png(5).arrayBuffer());
  });

  it("reads, renames and keeps a legacy record whose picture is a Blob", async () => {
    const database = freshDatabase();
    await putOldCreation(database, recipe());
    const [listed] = await listCreations(database);
    expect(await listed!.previewPng.arrayBuffer()).toEqual(await png(1).arrayBuffer());
    const renamed = await renameCreation("old", "Renamed", database);
    expect(renamed.previewPng).toBeInstanceOf(Blob);
    const kept = await saveCreation({ id: "old", title: "Kept", recipe: recipe() }, database);
    expect(await kept.previewPng.arrayBuffer()).toEqual(await png(1).arrayBuffer());
  });

  it("names the cause of a failed save: a ConstraintError, not null", async () => {
    databases += 1;
    // A unique title index makes the second write fail at the request level.
    const database = new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(`creations-test-${databases}`, 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("creations", { keyPath: "id" }).createIndex("title", "title", { unique: true });
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    await saveCreation({ title: "Same", recipe: recipe(), previewPng: png(1) }, database);
    await expect(saveCreation({ title: "Same", recipe: recipe(), previewPng: png(2) }, database)).rejects.toMatchObject({ name: "ConstraintError" });
  });
});
