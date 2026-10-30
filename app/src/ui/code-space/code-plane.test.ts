import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodePlane, planeLabel } from "./code-plane";
import { orbitLabel } from "./code-space-3d";
import { chainCorners, fitCodes } from "./projection";
import type { Vec3 } from "./projection";

/** A block 1836 example's five contributions (strong-0), and two cloud points. */
const VECTORS: Vec3[] = [
  [-2.378, 1.509, -2.118],
  [1.449, -0.656, 1.877],
  [7.119, -1.27, 7.726],
  [-0.04, 0.24, -0.141],
  [1.375, -0.551, -0.18],
];
const LABELS = ["itself −31 %", "its neighbours 23 %", "the surrounding area 101 %", "the whole picture −1 %", "constants 9 %"];
const POINTS = [
  { key: "a", code: [3, -1, 4] as Vec3, label: "a" },
  { key: "b", code: [-2, 1, 0] as Vec3, label: "b" },
];

function plane(lit: number | null): string {
  const fit = fitCodes([...POINTS.map((point) => point.code), ...chainCorners(VECTORS)]);
  return renderToStaticMarkup(createElement(CodePlane, { points: POINTS, arrows: { vectors: VECTORS, labels: LABELS, lit }, label: "Code space", fit }));
}

describe("the flat code space with a chain of arrows", () => {
  it("draws the five arrows from the origin, and names the long ones", () => {
    const markup = plane(null);
    expect(markup.match(/<line x1=/g)).toHaveLength(5);
    expect(markup).toContain("code-plane-origin");
    expect(markup).toContain("the surrounding area 101 %");
    // The whole picture's arrow is a fraction of a point long: it carries no name.
    expect(markup).not.toContain("the whole picture −1 %");
  });

  it("names only the lit arrow and draws the others faint", () => {
    const markup = plane(1);
    expect(markup).toContain("its neighbours 23 %");
    expect(markup).not.toContain("the surrounding area 101 %");
    expect(markup.match(/data-faint="true"/g)).toHaveLength(4);
    expect(markup.match(/data-lit="true"/g)?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("a code space with a ring to drag", () => {
  it("draws the ring at its code on the plane, takes focus and says what a drag and Space do", () => {
    const fit = fitCodes(POINTS.map((point) => point.code));
    const dragMark = { code: POINTS[0]!.code, colour: "#d578db", onDrop: () => {} };
    const markup = renderToStaticMarkup(createElement(CodePlane, { points: POINTS, dragMark, label: "Code space", fit }));
    expect(markup).toContain('class="code-plane-drag-mark"');
    expect(markup.match(/r="7" stroke-width="2"/g)).toHaveLength(1);
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("Drag the ring onto another point to move it there. Arrow keys step through the tokens and Space moves the ring to one");
  });

  it("keeps the names of a map without a ring as they were", () => {
    expect(planeLabel("Code space", [0, 1], true, false)).toBe("Code space, response vector components 1 and 2. Arrow keys step through the tokens and Enter chooses one");
    expect(planeLabel("Code space", [1, 2], false, false)).toBe("Code space, response vector components 2 and 3");
    expect(orbitLabel("Code space", true, false)).toBe(
      "Code space. Drag to turn it; Ctrl and the wheel, or a pinch, zoom. Arrow keys step through the tokens and Enter chooses one; Shift and an arrow key turn the view; plus and minus zoom, 0 resets.",
    );
    expect(orbitLabel("Code space", false, false)).toBe("Code space. Drag to turn it; Ctrl and the wheel, or a pinch, zoom. Arrow keys turn the view; plus and minus zoom, 0 resets.");
  });

  it("names the drag and both keys on a map with a ring and points to choose", () => {
    expect(orbitLabel("Code space", true, true)).toBe(
      "Code space. Drag the ring onto another point to move it there, or drag elsewhere to turn the view; Ctrl and the wheel, or a pinch, zoom. Arrow keys step through the tokens, Enter chooses one and Space moves the ring to it; Shift and an arrow key turn the view; plus and minus zoom, 0 resets.",
    );
    expect(planeLabel("Code space", [0, 2], true, true)).toBe(
      "Code space, response vector components 1 and 3. Drag the ring onto another point to move it there. Arrow keys step through the tokens, Enter chooses one and Space moves the ring to it",
    );
  });
});
