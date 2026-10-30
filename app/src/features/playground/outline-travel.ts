// The Playground's outline animation: when a material changes place, a 1 px ink
// outline travels between the two boxes, from a tile's picture to the stage's frame when a tile is
// chosen, and from the frame to the new tile under Yours when a material is kept. Only the line
// moves; the cells never scale. With reduced motion nothing travels.

/** The travel's time and curve: the site's --motion-move (styles.css). */
const TRAVEL_MS = 240;
const TRAVEL_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";

/** Whether a box is wholly inside the window, so a line travelling to it ends where the eye can follow. */
export function inWindow(box: DOMRect): boolean {
  return box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth;
}

export function travelOutline(from: DOMRect, to: DOMRect): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const line = document.createElement("div");
  line.className = "outline-travel";
  line.setAttribute("aria-hidden", "true");
  document.body.append(line);
  const place = (box: DOMRect) => ({ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  line.animate([place(from), place(to)], { duration: TRAVEL_MS, easing: TRAVEL_EASING, fill: "forwards" }).finished
    .catch(() => {})
    .finally(() => line.remove());
}
