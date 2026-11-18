import { NavLink, Outlet, ScrollRestoration, useLocation, useNavigation, useRouteError } from "react-router";
import type { Location } from "react-router";
import { useEffect, useRef, useState } from "react";
import { explorePath } from "../features/atlas/atlas-position";
import { opensGroup } from "../features/automata/gallery";
import { startLattice, type Lattice } from "../ground/lattice";
import { keepFooterOnModule } from "../ui/module-snap";
import { pageScale } from "../ui/page-scale";
import { LibraryReadError } from "../library/library";
import { EditorSessionProvider, useEditorSession } from "./editor-session";
import { LibraryDock } from "./library-dock";
import { TrainTray } from "../grow/train-tray";
import { SiteFooter } from "./site-footer";
import { SITE_WORDS } from "./site-words";
import { engineStartFailedForStaleBuild, reloadForStaleBuild } from "./stale-build";
import type { PointerEvent, ReactNode, RefObject } from "react";

const NAVIGATION_WORDS = { menu: "Menu", name: "Site navigation" };

export function Frame() {
  const navigation = useNavigation();
  const location = useLocation();
  return (
    <EditorSessionProvider>
      {/* Every page bends as the window scrolls; one that does not scroll stays flat, its progress 0 (ground/lattice.ts). */}
      <Ground bends pathname={location.pathname} />
      <FrameLayout busy={navigation.state !== "idle"}>
        <Outlet />
        {!fitsTheWindow(location.pathname, location.search) && <SiteFooter />}
        {/* The site owns Train's scale, both here and in a panel's floating slot. */}
        <TrainTray />
      </FrameLayout>
      <LibraryDock />
      <EngineStartRecovery />
      <ScrollRestoration getKey={scrollKey} />
    </EditorSessionProvider>
  );
}

/**
 * An engine that failed to start because this tab's build is gone from the
 * server reloads the page once (stale-build.ts); after a guarded reload the
 * run's own error line, on Create and on the dock, names what failed.
 */
function EngineStartRecovery() {
  const { run } = useEditorSession();
  const stale = engineStartFailedForStaleBuild(run.session);
  const reason = run.session.error?.message ?? run.session.phaseMessage ?? "the engine did not start";
  useEffect(() => {
    if (stale) reloadForStaleBuild(reason);
  }, [stale, reason]);
  return null;
}

/**
 * Screens laid out to fit the window have no footer after them: the Canvas, with its block panel
 * over it, the Playground and its owner mode, where only the shelf scrolls and its last line is the
 * footer's job, Train, one screen around its material, and How it works, one screen of words and a
 * figure. Each keeps that with a basis group's panel open over it (<screen>/basis/N).
 */
export function fitsTheWindow(pathname: string, search = ""): boolean {
  const under = (screen: string) => pathname === screen || pathname.startsWith(`${screen}/`);
  // Automata fits the window while a basis group's screen is open; its wall of groups is a page that scrolls. So does the owner's view of it.
  if (under("/automata") || under("/admin/automata")) return opensGroup(new URLSearchParams(search));
  return ["/create", "/train", "/how"].some(under);
}

/** The Experimental link marks its page: the Painter's page and the Painter with its panels. */
export function experimentalPage(pathname: string): boolean {
  return pathname === "/canvas" || pathname === "/create" || pathname.startsWith("/create/");
}

/**
 * The image editor (/create, its block panel) is drawn at scale 1 on any window (styles.css,
 * --page-scale): its painting maps the pointer to the picture's pixels on its own terms.
 */
export function keepsPageScaleOne(pathname: string): boolean {
  return pathname === "/create" || pathname.startsWith("/create/");
}

/** The lattice behind every page (ground/lattice.ts): one canvas, drawn on scroll and resize only. */
function Ground({ bends, pathname = "" }: { bends: boolean; pathname?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const lattice = useRef<Lattice | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const started = startLattice(canvas.current);
    lattice.current = started;
    return () => {
      started.stop();
      lattice.current = null;
    };
  }, []);
  useEffect(() => {
    lattice.current?.setBends(bends);
  }, [bends]);
  // A new route may change the page scale (the image editor keeps 1, ui/page-scale.ts) with no scroll or resize; the
  // redraw runs after the frame's own effects, once the site carries the new route's scale.
  useEffect(() => {
    lattice.current?.redraw();
  }, [pathname]);
  return <canvas ref={canvas} className="ground" aria-hidden="true" />;
}

/**
 * Scroll is kept per Index position, whatever history entry shows it: the
 * Index link in the navigation returns to the place the visitor left, not to
 * the top. Every other screen keeps its scroll per history entry, as usual.
 */
export function scrollKey(location: Location): string {
  return location.pathname === "/index" ? `${location.pathname}${location.search}` : location.key;
}

/** Shown while the release manifest loads for the first time. */
export function FrameLoading() {
  return (
    <FrameLayout busy>
      <main className="page page-message">{SITE_WORDS.frame.loadingLibrary}</main>
    </FrameLayout>
  );
}

