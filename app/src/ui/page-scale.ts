// The page scale (styles.css, --page-scale). On a window 2240 px wide or wider the site is drawn at
// 1.25, by CSS zoom on .site. The layout inside is the one a 1792 px window gets; the 64 px module is
// 80 screen pixels and a 4 px cell 5, so edges and cells stay whole screen pixels.
//
// Element rectangles (getBoundingClientRect) and pointer positions (clientX, clientY) are in screen CSS
// pixels. Lengths the page sets (margins, positions in style, a canvas's drawing units) are page pixels,
// smaller by the scale. Divide a screen length by pageScale(element) to get the page length.

/** The zoom that applies to `element` (its own and its ancestors'), 1 when there is none or the browser cannot say. */
export function pageScale(element: Element | null): number {
  const zoom = element ? (element as Element & { currentCSSZoom?: number }).currentCSSZoom : undefined;
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** The pointer's place from the top-left corner of `element`, in that element's page pixels. */
export function pagePointer(event: { clientX: number; clientY: number }, element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  const scale = pageScale(element);
  return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
}

/** Device pixels per page pixel for a canvas inside the page: the screen's pixel ratio, at most `limit`, times the page scale. */
export function canvasPixelRatio(element: Element | null, limit = Number.POSITIVE_INFINITY): number {
  return Math.min(window.devicePixelRatio || 1, limit) * pageScale(element);
}
