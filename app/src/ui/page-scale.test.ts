import { describe, expect, test } from "vitest";
import { pageScale, pagePointer } from "./page-scale";

/** An element as the page scale reads it: its zoom and its rectangle on the screen. */
function element(zoom: number | undefined, left = 0, top = 0): Element {
  return { currentCSSZoom: zoom, getBoundingClientRect: () => ({ left, top }) } as unknown as Element;
}

describe("the page scale", () => {
  test("is the element's effective zoom, or 1 when the browser cannot say", () => {
    expect(pageScale(element(1.25))).toBe(1.25);
    expect(pageScale(element(undefined))).toBe(1);
    expect(pageScale(element(0))).toBe(1);
    expect(pageScale(null)).toBe(1);
  });

  test("turns a pointer's screen place into the element's page pixels", () => {
    expect(pagePointer({ clientX: 350, clientY: 225 }, element(1.25, 100, 100))).toEqual({ x: 200, y: 100 });
    expect(pagePointer({ clientX: 150, clientY: 130 }, element(1, 100, 100))).toEqual({ x: 50, y: 30 });
  });
});
