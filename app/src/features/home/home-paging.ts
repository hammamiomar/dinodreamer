// The document remains the scroll owner. A gesture chooses one destination before travel starts;
// no native momentum or after-scroll correction competes with the bounded animation.
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { easeOutCubic, HomeWheelGesture, pageTarget, pageTops, type SectionPlace } from "./home-scroll";

const PAGE_MS = 640;
const TOUCH_THRESHOLD = 12;
const READING_MARGIN = 16;
const WHEEL_LINE_PX = 16;
const OPEN_OVERLAY = ".frame-nav[data-open], .block-panel, dialog[open]";
const INPUT_CONTROL = "input, textarea, select, [contenteditable]";

/** Document coordinates, including enough space below the last line to read it. */
export function measureSections(elements: readonly (HTMLElement | null)[]): SectionPlace[] {
  return elements.flatMap(element => {
    if (!element) return [];
    const box = element.getBoundingClientRect();
    const words = element.querySelector(".home-beat-words");
    // The entrance's grid can place the status note before controls despite its DOM order.
    const contentBottom = Math.max(box.top, ...[...(words ?? element).children].map(child => child.getBoundingClientRect().bottom));
    return [{
      top: box.top + window.scrollY,
      height: box.height,
      contentBottom: contentBottom + window.scrollY + (words ? READING_MARGIN : 0),
    }];
  });
}

function acceptsPaging(target: EventTarget | null): boolean {
  return !document.querySelector(OPEN_OVERLAY)
    && !(target instanceof Element && target.closest(INPUT_CONTROL));
}

export function useHomePaging(sections: RefObject<(HTMLElement | null)[]>, panelShare: number, reducedMotion: boolean): (direction: -1 | 1) => void {
  const turnRef = useRef<(direction: -1 | 1) => void>(() => {});
  useEffect(() => {
    let frame = 0;
    let moving = false;
    let touch: { x: number; y: number; consumed: boolean } | null = null;
    const wheel = new HomeWheelGesture();
    const cancelTravel = () => {
      cancelAnimationFrame(frame);
      moving = false;
    };
    const turn = (direction: -1 | 1) => {
      if (moving) return;
      const height = window.innerHeight;
      const stops = pageTops(
        measureSections(sections.current ?? []),
        document.documentElement.scrollHeight - height,
        panelShare * height,
        height,
      );
      const from = window.scrollY;
      const target = pageTarget(stops, from, direction);
      if (target === from) return;
      if (reducedMotion) {
        window.scrollTo({ top: target, behavior: "instant" });
        return;
      }
      moving = true;
      const started = performance.now();
      const step = (now: number) => {
        const progress = (now - started) / PAGE_MS;
        window.scrollTo({ top: from + (target - from) * easeOutCubic(progress), behavior: "instant" });
        if (progress < 1) frame = requestAnimationFrame(step);
        else moving = false;
      };
      frame = requestAnimationFrame(step);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        cancelTravel();
        return;
      }
      if (!acceptsPaging(event.target) || event.deltaY === 0) return;
      // Even a one-pixel tail must be consumed, or it can move the document past its destination.
      event.preventDefault();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      let distance = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) distance *= WHEEL_LINE_PX;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) distance *= window.innerHeight;
      const direction = wheel.direction(distance, performance.now());
      if (direction) turn(direction);
    };
    const onTouchStart = (event: TouchEvent) => {
      touch = null;
      if (event.touches.length !== 1) {
        cancelTravel();
        return;
      }
      if (!acceptsPaging(event.target)) return;
      // The live automaton's canvas owns its drawing gesture.
      if (event.target instanceof Element && event.target.closest(".home-field[data-brush] canvas")) return;
      const first = event.touches[0]!;
      touch = { x: first.clientX, y: first.clientY, consumed: false };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touch) return;
      if (event.touches.length !== 1) {
        touch = null;
        cancelTravel();
        return;
      }
      const first = event.touches[0]!;
      const x = first.clientX - touch.x;
      const y = first.clientY - touch.y;
      if (!touch.consumed && Math.abs(x) > Math.abs(y)) return;
      if (event.cancelable) event.preventDefault();
      if (touch.consumed || Math.abs(y) < TOUCH_THRESHOLD) return;
      touch.consumed = true;
      turn(y < 0 ? 1 : -1);
    };
    const onTouchEnd = () => { touch = null; };
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !acceptsPaging(event.target)) return;
      if (event.target instanceof Element && event.target.closest("a, button, input, textarea, select, [contenteditable]")) return;
      const forward = event.key === "ArrowDown" || event.key === "PageDown" || (event.key === " " && !event.shiftKey);
      const back = event.key === "ArrowUp" || event.key === "PageUp" || (event.key === " " && event.shiftKey);
      if (!forward && !back) return;
      event.preventDefault();
      if (!event.repeat) turn(forward ? 1 : -1);
    };
    turnRef.current = turn;
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    window.addEventListener("keydown", onKey);
    // A resize or scrollbar drag supersedes the animation; it never schedules a corrective snap.
    window.addEventListener("resize", cancelTravel);
    window.addEventListener("pointerdown", cancelTravel);
    return () => {
      turnRef.current = () => {};
      cancelTravel();
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", cancelTravel);
      window.removeEventListener("pointerdown", cancelTravel);
    };
  }, [sections, panelShare, reducedMotion]);
  return useCallback((direction: -1 | 1) => turnRef.current(direction), []);
}
