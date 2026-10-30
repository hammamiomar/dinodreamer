// The minimap of one Code term: coordinates 1 and 2 of the block's three code values.
// Every dot is one measured code (a painted cell's, or the canvas's own CLS or storage
// token's); the ring is the requested code. A supplied frame fits the recorded cloud
// and requested code, so measured codes cannot resize it. A code outside the frame
// is an arrow on the border. Without a
// frame the plot fits the shown points. The third coordinate is not drawn; the
// request's detail shows all three in 3-D.

import { palette } from "../presentation";
import type { Code } from "../readout/readout";
import { minimapFrame, plotPoint, zeroAxes, type MinimapFrame } from "./minimap-frame";
import { CREATE_TEXT } from "../create-text";
import "./minimap.css";

export interface MinimapProps {
  requested: Code;
  /** [P, 3] measured codes; undefined before a measurement. */
  measured?: Float32Array;
  ink: string;
  size: number;
  /** The fixed window of the plot; absent, the plot fits the shown points. */
  frame?: MinimapFrame;
}

export function Minimap({ requested, measured, ink, size, frame }: MinimapProps) {
  const cells: [number, number][] = [];
  if (measured) {
    for (let token = 0; token < measured.length / 3; token++) cells.push([measured[token * 3], measured[token * 3 + 1]]);
  }
  const window = frame ?? minimapFrame([[requested[0], requested[1]], ...cells]);
  // The zero axes, only where a zero lies inside the frame (never a false cross at the border).
  const axes = zeroAxes(window, size);
  const ring = plotPoint(window, size, requested[0], requested[1]);
  return (
    <svg className="minimap" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={CREATE_TEXT.objective.minimap}>
      {axes.x !== undefined && <line x1={axes.x} y1={0} x2={axes.x} y2={size} className="minimap-axis" />}
      {axes.y !== undefined && <line x1={0} y1={axes.y} x2={size} y2={axes.y} className="minimap-axis" />}
      {cells.map(([a, b], index) => {
        const point = plotPoint(window, size, a, b);
        return point.outside ? <EdgeArrow key={index} point={point} colour={ink} /> : <circle key={index} cx={point.x} cy={point.y} r={1.6} fill={ink} />;
      })}
      {ring.outside ? (
        <EdgeArrow point={ring} colour={palette().text} />
      ) : (
        <circle cx={ring.x} cy={ring.y} r={4} fill="none" stroke={palette().text} strokeWidth={1.2} />
      )}
    </svg>
  );
}

/** A small triangle on the border, pointing toward a code outside the frame. */
function EdgeArrow({ point, colour }: { point: { x: number; y: number; angle: number }; colour: string }) {
  const degrees = (point.angle * 180) / Math.PI;
  return <polygon points="0,-3.5 3,2.5 -3,2.5" fill={colour} transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)}) rotate(${degrees.toFixed(1)})`} />;
}
