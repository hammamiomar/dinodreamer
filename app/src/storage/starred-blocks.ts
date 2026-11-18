// Starred blocks: the block numbers a visitor starred, in the order starred,
// kept in this browser's localStorage. Only the block is kept; Explore shows
// each starred block's card for the current role. The list is shared with the
// panel's star control and Explore as an external store, and follows changes
// made in another tab through the storage event.
//
// When the storage refuses a write (quota, blocked site data, no storage at
// all), the page keeps the list in memory from then on: a star set in this
// session stays set and consistent everywhere, and only this page's lifetime
// is lost. A later write that succeeds hands the list back to the storage.

import { useSyncExternalStore } from "react";

const KEY = "starred-blocks";

/** The valid block numbers in a stored list, in order, each once. */
export function parseStarred(text: string | null): number[] {
  if (text === null) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    const blocks: number[] = [];
    for (const entry of value) {
      if (Number.isInteger(entry) && (entry as number) >= 0 && !blocks.includes(entry as number)) blocks.push(entry as number);
    }
    return blocks;
  } catch {
    return [];
  }
}

/** The list with `block` added at the end, or removed when it is there. */
export function toggled(blocks: readonly number[], block: number): number[] {
  return blocks.includes(block) ? blocks.filter((starred) => starred !== block) : [...blocks, block];
}

export interface StarredStore {
  /** The starred blocks, in the order starred; the same array until the list changes. */
  read(): number[];
  toggle(block: number): void;
  /** Calls `listener` when the list changes here; the app's store also listens for other tabs. */
  subscribe(listener: () => void): () => void;
}

/** A store over `storage`, which may be absent or refuse; `onStorageEvent` lets the app's store follow other tabs. */
export function createStarredStore(storage: () => Storage | undefined, onStorageEvent?: (refresh: () => void) => () => void): StarredStore {
  const listeners = new Set<() => void>();
  /** The parsed list, kept as one array until its text changes, so a store read is stable. */
  let cached: { text: string | null; blocks: number[] } = { text: null, blocks: [] };
  /** The list this page holds when the storage refused a write; it wins over the storage until a write succeeds. */
  let held: number[] | null = null;

  const read = (): number[] => {
    if (held !== null) return held;
    let text: string | null;
    try {
      text = storage()?.getItem(KEY) ?? null;
    } catch {
      text = null;
    }
    if (text !== cached.text) cached = { text, blocks: parseStarred(text) };
    return cached.blocks;
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const toggle = (block: number) => {
    const next = toggled(read(), block);
    const text = JSON.stringify(next);
    let written = false;
    try {
      const target = storage();
      if (target) {
        target.setItem(KEY, text);
        written = true;
      }
    } catch {
      written = false;
    }
    if (written) {
      held = null;
      cached = { text, blocks: next };
    } else {
      held = next;
    }
    notify();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const stopFollowing = onStorageEvent?.(listener);
    return () => {
      listeners.delete(listener);
      stopFollowing?.();
    };
  };

  return { read, toggle, subscribe };
}

function pageStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Another tab's change to the stored list. */
function followOtherTabs(refresh: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === KEY) refresh();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** The app's store: this browser's localStorage, following other tabs. */
export const starredBlocks: StarredStore = createStarredStore(pageStorage, followOtherTabs);

export function readStarred(): number[] {
  return starredBlocks.read();
}

export function toggleStar(block: number): void {
  starredBlocks.toggle(block);
}

/** The starred block numbers, in the order starred; re-renders when the list changes here or in another tab. */
export function useStarredBlocks(): number[] {
  return useSyncExternalStore(starredBlocks.subscribe, starredBlocks.read, () => []);
}
