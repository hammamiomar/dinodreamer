// Creations stay in this browser's IndexedDB. Reads parse stored recipes into the current
// shape; stored data changes only when saved again. Tests can supply a separate database.
// IndexedDB errors reject unchanged so callers can decide what to show.
//
// Pictures use bytes and a MIME type because WebKit private sessions refuse Blobs in IndexedDB.
// Readers accept both this representation and legacy Blob records, returning a Blob to callers.
//
// Recipe upgrades can change the objective without changing the saved image. upgradedFrom marks
// images made with per-cell weights (format 1), Whole canvas (format 2), or sampled-list Appearance
// (formats 2/3). It stays until a new image is saved; the gallery refuses submission meanwhile.

import type { Recipe } from "../recipe";
import type { InkChoices } from "../features/editor/inks";
import { parseRecipe, recipeUpgradedFrom, type UpgradedFrom } from "../recipe-parse";
import { forgetLastCreation } from "./last-creation";

/** Why an image marked `upgradedFrom` must be made again, by format, for saved images and the gallery. */
export const UPGRADED_IMAGE_REASON: Record<UpgradedFrom, string> = {
  1: "the brush from before October 11",
  2: "the Whole canvas term from before October 13",
  3: "Appearance before painted strength",
};

export interface SavedCreation {
  id: string;
  title: string;
  /** ISO 8601 times. */
  createdAt: string;
  updatedAt: string;
  recipe: Recipe;
  previewPng: Blob;
  /** The format the image's recipe was saved in, while the upgraded recipe does not reproduce the image; see the top of this file. */
  upgradedFrom?: UpgradedFrom;
  /**
   * The engine build that made the image: the engine's wasm asset name, or "fake".
   * A later build can drift in the third decimal, so a replay is attributed to its
   * build. Legacy records may omit it.
   */
  engine?: string;
  /**
   * The updates the picture had when it was saved. Open continues the run from the picture
   * at this step; records without it continue at step 0.
   */
  step?: number;
  /** The picture is the dark square saved before the first frame, not a run's image: Open starts from the seed. */
  placeholder?: true;
  /** The colours picked for the requests, by request id (features/editor/inks.ts); none: the palette's. Not part of the recipe. */
  inks?: InkChoices;
}

export interface CreationInput {
  /** Absent for a new creation. A known id updates that creation and keeps its createdAt. */
  id?: string;
  title: string;
  recipe: Recipe;
  /** Absent keeps the stored image. A new creation must have one. */
  previewPng?: Blob;
  /** Set when `previewPng` itself came from an earlier objective (an imported file or an opened picture says so). */
  upgradedFrom?: UpgradedFrom;
  /** The engine build that made `previewPng`; travels with the image like `upgradedFrom`. */
  engine?: string;
  /** The updates `previewPng` had; travels with the image. */
  step?: number;
  /** `previewPng` is the placeholder saved before the first frame; travels with the image. */
  placeholder?: true;
  /** The requests' picked colours; an empty set is stored as none. */
  inks?: InkChoices;
}

/** The picture as the database keeps it: its bytes and type, or a Blob in a legacy record. */
type StoredPicture = { bytes: ArrayBuffer; type: string } | Blob;

/** A record as the database keeps it; reads turn its picture into a Blob. */
type StoredCreation = Omit<SavedCreation, "previewPng"> & { previewPng: StoredPicture };

/** A picture in the form the database keeps, read before a transaction opens (one commits as soon as it waits on nothing). */
async function storedPicture(picture: Blob): Promise<StoredPicture> {
  return { bytes: await picture.arrayBuffer(), type: picture.type };
}

function pictureBlob(picture: StoredPicture): Blob {
  return picture instanceof Blob ? picture : new Blob([picture.bytes], { type: picture.type });
}

/** A stored record with its picture as a Blob. */
function withBlob<T extends { previewPng: StoredPicture }>(record: T): Omit<T, "previewPng"> & { previewPng: Blob } {
  return { ...record, previewPng: pictureBlob(record.previewPng) };
}

const DATABASE_NAME = "dinodreamer";
const DATABASE_VERSION = 1;
const STORE = "creations";

export function openCreationDatabase(name = DATABASE_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, DATABASE_VERSION);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(STORE, { keyPath: "id" });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => reject(new Error("Another tab holds an older version of the saves database. Close it and reload."));
  });
}

let appDatabase: Promise<IDBDatabase> | null = null;

function defaultDatabase(): Promise<IDBDatabase> {
  if (!appDatabase) {
    const attempt = openCreationDatabase();
    attempt.catch(() => {
      if (appDatabase === attempt) appDatabase = null;
    });
    appDatabase = attempt;
  }
  return appDatabase;
}

/**
 * Creates or updates one creation and returns the stored record. The read of
 * the existing record and the write share one transaction, so createdAt is kept
 * even when two saves race.
 */
