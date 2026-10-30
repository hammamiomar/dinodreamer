// A basis group opens in a sliding panel over the current page, preserving its
// scroll, choices and active runs. A shared /basis/:id opens over the Index.
// An automaton's panel leads with its reference patch.
//
// The panel mounts the block view after its entrance animation and initial read
// finish, keeping the animated element light. Closing animates before navigating.

import { forwardRef, useEffect, useRef, useState, type PointerEvent } from "react";
import { Link, useLocation, useNavigate, useOutletContext, useParams, type LinkProps } from "react-router";
import { useLibrary } from "../../app/library-session";
import { registerFloatingDockSlot } from "../../app/library-dock";
import { anchorToken, type CloudToken } from "./cloud-token";
import { LookContent, lookData, type LookData } from "./look-page";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { BasisGroupLinkLabel } from "../../ui/basis-group-link-label";
import { LOOK_TEXT } from "./look-text";
import type { MaterialAnchor } from "../../recipe";
import "./basis-group-panel.css";

/** The pages a basis group panel opens over. */
export type PanelHome = "/index" | "/automata" | "/admin/materials" | "/train" | "/picture" | "/how" | "/create";
const PANEL_HOMES: readonly PanelHome[] = ["/index", "/automata", "/admin/materials", "/train", "/picture", "/how", "/create"];

/** The history state of a panel opened from its page: closing it goes back to that entry. */
export const PANEL_OPENED = { basisGroupPanel: true } as const;

/** What the page under the panel offers it: the reference patch of the automaton it plays, for a basis group. */
export interface BasisGroupPanelOutlet {
  referencePatch: (block: number) => Promise<MaterialAnchor | null>;
}

/** The page a panel at `pathname` opens over, or null where there is none (a panel path or its page). */
export function panelHome(pathname: string): PanelHome | null {
  return PANEL_HOMES.find((home) => pathname === home || pathname.startsWith(`${home}/`)) ?? null;
}

/**
 * Where a basis group's number leads from a page: its panel over that page, keeping the page's
 * address (its choices, the automaton playing), or, from a page without panels, its panel over the
 * Index (/basis/:id).
 */
export function basisGroupPath(pathname: string, search: string, block: number): string {
  const home = panelHome(pathname);
  if (home !== null) return `${home}/basis/${block}${search}`;
  const engine = new URLSearchParams(search).get("engine");
  return `/basis/${block}${engine === "fake" ? "?engine=fake" : ""}`;
}

/** The basis group a panel's address names, or null when it names none. */
export function addressedBlock(id: string | undefined): number | null {
  if (id === undefined || !/^\d+$/.test(id)) return null;
  const block = Number(id);
  return block < 16384 ? block : null;
}

/**
 * Every link to a basis group: its panel over this page (basisGroupPath), opened as a step of this
 * page's history, so Back and Close return to it, and keeping the page's scroll. A press starts the
 * block's initial read, so the panel often has it by the time it has slid in.
 * Without custom children, the link shows the group number with its opening cue.
 */
export const BasisGroupLink = forwardRef<HTMLAnchorElement, { block: number } & Omit<LinkProps, "to" | "state" | "preventScrollReset">>(
  function BasisGroupLink({ block, children, className, onPointerDown, ...link }, ref) {
    const { pathname, search } = useLocation();
    const library = useLibrary();
    const press = (event: PointerEvent<HTMLAnchorElement>) => {
      void library.initialBlockCloud(block).catch(() => undefined);
      onPointerDown?.(event);
    };
    const numberOnly = children === undefined;
    return (
      <Link {...link} ref={ref}
        className={[className, numberOnly ? "basis-group-number-link" : null].filter(Boolean).join(" ")}
        to={basisGroupPath(pathname, search, block)} state={PANEL_OPENED} preventScrollReset onPointerDown={press}>
        {numberOnly ? <BasisGroupLinkLabel block={block} /> : children}
      </Link>
    );
  },
);

/** Whether a location was reached by opening its panel from the page under it (so Back closes it). */
function openedFromItsPage(state: unknown): boolean {
  return (state as { basisGroupPanel?: unknown } | null)?.basisGroupPanel === true;
}

