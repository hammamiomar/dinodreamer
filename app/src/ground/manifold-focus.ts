// Shared focus channel connecting the active visual concept (basis group and its sampled colour)
// to the site-wide 3D curved manifold ground (`ground/lattice.ts`).
//
// Components mount in layers—for example, `/train/basis/4009?block=729` opens a panel over `/train`.
// React runs child effects before parent effects, so `useManifoldFocus` assigns a monotonic
// top-down render order AND supports an explicit `"panel"` layer; `"panel"` claims always beat
// `"page"` claims, and within a layer deeper/later-mounted views beat outer views. Unmounting a
// view releases its claim and cleanly restores the underlying view or neutral manifold.

import { useEffect, useRef } from "react";

export type ManifoldFocusLayer = "page" | "panel";

export interface ManifoldFocus {
  readonly group: number | null;
  readonly accent: string | null;
}

export interface ManifoldFocusClaimOptions {
  readonly layer?: ManifoldFocusLayer;
  /** Monotonic render/mount precedence within a layer; defaults to the claim's sequence id. */
  readonly order?: number;
}

export interface ManifoldFocusClaim {
  update(next: ManifoldFocus): void;
  release(): void;
}

export interface ManifoldFocusStore {
  getFocus(): ManifoldFocus;
  claim(initial: ManifoldFocus, options?: ManifoldFocusClaimOptions): ManifoldFocusClaim;
  subscribe(listener: () => void): () => void;
}

interface ClaimRecord {
  readonly id: number;
  readonly layerRank: number;
  readonly order: number;
  focus: ManifoldFocus;
}

const EMPTY_FOCUS: ManifoldFocus = { group: null, accent: null };

function sameFocus(a: ManifoldFocus, b: ManifoldFocus): boolean {
  return a.group === b.group && a.accent === b.accent;
}

function rankOfLayer(layer: ManifoldFocusLayer | undefined): number {
  return layer === "panel" ? 1 : 0;
}

/** Pure claim-stack store, testable without React or browser globals. */
export function createManifoldFocusStore(): ManifoldFocusStore {
  const claims: ClaimRecord[] = [];
  const listeners = new Set<() => void>();
  let nextId = 1;
  let current: ManifoldFocus = EMPTY_FOCUS;

  const resolve = (): ManifoldFocus => {
    let best: ClaimRecord | null = null;
    for (const claim of claims) {
      if (claim.focus.group === null && claim.focus.accent === null) continue;
      if (
        best === null ||
        claim.layerRank > best.layerRank ||
        (claim.layerRank === best.layerRank &&
          (claim.order > best.order || (claim.order === best.order && claim.id > best.id)))
      ) {
        best = claim;
      }
    }
    return best ? best.focus : EMPTY_FOCUS;
  };

  const notifyIfChanged = () => {
    const resolved = resolve();
    if (sameFocus(current, resolved)) return;
    current = resolved;
    for (const listener of listeners) listener();
  };

  return {
    getFocus() {
      return current;
    },
    claim(initial, options) {
      const id = nextId++;
      const record: ClaimRecord = {
        id,
        layerRank: rankOfLayer(options?.layer),
        order: options?.order ?? id,
        focus: initial,
      };
      claims.push(record);
      notifyIfChanged();
      return {
        update(next) {
          if (sameFocus(record.focus, next)) return;
          record.focus = next;
          notifyIfChanged();
        },
        release() {
          const at = claims.findIndex((item) => item.id === record.id);
          if (at === -1) return;
          claims.splice(at, 1);
          notifyIfChanged();
        },
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const siteManifoldFocus = createManifoldFocusStore();

/** Monotonic top-down React render sequence so child overlays beat parent pages even on direct load. */
let nextRenderOrder = 1;

/**
 * Announce the basis group (`0..16383`) and optional `--sampled` CSS colour currently in focus.
 * Pass `null` when no specific group is active so an underlying view or the neutral manifold shows.
 */
export function useManifoldFocus(
  group: number | null,
  accent: string | null = null,
  layer: ManifoldFocusLayer = "page",
): void {
  const handle = useRef<ManifoldFocusClaim | null>(null);
  const renderOrder = useRef<number | null>(null);
  if (renderOrder.current === null) {
    renderOrder.current = nextRenderOrder++;
  }
  const latest = useRef<ManifoldFocus>({ group, accent });
  latest.current = { group, accent };

  useEffect(() => {
    const claimed = siteManifoldFocus.claim(latest.current, {
      layer,
      order: renderOrder.current!,
    });
    handle.current = claimed;
    return () => {
      claimed.release();
      handle.current = null;
    };
  }, [layer]);

  useEffect(() => {
    handle.current?.update({ group, accent });
  }, [group, accent]);
}