/** The release manifest could not be read, so no screen can start. */
export function FrameError() {
  const error = useRouteError();
  // The frame's error boundary also catches a part of the frame that failed to load (the dock's chunk).
  const title = error instanceof LibraryReadError ? SITE_WORDS.frame.libraryFailed : SITE_WORDS.frame.pageFailed;
  return (
    <FrameLayout busy={false}>
      <main className="page page-message">
        <h1>{title}</h1>
        <p className="muted">{error instanceof Error ? error.message : String(error)}</p>
        <button className="button" onClick={() => window.location.reload()}>
          {SITE_WORDS.frame.tryAgain}
        </button>
      </main>
    </FrameLayout>
  );
}

/**
 * Chrome retains focus-visible when a click lands on an already keyboard-focused control.
 * Blur that control first so the pointer press focuses it without the keyboard ring.
 */
function releaseKeyboardRing(event: PointerEvent<HTMLElement>) {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.contains(event.target as Node) && focused.matches(":focus-visible")) focused.blur();
}

/** The header's height (styles.css, --top): on the home, the header slides in once that much less than a window has scrolled by. */
const HEADER_PX = 64;

/**
 * On the home, whether the entrance, the first window of the page, is still on the screen: the header
 * stays out of view until it has gone (styles.css, .site[data-entrance]). Nowhere else.
 */
function useEntranceInView(home: boolean, site: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(home);
  useEffect(() => {
    if (!home) {
      setInView(false);
      return;
    }
    const read = () => setInView(window.scrollY < window.innerHeight - HEADER_PX * pageScale(site.current));
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [home, site]);
  return home && inView;
}

/**
 * The header marks the destination as soon as navigation starts. A screen reader hears "Loading".
 * The footer stays on the 64 px module (ui/module-snap.ts).
 */
function FrameLayout({ busy, children }: { busy: boolean; children: ReactNode }) {
  const site = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, search } = useLocation();
  const home = pathname === "/";
  const entrance = useEntranceInView(home, site);
  useEffect(() => setMenuOpen(false), [pathname, search]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(".frame-header")) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);
  // The home keeps its own rhythm, its panel reaching the footer; everywhere else the footer sits on the module.
  useEffect(() => (site.current && !home ? keepFooterOnModule(site.current, ".site-footer") : undefined), [home]);
  return (
    <div className="site" ref={site} data-unscaled={keepsPageScaleOne(pathname) || undefined} data-home={home || undefined} data-entrance={entrance || undefined}>
      <header className="frame-header" data-busy={busy || undefined} onPointerDown={releaseKeyboardRing}>
        <NavLink to="/" className="wordmark">
          {SITE_WORDS.frame.wordmark}
        </NavLink>
        <button ref={menuButton} type="button" className="button frame-menu"
          aria-expanded={menuOpen} aria-controls="site-navigation" onClick={() => setMenuOpen((open) => !open)}>
          {NAVIGATION_WORDS.menu}
        </button>
        <nav id="site-navigation" className="frame-nav" aria-label={NAVIGATION_WORDS.name}
          data-open={menuOpen || undefined} onClick={event => {
            const link = event.target instanceof Element && event.target.closest("a");
            if (link && link.href === window.location.href) setMenuOpen(false);
          }}>
          {/*
            Index (/index) returns to the position the visitor left (order, filters, page), or opens the first page.
            Experimental opens the image editor and its gallery. The words are site-words.ts.
          */}
          <NavLink to={explorePath()}>{SITE_WORDS.header.explore}</NavLink>
          <NavLink to="/automata">{SITE_WORDS.header.playground}</NavLink>
          <NavLink to="/train">{SITE_WORDS.header.grow}</NavLink>
          {/* Under 832 px the link shows the short form (styles.css); its name stays the full one. */}
          <NavLink to="/how" aria-label={SITE_WORDS.header.how}>
            <span className="frame-nav-full">{SITE_WORDS.header.how}</span>
            <span className="frame-nav-short">{SITE_WORDS.header.howShortForm}</span>
          </NavLink>
          {/* The experiment's one page, the Painter's, which also stands for the Painter itself (/create). Under
              832 px the link shows its short form (styles.css); its name stays the word. */}
          <NavLink to="/canvas" className={({ isPending }) => [experimentalPage(pathname) && "active", isPending && "pending"].filter(Boolean).join(" ")} aria-label={SITE_WORDS.header.experimental}>
            <span className="frame-nav-full">{SITE_WORDS.header.experimental}</span>
            <span className="frame-nav-short" aria-hidden="true">{SITE_WORDS.header.experimentalShortForm}</span>
          </NavLink>
        </nav>
        <span className="visually-hidden" aria-live="polite">
          {busy ? SITE_WORDS.frame.loading : ""}
        </span>
      </header>
      {children}
    </div>
  );
}
