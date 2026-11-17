// The wall's eye: the one point every deck is drawn from (automata.css, perspective-origin). With a
// mouse it is the pointer, followed with a little lag; without one, and when the pointer is outside
// the window, it is the middle of the window. A deck under the eye is seen straight on and hides its
// plates; a deck far from it shows their edges, as a stack on a table shows its side to someone
// standing off it. Scrolling moves the wall under the eye, so the decks' sides change as they pass.
//
// A deck that takes the keyboard's focus draws the eye to itself, so it comes forward where it stands.
//
// The eye is kept in window coordinates and written on the wall as two CSS lengths in the wall's own
// page pixels (--eye-x, --eye-y). While the wall is not displayed the eye keeps following and writes
// nothing. With reduced motion the wall has no perspective and no eye.

import { useEffect, useRef, type RefObject } from "react";
import { pageScale } from "../../ui/page-scale";

/** The share of the remaining distance the eye covers each frame: it reaches the pointer in about a fifth of a second. */
const FOLLOW = 0.16;
/** Closer than this, in screen pixels, the eye is on its target and stops asking for frames. */
const SETTLED = 0.5;

export function useWallEye(wall: RefObject<HTMLElement | null>, active: boolean, displayed: boolean): void {
  const refresh = useRef<(() => void) | null>(null);
  // The wall is displayed again: its place under the eye is written before the next frame.
  useEffect(() => { if (displayed) refresh.current?.(); }, [displayed]);
  useEffect(() => {
    const element = wall.current;
    if (!element || !active) return;
    const middle = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    let target = middle();
    let eye = target;
    let followsPointer = false;
    let frame = 0;
    const write = () => {
      const box = element.getBoundingClientRect();
      if (box.width === 0) return;
      const scale = pageScale(element);
      element.style.setProperty("--eye-x", `${((eye.x - box.left) / scale).toFixed(1)}px`);
      element.style.setProperty("--eye-y", `${((eye.y - box.top) / scale).toFixed(1)}px`);
    };
    const step = () => {
      frame = 0;
      eye = { x: eye.x + (target.x - eye.x) * FOLLOW, y: eye.y + (target.y - eye.y) * FOLLOW };
      const settled = Math.hypot(target.x - eye.x, target.y - eye.y) < SETTLED;
      if (settled) eye = target;
      write();
      if (!settled) frame = requestAnimationFrame(step);
    };
    const ask = () => { if (frame === 0) frame = requestAnimationFrame(step); };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      followsPointer = true;
      target = { x: event.clientX, y: event.clientY };
      ask();
    };
    const toMiddle = () => {
      followsPointer = false;
      target = middle();
      ask();
    };
    // The wall moved under the eye, or the window changed: the eye's place on the wall is another.
    const onScroll = () => {
      if (!followsPointer) target = middle();
      ask();
    };
    const onFocus = (event: FocusEvent) => {
      const deck = (event.target as Element).closest?.(".automata-deck");
      if (!deck || !(event.target as Element).matches(":focus-visible")) return;
      const box = deck.getBoundingClientRect();
      followsPointer = true;
      target = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      ask();
    };
    refresh.current = () => { write(); ask(); };
    write();
    element.addEventListener("focusin", onFocus);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", toMiddle);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      refresh.current = null;
      element.removeEventListener("focusin", onFocus);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", toMiddle);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      element.style.removeProperty("--eye-x");
      element.style.removeProperty("--eye-y");
    };
  }, [wall, active]);
}
