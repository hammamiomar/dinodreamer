// The batch size a Train run starts with: the recipe's 4, or 1, which needs about half the memory
// (measured 2026-10-30: 0.83 to 0.90 GB of GPU memory against 1.50 to 1.76 GB at 4). The person can
// choose it under Advanced; without a choice the page presets it, and falls back to 1 for the rest
// of the tab after a run at 4 stopped the page or the graphics device.

export type BatchSize = 1 | 4;
export const RECIPE_BATCH: BatchSize = 4;
export const LIGHT_BATCH: BatchSize = 1;

/** Why the page fell back to batch size 1: a run at 4 took the page down, or the graphics device. */
export type FallbackReason = "reload" | "device";
export interface BatchFallback {
  reason: FallbackReason;
}

/** The tab's record of a run in progress, its batch size: present after a reload only when the page went down mid-run. */
const RUN_KEY = "dinodreamer.train.run";
/** The tab's fallback, as JSON. */
const FALLBACK_KEY = "dinodreamer.train.batch-fallback";
/** Present once a run went down with the page in this tab; kept when the person chooses a batch size. */
const WENT_DOWN_KEY = "dinodreamer.train.went-down";
/** A phone's shorter side, in CSS pixels; a tablet's is 744 or more. */
const PHONE_SIDE = 600;

function storage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/** A phone: a coarse pointer and a screen whose shorter side is under PHONE_SIDE. */
export function onPhone(): boolean {
  return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < PHONE_SIDE;
}

/** The tab's fallback, if a run at 4 stopped the page or the device earlier in it. */
export function batchFallback(): BatchFallback | null {
  const stored = storage()?.getItem(FALLBACK_KEY);
  if (!stored) return null;
  const reason = JSON.parse(stored).reason;
  return reason === "reload" || reason === "device" ? { reason } : null;
}

/** The person chose a batch size: the fallback no longer applies. */
export function clearBatchFallback(): void {
  storage()?.removeItem(FALLBACK_KEY);
}

/**
 * The batch size before the person chooses one: `?growBatch=1` or `4` in the address, else 1 after
 * the tab's fallback, else 1 on a phone, where 4 did not fit the memory of an iPhone 16 Pro Max
 * (2026-10-30), else the recipe's 4.
 */
export function presetBatch(search = globalThis.location?.search): BatchSize {
  const requested = new URLSearchParams(search).get("growBatch");
  if (requested === "1") return LIGHT_BATCH;
  if (requested === "4") return RECIPE_BATCH;
  if (batchFallback() !== null) return LIGHT_BATCH;
  return onPhone() ? LIGHT_BATCH : RECIPE_BATCH;
}

/** The fallback a stopped run leaves: one at 4 falls back to 1; one at 1 has nothing lower. */
export function fallbackAfter(reason: FallbackReason, batch: BatchSize): BatchFallback | null {
  return batch === RECIPE_BATCH ? { reason } : null;
}

function recordFallback(fallback: BatchFallback | null) {
  if (fallback) storage()?.setItem(FALLBACK_KEY, JSON.stringify(fallback));
}

/** What the site's run tells the tab, so the next page load and the next start know what happened. */
export const runMemory = {
  started(batch: BatchSize): void {
    storage()?.setItem(RUN_KEY, String(batch));
  },
  ended(): void {
    storage()?.removeItem(RUN_KEY);
  },
  /** WebGPU lost the device during a run: on a device without room for it, out of memory. */
  deviceLost(batch: BatchSize): void {
    recordFallback(fallbackAfter("device", batch));
    this.ended();
  },
};

/**
 * On a page load: a run recorded as in progress means the page went down mid-run, the way a phone's
 * browser ends a page that takes too much memory. A page the person leaves or reloads clears the
 * record first (pagehide), so only a page that was taken down counts.
 */
export function noteInterruptedRun(): void {
  const stored = storage()?.getItem(RUN_KEY);
  if (stored === null || stored === undefined) return;
  runMemory.ended();
  storage()?.setItem(WENT_DOWN_KEY, "1");
  recordFallback(fallbackAfter("reload", stored === "1" ? LIGHT_BATCH : RECIPE_BATCH));
}

/**
 * Whether a run went down with the page earlier in this tab. Right after that, the browser can have
 * no GPU adapter for the page until it is reloaded (protocol.ts adapterUnavailable).
 */
export function runWentDownInThisTab(): boolean {
  return storage()?.getItem(WENT_DOWN_KEY) != null;
}

/** Installed once by the site's run: the record never outlives a page the person leaves. */
export function clearRunOnPageHide(target: Pick<EventTarget, "addEventListener"> | undefined = globalThis.window): void {
  target?.addEventListener("pagehide", () => runMemory.ended());
}
