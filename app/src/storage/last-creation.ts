// Which saved creation the editor reopens on load: the record this device's autosave
// wrote most recently, kept in localStorage beside the saves database.
// A reload, a browser crash or a deploy then returns the visitor to the same creation.
// A visitor with no records gets a new creation. The pointer is advisory: a record
// that was deleted since, or cannot be read, falls back to a new creation.

const KEY = "dinodreamer.lastCreation";

/** The storage the pointer lives in; tests pass their own. */
export type PointerStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function localPointerStore(): PointerStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Access can throw where storage is blocked; the editor then simply starts new.
    return null;
  }
}

/** Records the id the autosave wrote. */
export function rememberLastCreation(id: string, store: PointerStore | null = localPointerStore()): void {
  try {
    store?.setItem(KEY, id);
  } catch {
    // A full or blocked storage loses only the pointer, never the save.
  }
}

/** The id to reopen, or null for a new creation. */
export function lastCreationId(store: PointerStore | null = localPointerStore()): string | null {
  try {
    return store?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

/** Forgets the pointer, as when its record is deleted. */
export function forgetLastCreation(id: string, store: PointerStore | null = localPointerStore()): void {
  try {
    if (store?.getItem(KEY) === id) store.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
