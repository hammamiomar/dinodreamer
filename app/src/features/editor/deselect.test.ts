import { describe, expect, it } from "vitest";
import { TAP_TOLERANCE_PX, isTap, pressAfterMove, tapKeepsSelection, type TapTarget, type Touch } from "./deselect";
import type { Selection } from "./state";

/** Empty space: no control, no dialog, no card, not the canvas (the background, a gutter, text). */
const EMPTY: TapTarget = { control: false, dialog: false, card: null, canvas: false };

const codeOf7: Selection = { kind: "term", requestId: 7, term: "respond" };
const lookOf7: Selection = { kind: "term", requestId: 7, term: "look" };
const protect: Selection = { kind: "protect" };
const noise: Selection = { kind: "noise" };
const held: Selection = { kind: "held" };
const every = [codeOf7, lookOf7, protect, noise, held];

describe("the deselect rule: what a tap keeps", () => {
  it("empty space deselects every kind of selection", () => {
    for (const selection of every) expect(tapKeepsSelection(EMPTY, selection, true), selection.kind).toBe(false);
  });

  it("a control keeps it, anywhere: in another card, on the canvas, or alone", () => {
    for (const selection of every) {
      expect(tapKeepsSelection({ ...EMPTY, control: true }, selection, false)).toBe(true);
      expect(tapKeepsSelection({ ...EMPTY, control: true, card: { kind: "request", requestId: 9 } }, selection, false)).toBe(true);
    }
  });

  it("an open dialog or popover keeps it, the backdrop included", () => {
    for (const selection of every) expect(tapKeepsSelection({ ...EMPTY, dialog: true }, selection, false)).toBe(true);
  });

  it("the selected request's own card keeps it, its empty space included; another request's card does not", () => {
    const own = { ...EMPTY, card: { kind: "request", requestId: 7 } } satisfies TapTarget;
    const other = { ...EMPTY, card: { kind: "request", requestId: 9 } } satisfies TapTarget;
    expect(tapKeepsSelection(own, codeOf7, true)).toBe(true);
    expect(tapKeepsSelection(own, lookOf7, true)).toBe(true);
    expect(tapKeepsSelection(other, codeOf7, true)).toBe(false);
    expect(tapKeepsSelection(own, protect, true)).toBe(false);
    expect(tapKeepsSelection(own, held, true)).toBe(false);
  });

  it("the image group keeps Protect and Noise, and the held card keeps the held token, nothing else", () => {
    const image = { ...EMPTY, card: { kind: "image" } } satisfies TapTarget;
    const heldCard = { ...EMPTY, card: { kind: "held" } } satisfies TapTarget;
    expect(tapKeepsSelection(image, protect, true)).toBe(true);
    expect(tapKeepsSelection(image, noise, true)).toBe(true);
    expect(tapKeepsSelection(image, codeOf7, true)).toBe(false);
    expect(tapKeepsSelection(heldCard, held, true)).toBe(true);
    expect(tapKeepsSelection(heldCard, lookOf7, true)).toBe(false);
  });

  it("the dock's brush strip keeps whatever is selected", () => {
    for (const selection of every) expect(tapKeepsSelection({ ...EMPTY, card: { kind: "brush" } }, selection, true)).toBe(true);
  });

  it("the canvas keeps a selection that paints there (a dab), and not one that does not", () => {
    const canvas = { ...EMPTY, canvas: true };
    for (const selection of every) expect(tapKeepsSelection(canvas, selection, true)).toBe(true);
    // The Code term of a token without a painted area (a CLS or storage token) does not paint.
    expect(tapKeepsSelection(canvas, codeOf7, false)).toBe(false);
  });
});

describe("a tap", () => {
  /** The element pressed, and another; any two distinct objects stand for them. */
  const button = { name: "pressed" };
  const other = { name: "moved under the finger" };
  const press = { x: 100, y: 200, target: button };
  const click = (x: number, y: number, target: unknown = button) => ({ x, y, target });

  it("is a click within the tolerance of its press, on the element pressed", () => {
    expect(isTap(press, click(100, 200))).toBe(true);
    expect(isTap(press, click(100 + TAP_TOLERANCE_PX, 200))).toBe(true);
    expect(isTap(press, click(104, 204))).toBe(true);
  });

  it("is not a drag: a click further than the tolerance from its press", () => {
    expect(isTap(press, click(100 + TAP_TOLERANCE_PX + 1, 200))).toBe(false);
    expect(isTap(press, click(100, 260))).toBe(false);
  });

  it("is not a click without a press: a keyboard's or a script's", () => {
    expect(isTap(null, click(100, 200))).toBe(false);
  });

  it("is not a click on another element than the one pressed: the page moved under the finger", () => {
    // A tap that places a held token; its card scrolled the page, and the click went to the title.
    expect(isTap(press, click(100, 200, other))).toBe(false);
  });

  it("is not a drag that comes back: once the pointer leaves the tolerance, the press is gone", () => {
    // A press at (2, 2), a drag to (62, 2) and back, a release at (2, 2).
    const start = { x: 2, y: 2, target: button };
    let held: Touch | null = start;
    for (const x of [12, 32, 62, 32, 12, 2]) held = pressAfterMove(held, { x, y: 2 });
    expect(held).toBeNull();
    expect(isTap(held, start)).toBe(false);
  });

  it("keeps the press while the pointer stays inside the tolerance", () => {
    let held: Touch | null = press;
    for (const point of [{ x: 103, y: 200 }, { x: 100 + TAP_TOLERANCE_PX, y: 200 }, { x: 101, y: 201 }]) held = pressAfterMove(held, point);
    expect(held).toBe(press);
    expect(isTap(held, click(101, 201))).toBe(true);
  });
});
