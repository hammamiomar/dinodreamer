// The 64 px module: every major edge sits on a multiple of 64
// in page pixels. Text makes a block as tall as its lines add up to, so every edge below it drifts
// off the module. keepOnModule puts chosen elements back on it: in document order, each one gets
// the margin above it that moves its top down to the next multiple of 64, measured after the ones
// above it have moved. It runs again, one animation frame later, whenever the container changes
// size (fonts, pictures, a narrower window).

import { MODULE_PX } from "../ground/lattice";
import { pageScale } from "./page-scale";

/**
 * Where a footer of `height` starts on a page shorter than the window (`viewport` high): the last
 * multiple of `module` that keeps the whole footer in the window, or 0 when none does.
 */
export function lastModuleTop(viewport: number, height: number, module = MODULE_PX): number {
  return Math.max(0, Math.floor((viewport - height) / module) * module);
}

/** The space that moves an edge at `top` down to the next multiple of `module`; 0 within half a pixel of one. */
export function toModule(top: number, module = MODULE_PX): number {
  const past = ((top % module) + module) % module;
  return past < 0.5 || module - past < 0.5 ? 0 : module - past;
}

/**
 * Keep the tops of the elements matching `selector` inside `container` on the module, until the
 * returned function is called; it also gives the elements back their own margins. `gridOf` names
 * a finer grid for some of them (16 for a box inside a section), in the same pass, so a section
 * and the boxes inside it are placed in document order and never undo each other. `scroller`, when
 * given, is the scroll container the edges are measured in (its top on the module), not the page.
 */
export function keepOnModule(container: HTMLElement, selector: string, gridOf: (element: HTMLElement) => number = () => MODULE_PX,
  scroller: HTMLElement | null = null): () => void {
  // Each moved element's own inline margin-top, given back before every pass.
  const own = new Map<HTMLElement, string>();
  let frame = 0;
  const restoreMargins = () => {
    for (const [element, margin] of own) element.style.marginTop = margin;
    own.clear();
  };
  const pass = () => {
    frame = 0;
    restoreMargins();
    // Rectangles are screen pixels; the module and the margins are page pixels (ui/page-scale.ts).
    const scale = pageScale(container);
    // In a scroll container (the basis group panel) the edges are measured from its top, which sits on the module.
    const origin = scroller ? scroller.getBoundingClientRect().top - scroller.scrollTop * scale : -window.scrollY;
    for (const element of container.querySelectorAll<HTMLElement>(selector)) {
      const extra = toModule((element.getBoundingClientRect().top - origin) / scale, gridOf(element));
      if (extra === 0) continue;
      const margin = parseFloat(getComputedStyle(element).marginTop) || 0;
      own.set(element, element.style.marginTop);
      element.style.marginTop = `${margin + extra}px`;
    }
  };
  // A pass changes the container's size, so it runs outside the observer's callback, a frame later.
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(pass);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(container);
  void document.fonts?.ready.then(schedule);
  schedule();
  return () => {
    observer.disconnect();
    if (frame !== 0) cancelAnimationFrame(frame);
    restoreMargins();
  };
}

/**
 * Keep the top of the footer matching `selector` inside `site` on the module. On a page taller
 * than the window the footer follows the page and moves down to the next multiple of 64. On a
 * page shorter than the window, where the site's minimum height (100 %) holds the footer at the
 * window's foot, the minimum height drops instead, so the footer rises to the last multiple of 64
 * that keeps it whole in the window: a margin there would only shrink the page above it.
 */
export function keepFooterOnModule(site: HTMLElement, selector: string): () => void {
  let frame = 0;
  let marked: HTMLElement | null = null;
  const restoreFooterStyles = () => {
    site.style.minHeight = "";
    if (marked) marked.style.marginTop = "";
    marked = null;
  };
  const pass = () => {
    frame = 0;
    restoreFooterStyles();
    const footer = site.querySelector<HTMLElement>(selector);
    if (!footer) return;
    // In page pixels: the screen's lengths divided by the page scale (ui/page-scale.ts).
    const scale = pageScale(site);
    const viewport = document.documentElement.clientHeight / scale;
    const screenBox = footer.getBoundingClientRect();
    const box = { top: screenBox.top / scale, height: screenBox.height / scale };
    const top = box.top + window.scrollY / scale;
    const short = site.getBoundingClientRect().height / scale <= viewport + 0.5 && top + box.height >= viewport - 0.5;
    if (short) {
      const siteTop = (site.getBoundingClientRect().top + window.scrollY) / scale;
      site.style.minHeight = `${lastModuleTop(viewport, box.height) + box.height - siteTop}px`;
      return;
    }
    const extra = toModule(top);
    if (extra === 0) return;
    marked = footer;
    footer.style.marginTop = `${extra}px`;
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(pass);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(site);
  window.addEventListener("resize", schedule);
  void document.fonts?.ready.then(schedule);
  schedule();
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    if (frame !== 0) cancelAnimationFrame(frame);
    restoreFooterStyles();
  };
}
