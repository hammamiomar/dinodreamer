/** A horizontal trackpad swipe on the open deck selects one response level. */
const SWIPE_DISTANCE_PX = 24;
const GESTURE_GAP_MS = 180;

/** Positive scroll deltas reveal a weaker level. The reverse gesture returns to a stronger one. */
export function listenForLevelSwipe(deck: HTMLElement, select: (change: -1 | 1) => void): () => void {
  let lastHorizontalAt = -Infinity;
  let selectedDirection = 0;
  let distance = 0;

  function wheel(event: WheelEvent) {
    const { deltaX, deltaY, timeStamp } = event;
    if (event.ctrlKey || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    // Keep horizontal swipes on the deck, including their momentum and gestures at the end levels.
    event.preventDefault();
    if (timeStamp - lastHorizontalAt > GESTURE_GAP_MS) {
      selectedDirection = 0;
      distance = 0;
    }
    lastHorizontalAt = timeStamp;
    const direction = Math.sign(deltaX);
    if (selectedDirection === direction) {
      distance = 0;
      return;
    }
    if (Math.sign(distance) !== direction) distance = 0;
    let pixels = deltaX;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) pixels *= 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) pixels *= deck.clientWidth;
    distance += pixels;
    if (Math.abs(distance) < SWIPE_DISTANCE_PX) return;
    selectedDirection = direction;
    distance = 0;
    select(direction > 0 ? -1 : 1);
  }

  let start: Touch | undefined;
  function touchStart(event: TouchEvent) {
    start = event.touches.length === 1 ? event.touches[0] : undefined;
  }
  function cancelTouch() { start = undefined; }
  function touchEnd(event: TouchEvent) {
    const first = start;
    cancelTouch();
    const last = event.changedTouches[0];
    if (!first || !last || last.identifier !== first.identifier || event.touches.length > 0) return;
    const dx = last.clientX - first.clientX;
    const dy = last.clientY - first.clientY;
    if (Math.abs(dx) < SWIPE_DISTANCE_PX || Math.abs(dx) <= Math.abs(dy)) return;
    // A swipe changes level. A tap can still follow the group link.
    event.preventDefault();
    select(dx < 0 ? -1 : 1);
  }
  function arrow(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    select(event.key === "ArrowRight" ? -1 : 1);
  }
  deck.addEventListener("wheel", wheel, { passive: false });
  deck.addEventListener("touchstart", touchStart, { passive: true });
  deck.addEventListener("touchend", touchEnd, { passive: false });
  deck.addEventListener("touchcancel", cancelTouch);
  deck.addEventListener("keydown", arrow);
  return () => {
    deck.removeEventListener("wheel", wheel);
    deck.removeEventListener("touchstart", touchStart);
    deck.removeEventListener("touchend", touchEnd);
    deck.removeEventListener("touchcancel", cancelTouch);
    deck.removeEventListener("keydown", arrow);
  };
}
