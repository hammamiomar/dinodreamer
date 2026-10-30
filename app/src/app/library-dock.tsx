// The image editor's live creation stays visible over /create/basis panels. The editor owns
// its content; this module chooses its host, form and fold state. Both hosts are inside the
// panel's dialog so its focus loop includes the dock: a rail column when available, otherwise
// a fixed tray. The floating tray starts folded and keeps the visitor's choice until reload.
// On narrow windows the open tray spans the window, with a canvas up to 320 px wide.

import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import type { DockForm } from "../features/editor/dock-canvas";
import { useEditorSession } from "./editor-session";

const DockCanvas = lazy(async () => ({ default: (await import("../features/editor/dock-canvas")).DockCanvas }));

/** A block panel over Create. */
export function isCreatePanelPath(pathname: string): boolean {
  return pathname.startsWith("/create/basis/");
}

/** The block of the open panel, from its path; null without a panel. */
export function panelBlock(pathname: string): number | null {
  const match = /^(?:\/create)?\/basis\/(\d+)/.exec(pathname);
  return match ? Number(match[1]) : null;
}

/** Over Create: the request the panel was opened from (`?request=`, block/panel-path.ts); null elsewhere. */
export function panelRequest(pathname: string, search: string): number | null {
  if (!isCreatePanelPath(pathname)) return null;
  const request = new URLSearchParams(search).get("request") ?? "";
  return /^\d+$/.test(request) ? Number(request) : null;
}

/** A creation worth showing: it has a request, or a run has applied a recipe. */
export function hasLiveCreation(requestCount: number, runStarted: boolean): boolean {
  return requestCount > 0 || runStarted;
}

/** The dock shows for a live creation. */
export const dockShown = hasLiveCreation;

export type DockPlacement = "none" | "panel" | "float";

/**
 * Where the dock mounts. Over a block panel of the image editor: in the panel's rail slot when it
 * has one, else floating over the panel. Elsewhere nowhere: the Create screen has its own canvas,
 * and no page outside the image editor carries the creation.
 */
export function dockPlacement(pathname: string, shown: boolean, panelSlot: boolean): DockPlacement {
  if (!shown || !isCreatePanelPath(pathname)) return "none";
  return panelSlot ? "panel" : "float";
}

/** The slots an open block panel registers, both inside its dialog. */
export type DockSlots = {
  /** In the panel's rail column, while the panel renders one. */
  rail: HTMLElement | null;
  /** At the end of the dialog, outside its layout: the floating tray is position: fixed. */
  float: HTMLElement | null;
};

/**
 * The element the dock mounts in: the slot for its placement, inside the panel's dialog;
 * null mounts it in place until the panel registers its slot.
 */
export function dockHost(placement: DockPlacement, slots: DockSlots): HTMLElement | null {
  if (placement === "panel") return slots.rail;
  if (placement === "float") return slots.float;
  return null;
}

/** The rail is the panel's column; every other placement is a tray at the window's corner. */
export function dockForm(placement: DockPlacement): DockForm {
  return placement === "panel" ? "rail" : "tray";
}

/** The tray folds; a dock in the panel's rail covers nothing and never folds. */
export function dockFolds(placement: DockPlacement): boolean {
  return placement === "float";
}

/** The visitor's last fold or open of the tray, which holds until the page reloads; null before any. */
export type FoldChoice = "open" | "folded" | null;

/** The floating tray starts folded, then follows the visitor's choice. The rail never folds. */
export function dockFolded(placement: DockPlacement, choice: FoldChoice): boolean {
  if (!dockFolds(placement)) return false;
  if (choice !== null) return choice === "folded";
  return true;
}

/** The dock's canvas: the rail is this plus 16 px on each side. */
const DOCK_SIZE = 320;
/** Phone width: the open tray is a sheet across the window. */
const NARROW_WINDOW = 700;

/** The canvas of a phone's sheet: 320 px, less where the window cannot hold it with its padding. */
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
  const placement = dockPlacement(pathname, shown, slots.rail !== null);
  const form = dockForm(placement);
  const folds = dockFolds(placement);
  const folded = dockFolded(placement, choice);
  const sheet = form === "tray" && narrow;
  if (placement === "none") return null;

  const element = (
    <aside
      className="library-dock"
      data-placement={placement}
      data-folds={folds || undefined}
      data-folded={folded || undefined}
      data-sheet={sheet || undefined}
      aria-label="Your image"
    >
      <Suspense fallback={null}>
        <DockCanvas
          size={sheet ? sheetCanvasSize(windowWidth) : DOCK_SIZE}
          form={form}
          blockOnShow={panelBlock(pathname)}
          requestId={panelRequest(pathname, search)}
          folded={folded}
          onToggle={folds ? () => setChoice(folded ? "open" : "folded") : undefined}
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

/* What an open block panel tells the dock, as an external store: the slots the dock mounts in (one panel at a time). */

let dockSlots: DockSlots = { rail: null, float: null };
const slotListeners = new Set<() => void>();

function setDockSlots(slots: DockSlots): void {
  dockSlots = slots;
  for (const listener of slotListeners) listener();
}

/** A panel's rail slot while the panel renders its rail column; null otherwise, and when the panel closes. */
export function registerDockSlot(element: HTMLElement | null): void {
  setDockSlots({ ...dockSlots, rail: element });
}

/** A panel's floating slot, inside its dialog, while the panel is open; null when it closes. */
export function registerFloatingDockSlot(element: HTMLElement | null): void {
  setDockSlots({ ...dockSlots, float: element });
}

/** The slots of the open block panel: the image editor's dock and Train's tray mount in them. */
export function useDockSlots(): DockSlots {
  return useSyncExternalStore(
    (listener) => {
      slotListeners.add(listener);
      return () => slotListeners.delete(listener);
    },
    () => dockSlots,
  );
}
