// The wall's eye: the one point every deck is drawn from (automata.css, perspective-origin), the middle
// of the window. A deck under the eye is seen straight on and hides its plates; a deck away from it shows
// their edges, as a stack on a table shows its side to someone standing off it. Scrolling moves the wall
// under the eye, so the decks' sides change gently as they pass. The eye does not follow the pointer:
// it turned every deck on the wall at each move of the mouse (Omar, 18 November 2026: "less shaky").
//
// The eye is written on the wall as two CSS lengths in the wall's own page pixels (--eye-x, --eye-y),
// once a frame at most. While the wall is not displayed it writes nothing. With reduced motion the wall
// has no perspective and no eye.

import { useEffect, useRef, type RefObject } from "react";
import { pageScale } from "../../ui/page-scale";

export function useWallEye(wall: RefObject<HTMLElement | null>, active: boolean, displayed: boolean): void {
  const refresh = useRef<(() => void) | null>(null);
  // The wall is displayed again: its place under the eye is written before the next frame.
  useEffect(() => { if (displayed) refresh.current?.(); }, [displayed]);
  useEffect(() => {
    const element = wall.current;
    if (!element || !active) return;
    let frame = 0;
    const write = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      if (box.width === 0) return;
      const scale = pageScale(element);
      element.style.setProperty("--eye-x", `${((window.innerWidth / 2 - box.left) / scale).toFixed(1)}px`);
      element.style.setProperty("--eye-y", `${((window.innerHeight / 2 - box.top) / scale).toFixed(1)}px`);
    };
    // The wall moved under the eye, or the window changed: the eye's place on the wall is another.
    const ask = () => { if (frame === 0) frame = requestAnimationFrame(write); };
    refresh.current = ask;
    write();
    window.addEventListener("scroll", ask, { passive: true });
    window.addEventListener("resize", ask);
    return () => {
      refresh.current = null;
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", ask);
      window.removeEventListener("resize", ask);
      element.style.removeProperty("--eye-x");
      element.style.removeProperty("--eye-y");
    };
  }, [wall, active]);
}
