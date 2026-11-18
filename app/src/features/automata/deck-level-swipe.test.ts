import { afterEach, expect, test, vi } from "vitest";
import { listenForLevelSwipe } from "./deck-level-swipe";

afterEach(() => vi.unstubAllGlobals());

test("one horizontal swipe selects one level, including momentum, and a reverse swipe returns", () => {
  vi.stubGlobal("WheelEvent", { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 });
  const deck = new EventTarget();
  const select = vi.fn();
  const release = listenForLevelSwipe(deck as HTMLElement, select);
  function wheel(time: number, x: number, y = 0, ctrlKey = false, deltaMode = 0) {
    const event = Object.assign(new Event("wheel", { cancelable: true }), { deltaX: x, deltaY: y, ctrlKey, deltaMode });
    Object.defineProperty(event, "timeStamp", { value: time });
    deck.dispatchEvent(event);
    return event.defaultPrevented;
  }

  expect(wheel(0, 5, 40)).toBe(false);
  expect(wheel(10, 80, 0, true)).toBe(false);
  expect(wheel(20, 8)).toBe(true);
  expect(select).not.toHaveBeenCalled();
  for (const [time, x] of [[30, 18], [40, 80], [50, 30], [60, 7]]) wheel(time, x);
  expect(select.mock.calls).toEqual([[-1]]);
  wheel(80, -12);
  wheel(90, -14);
  expect(select.mock.calls).toEqual([[-1], [1]]);
  wheel(400, -2, 0, false, 1);
  expect(select.mock.calls).toEqual([[-1], [1], [1]]);
  release();
  expect(wheel(1000, 80)).toBe(false);
});