/** Whether a press landed outside the panel's box: on the dimmed page beside it. */
function outsideBox(element: HTMLElement, x: number, y: number): boolean {
  const box = element.getBoundingClientRect();
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}

/** Resolves when the element's own animations have ended or been replaced; at once without any. */
function animationsSettled(element: HTMLElement): Promise<unknown> {
  return Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
}

type PanelContent =
  | { status: "reading" }
  | { status: "ready"; data: LookData; origin: CloudToken | null }
  | { status: "failed"; message: string };

/** The block's initial read and, from Automata, the playing automaton's reference patch. */
function usePanelContent(block: number | null, outlet: BasisGroupPanelOutlet | undefined): PanelContent {
  const library = useLibrary();
  const [read, setRead] = useState<{ block: number; content: PanelContent } | null>(null);
  useEffect(() => {
    if (block === null) return;
    let live = true;
    const origin = outlet
      ? outlet.referencePatch(block).then((anchor) => (anchor ? anchorToken(anchor) : null), () => null)
      : Promise.resolve(null);
    Promise.all([library.initialBlockCloud(block), origin]).then(
      ([cloud, token]) => { if (live) setRead({ block, content: { status: "ready", data: lookData(cloud), origin: token } }); },
      (error: unknown) => { if (live) setRead({ block, content: { status: "failed", message: error instanceof Error ? error.message : String(error) } }); },
    );
    return () => { live = false; };
  }, [library, block, outlet]);
  if (block === null) return { status: "failed", message: LOOK_TEXT.notABlock };
  return read?.block === block ? read.content : { status: "reading" };
}

export function BasisGroupPanel({ home }: { home: PanelHome }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const block = addressedBlock(useParams().id);
  const content = usePanelContent(block, useOutletContext<BasisGroupPanelOutlet | undefined>());
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);

  // Restore focus to the opener on close; mount the view after the entrance animation.
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!element) return;
    if (!element.open) element.showModal();
    let live = true;
    void animationsSettled(element).then(() => { if (live) setEntered(true); });
    return () => {
      live = false;
      element.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // Back to the page as it was, once the panel has slid out: one step back when the panel was opened
  // from it, else to its address.
  useEffect(() => {
    const element = dialog.current;
    if (!closing || !element) return;
    let live = true;
    void animationsSettled(element).then(() => {
      if (!live) return;
      if (openedFromItsPage(location.state)) navigate(-1);
      else navigate(`${home}${location.search}`, { replace: true, preventScrollReset: true });
    });
    return () => { live = false; };
  }, [closing, home, location.state, location.search, navigate]);
  const close = () => setClosing(true);

  return (
    <dialog ref={dialog} className="basis-panel" data-closing={closing || undefined}
      aria-label={block === null ? LOOK_TEXT.notABlock : LOOK_TEXT.panel.name(block)}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget && outsideBox(event.currentTarget, event.clientX, event.clientY)) close(); }}>
      <div className="basis-panel-bar">
        <div className="basis-panel-band basis-panel-bar-row">
          <button type="button" className="link-control" onClick={close}>{LOOK_TEXT.panel.close}</button>
        </div>
      </div>
      <div className="basis-panel-band">
        {content.status === "failed" && <p className="basis-panel-message">{content.message}</p>}
        {content.status === "ready" && entered
          ? <div className="basis-panel-content"><LookContent data={content.data} origin={content.origin} scroller={dialog} /></div>
          : content.status !== "failed" && block !== null && <PanelHead block={block} />}
      </div>
      {/* Trays at the window's corner (Train's run) mount here while the panel is open, inside its top layer. */}
      <div ref={registerFloatingDockSlot} className="basis-panel-tray" />
    </dialog>
  );
}

/** While the view is read and the panel slides: the number and a visible loading status. */
function PanelHead({ block }: { block: number }) {
  return (
    <div className="look-page" aria-busy="true">
      <header className="look-head">
        <h1 className="display">{block}</h1>
      </header>
      <LoadingIndicator>Loading basis group…</LoadingIndicator>
    </div>
  );
}
