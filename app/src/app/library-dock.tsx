// Floating dock that keeps the image editor's live creation accessible over `/create/basis/` panels.
// Mounts inside the open panel's dialog so keyboard focus stays within the modal.

import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { useEditorSession } from "./editor-session";
import { SITE_WORDS } from "./site-words";

const DockCanvas = lazy(async () => ({ default: (await import("../features/editor/dock-canvas")).DockCanvas }));

/** True when `pathname` is a basis group panel opened over Create. */
export function isCreatePanelPath(pathname: string): boolean {
  return pathname.startsWith("/create/basis/");
}

/** Basis group number from a panel path, or null when no panel is open. */
export function panelBlock(pathname: string): number | null {
  const match = /^(?:\/create)?\/basis\/(\d+)/.exec(pathname);
  return match ? Number(match[1]) : null;
}

/** Request id from `?request=` on a panel opened over Create, or null elsewhere. */
export function panelRequest(pathname: string, search: string): number | null {
  if (!isCreatePanelPath(pathname)) return null;
  const request = new URLSearchParams(search).get("request") ?? "";
  return /^\d+$/.test(request) ? Number(request) : null;
}

/** True when a creation has at least one request or an active synthesis run. */
export function hasLiveCreation(requestCount: number, runStarted: boolean): boolean {
  return requestCount > 0 || runStarted;
}

export const dockShown = hasLiveCreation;

export type DockPlacement = "none" | "float";

/** Mount as a floating tray over `/create/basis/` panels while a creation is active. */
export function dockPlacement(pathname: string, shown: boolean): DockPlacement {
  if (!shown || !isCreatePanelPath(pathname)) return "none";
  return "float";
}

export type DockSlots = {
  /** Portal host inside the active basis group panel dialog. */
  float: HTMLElement | null;
};

/** Portal host for the active placement, or null before the panel registers its slot. */
export function dockHost(placement: DockPlacement, slots: DockSlots): HTMLElement | null {
  return placement === "float" ? slots.float : null;
}

/** User fold choice kept until reload; null uses the default folded state. */
export type FoldChoice = "open" | "folded" | null;

/** The floating tray starts folded and then follows the user's choice. */
export function dockFolded(placement: DockPlacement, choice: FoldChoice): boolean {
  if (placement !== "float") return false;
  if (choice !== null) return choice === "folded";
  return true;
}

const DOCK_SIZE = 320;
const NARROW_WINDOW = 700;

/** Canvas side for narrow viewports where the open tray spans the window width. */
export function sheetCanvasSize(windowWidth: number): number {
  return Math.min(DOCK_SIZE, windowWidth - 32);
}

export function LibraryDock() {
  const { pathname, search } = useLocation();
  const { state, run } = useEditorSession();
  const [choice, setChoice] = useState<FoldChoice>(null);
  const windowWidth = useWindowWidth();
  const narrow = windowWidth <= NARROW_WINDOW;
  const slots = useDockSlots();
  const shown = dockShown(state.recipe.requests.length, run.session.applied !== undefined);
  const placement = dockPlacement(pathname, shown);
  const folded = dockFolded(placement, choice);
  if (placement === "none") return null;

  const element = (
    <aside
      className="library-dock"
      data-placement={placement}
      data-folds
      data-folded={folded || undefined}
      data-sheet={narrow || undefined}
      aria-label={SITE_WORDS.frame.dockLabel}
    >
      <Suspense fallback={null}>
        <DockCanvas
          size={narrow ? sheetCanvasSize(windowWidth) : DOCK_SIZE}
          form="tray"
          blockOnShow={panelBlock(pathname)}
          requestId={panelRequest(pathname, search)}
          folded={folded}
          onToggle={() => setChoice(folded ? "open" : "folded")}
        />
      </Suspense>
    </aside>
  );
  const host = dockHost(placement, slots);
  return host ? createPortal(element, host) : element;
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

let dockSlots: DockSlots = { float: null };
const slotListeners = new Set<() => void>();

/** Register or clear the floating portal slot inside an open basis group panel dialog. */
export function registerFloatingDockSlot(element: HTMLElement | null): void {
  dockSlots = { float: element };
  for (const listener of slotListeners) listener();
}

/** Active portal slots for the editor dock and Train tray. */
export function useDockSlots(): DockSlots {
  return useSyncExternalStore(
    (listener) => {
      slotListeners.add(listener);
      return () => slotListeners.delete(listener);
    },
    () => dockSlots,
  );
}
