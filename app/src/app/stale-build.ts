// A tab opened before a deploy can request a removed lazy chunk, worker or wasm file.
// Reload once after an import failure or an engine startup failure that a new build can
// explain. The editor restores the last autosave; changes since that save can be lost.
//
// The sessionStorage guard permits only one reload per tab in RELOAD_GUARD_MS. A repeated
// failure shows its error instead of looping. Without storage, recovery cannot reload.

import type { RunState } from "../features/editor/run/session";

export const STALE_RELOAD_KEY = "dinodreamer.staleBuildReload";
/** How long after a healing reload another failure shows its error instead of reloading again. */
export const RELOAD_GUARD_MS = 120_000;
/**
 * How long the reload waits: longer than the autosave's delay after an edit
 * (creation-autosave.ts SAVE_DELAY_MS, 1.5 s) plus its write, so a request made
 * just before the failure (a token clicked in the Index opens Create) is saved first.
 */
export const RELOAD_DELAY_MS = 2500;

type GuardStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Marks a healing reload and says whether to make it: true when no reload
 * happened in this tab within RELOAD_GUARD_MS and the mark could be stored.
 */
export function claimStaleBuildReload(storage: GuardStorage | undefined, now: number): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(STALE_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_MS) return false;
    storage.setItem(STALE_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the engine failed before it ever loaded, for a reason a newer build
 * explains: its worker script never started (no capabilities report arrived), or
 * the engine module did not load (the worker reports "failed to fetch Wasm: 404").
 * A machine without WebGPU, a lost device or a corrupt model file is not a stale
 * build, and neither is a failure after the engine has run.
 */
export function engineStartFailedForStaleBuild(session: Pick<RunState, "phase" | "settledPhase" | "capabilities" | "error" | "phaseMessage">): boolean {
  const failed = session.phase === "failed" || session.error?.fatal === true;
  if (!failed || session.settledPhase !== "idle") return false;
  if (session.capabilities === undefined) return true;
  if (!session.capabilities.webgpu) return false;
  return /wasm/i.test(`${session.error?.message ?? ""} ${session.phaseMessage ?? ""}`);
}

function tabStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Reloads the page once for a stale build, after RELOAD_DELAY_MS; false when the
 * guard holds and the error should show. The claim is immediate, so a second
 * failure meanwhile does not schedule a second reload.
 */
export function reloadForStaleBuild(reason: string): boolean {
  if (!claimStaleBuildReload(tabStorage(), Date.now())) return false;
  console.warn(`Reloading once: ${reason}`);
  setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
  return true;
}

/**
 * A lazy chunk that fails to load (Vite dispatches vite:preloadError for it)
 * reloads the page once. The error still propagates, so after the guarded
 * reload the screen's error names the file. Installed before the router starts,
 * because a direct load of a lazy route imports its chunk at once.
 */
export function installLazyImportRecovery(): void {
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    reloadForStaleBuild(payload instanceof Error ? payload.message : "a lazy chunk did not load");
  });
}
