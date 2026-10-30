// The frame around a material (the sheet's "frame"): the cells inside, ticks outside at every patch
// boundary, because a patch of 16 cells is what the reader reads, and a label in a corner on the
// frame's line. Nothing is ever drawn on the cells. The frame's line takes the material's sampled
// colour where a stage sets --sampled (ui/sampled-accent.ts), and the plain line elsewhere.

import type { ReactNode } from "react";
import "./material-frame.css";

export interface MaterialFrameProps {
  /** Patches along one side: 8 for a 128-cell grid (16 cells a patch). */
  patches?: number;
  /** The upper left corner: the block and the kind, "12002 · fine rule, from noise". */
  label?: ReactNode;
  /** The lower right corner: a fact about the grid, "128 × 128 cells". */
  note?: ReactNode;
  /** The cells: a canvas or a picture that fills the square. */
  children: ReactNode;
}

/** The fractions of a side where the ticks fall: every patch boundary, both ends included. */
export function tickFractions(patches: number): number[] {
  return Array.from({ length: patches + 1 }, (_, index) => index / patches);
}

/** One side's ticks: an SVG strip in the frame's room, a 1 px line at each patch boundary. */
function Ticks({ side, patches }: { side: "top" | "bottom" | "left" | "right"; patches: number }) {
  const across = side === "top" || side === "bottom";
  return (
    <svg className={`frame-ticks frame-ticks-${side}`} aria-hidden="true">
      {tickFractions(patches).map((fraction) => {
        const at = `${(fraction * 100).toFixed(4)}%`;
        return across ? <line key={fraction} x1={at} x2={at} y1="0" y2="100%" /> : <line key={fraction} y1={at} y2={at} x1="0" x2="100%" />;
      })}
    </svg>
  );
}

export function MaterialFrame({ patches = 8, label, note, children }: MaterialFrameProps) {
  return (
    <div className="frame">
      <Ticks side="top" patches={patches} />
      <Ticks side="bottom" patches={patches} />
      <Ticks side="left" patches={patches} />
      <Ticks side="right" patches={patches} />
      <div className="cells">{children}</div>
      {label && <span className="frame-corner frame-corner-top">{label}</span>}
      {note && <span className="frame-corner frame-corner-bottom">{note}</span>}
    </div>
  );
}
