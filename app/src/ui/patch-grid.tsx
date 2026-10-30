// The reader's 16 × 16 patch grid over a picture, drawn as SVG lines, not a background gradient:
// a 1 px line at every inner patch boundary. The caller's class places it and gives the lines
// their colour (the request card's source picture, the block panel's pictures).

import { GRID } from "../recipe";
import "./patch-grid.css";

/** Where the inner boundaries fall, as percentages of the side: 1/16 to 15/16. */
export function patchLines(patches = GRID): string[] {
  return Array.from({ length: patches - 1 }, (_, index) => `${(((index + 1) / patches) * 100).toFixed(4)}%`);
}

export function PatchGrid({ className }: { className: string }) {
  const lines = patchLines();
  return (
    <svg className={`patch-grid ${className}`} aria-hidden="true">
      {lines.map((at) => <line key={`x ${at}`} x1={at} x2={at} y1="0" y2="100%" />)}
      {lines.map((at) => <line key={`y ${at}`} y1={at} y2={at} x1="0" x2="100%" />)}
    </svg>
  );
}