export async function saveCreation(input: CreationInput, database = defaultDatabase()): Promise<SavedCreation> {
  const now = new Date().toISOString();
  const newPicture = input.previewPng ? await storedPicture(input.previewPng) : undefined;
  return readWrite(await database, (store, finish, fail) => {
    const id = input.id ?? crypto.randomUUID();
    const reading = store.get(id);
    reading.onsuccess = () => {
      const existing = reading.result as StoredCreation | undefined;
      const previewPng = newPicture ?? existing?.previewPng;
      if (!previewPng) return fail(new Error("A new saved image needs a picture."));
      // A new image speaks for itself; a kept image keeps its origin, an unknown engine included.
      const upgradedFrom = input.previewPng ? input.upgradedFrom : (input.upgradedFrom ?? imageUpgradedFrom(existing));
      const engine = input.previewPng ? input.engine : existing?.engine;
      // The picture's step and placeholder mark describe the picture, so they go and come with it.
      const step = input.previewPng ? input.step : existing?.step;
      const placeholder = input.previewPng ? input.placeholder : existing?.placeholder;
      const creation: StoredCreation = {
        id,
        title: input.title,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        recipe: input.recipe,
        previewPng,
        ...(upgradedFrom ? { upgradedFrom } : {}),
        ...(engine ? { engine } : {}),
        ...(step !== undefined ? { step } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(input.inks && Object.keys(input.inks).length > 0 ? { inks: input.inks } : {}),
      };
      store.put(creation);
      finish(withBlob(creation));
    };
  });
}

export async function getCreation(id: string, database = defaultDatabase()): Promise<SavedCreation | null> {
  const store = (await database).transaction(STORE, "readonly").objectStore(STORE);
  const found = await request<StoredCreation | undefined>(store.get(id));
  return found ? current(found) : null;
}

/** Every creation the current parser can read, most recently updated first; an unreadable record is left out (listAllCreations lists it). */
export async function listCreations(database = defaultDatabase()): Promise<SavedCreation[]> {
  const { readable } = await listAllCreations(database);
  return readable;
}

/**
 * A stored record the current parser cannot read: listed as such, so one bad record
 * never hides the others, and still exportable as it was stored.
 */
export interface UnreadableCreation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  previewPng: Blob;
  engine?: string;
  /** The recipe as it was stored, for export. */
  stored: unknown;
  /** What the parser refused. */
  problem: string;
}

/**
 * Both lists from one read of the store, each most recently updated first: the
 * saved-images section shows the two together, so it reads and parses the records once.
 */
export async function listAllCreations(database = defaultDatabase()): Promise<{ readable: SavedCreation[]; unreadable: UnreadableCreation[] }> {
  const store = (await database).transaction(STORE, "readonly").objectStore(STORE);
  const stored = await request<StoredCreation[]>(store.getAll());
  const readable: SavedCreation[] = [];
  const unreadable: UnreadableCreation[] = [];
  for (const record of stored) {
    try {
      readable.push(current(record));
    } catch (error) {
      const { id, title, createdAt, updatedAt, previewPng, engine } = record;
      const problem = error instanceof Error ? error.message : String(error);
      unreadable.push({ id, title, createdAt, updatedAt, previewPng: pictureBlob(previewPng), ...(engine ? { engine } : {}), stored: record.recipe, problem });
    }
  }
  const newestFirst = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);
  return { readable: readable.sort(newestFirst), unreadable: unreadable.sort(newestFirst) };
}

/** The stored creation with its recipe in the current shape and its picture as a Blob, marked when its image was made by an earlier objective. */
function current(stored: StoredCreation): SavedCreation {
  const upgradedFrom = imageUpgradedFrom(stored);
  return { ...withBlob(stored), recipe: parseRecipe(stored.recipe), ...(upgradedFrom ? { upgradedFrom } : {}) };
}

/** A stored record's mark: as marked, or read from its recipe as it was saved (a record an older app version wrote). */
function imageUpgradedFrom(stored: StoredCreation | undefined): UpgradedFrom | undefined {
  if (!stored) return undefined;
  return stored.upgradedFrom ?? recipeUpgradedFrom(stored.recipe);
}

/** Renames a creation; a rename does not change its recipe or image. */
export async function renameCreation(id: string, title: string, database = defaultDatabase()): Promise<SavedCreation> {
  return readWrite(await database, (store, finish, fail) => {
    const reading = store.get(id);
    reading.onsuccess = () => {
      const existing = reading.result as StoredCreation | undefined;
      if (!existing) return fail(new Error(`No saved image ${id}`));
      const renamed = { ...existing, title, updatedAt: new Date().toISOString() };
      store.put(renamed);
      finish(withBlob(renamed));
    };
  });
}

export async function deleteCreation(id: string, database = defaultDatabase()): Promise<void> {
  await readWrite<void>(await database, (store, finish) => {
    store.delete(id);
    finish(undefined);
  });
  // A deleted record is not the one to reopen on the next load.
  forgetLastCreation(id);
}

/**
 * Runs `body` in one read-write transaction and resolves with the value passed
 * to `finish` once the transaction commits, so a resolved save is durable.
 */
function readWrite<T>(
  database: IDBDatabase,
  body: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    let result: { value: T } | null = null;
    let failure: Error | null = null;
    transaction.oncomplete = () => (failure ? reject(failure) : resolve(result!.value));
    // A request's error reaches the transaction while transaction.error is still null; the request holds it.
    transaction.onerror = (event) => reject((event.target as IDBRequest).error ?? transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error);
    body(
      transaction.objectStore(STORE),
      (value) => {
        result = { value };
      },
      (error) => {
        failure = error;
        transaction.abort();
      },
    );
  });
}

function request<T>(pending: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result as T);
    pending.onerror = () => reject(pending.error);
  });
}
