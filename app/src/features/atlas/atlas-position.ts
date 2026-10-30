// Keep the actual Atlas search for this session: layout, order, filters and
// page. The frame restores scroll by that same URL, so navigation returns to
// the same cards and position. Older Atlas query strings remain valid links.

const KEY = "atlas-position";
/** The position when sessionStorage refuses (private windows, blocked site data). */
let held: string | null = null;

/** Records the actual search of the Atlas position just shown. */
export function rememberAtlasPosition(search: string, storage: Storage | undefined = sessionStorageOrNone()): void {
  held = search;
  try {
    storage?.setItem(KEY, search);
  } catch {
    // Nothing to do: the in-memory copy serves this page's lifetime.
  }
}

/** The search of the position the visitor left, or null before any Explore visit. */
export function recallAtlasPosition(storage: Storage | undefined = sessionStorageOrNone()): string | null {
  try {
    const stored = storage?.getItem(KEY) ?? null;
    return stored !== null && stored.startsWith("?") ? stored : held;
  } catch {
    return held;
  }
}

/** Return to the last Atlas position, or its default cloud view. */
export function explorePath(storage?: Storage): string {
  return `/index${recallAtlasPosition(storage) ?? ""}`;
}

function sessionStorageOrNone(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
