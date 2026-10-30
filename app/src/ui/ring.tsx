// The strength ring (the sheet's ring.js): a block's four bands, Barely to Strongest, as thin arcs
// over 270°, and a square mark where a reading sits. Large with the number inside on Grow; small
// as a badge on a material's tile. The mark takes the material's sampled colour where a stage
// sets --sampled (ui/sampled-accent.ts), and the ink elsewhere.

import type { StrengthBand } from "../recipe";
import { STRENGTH_BANDS } from "../features/look/strength-bands";
import "./ring.css";

/** The ring is drawn in a 56-unit square: the arcs' radius, and the mark's side, by size. */
const VIEW = 56;
const CENTRE = VIEW / 2;
const SIZES = {
  large: { radius: 22, mark: 7 },
  small: { radius: 20, mark: 6 },
} as const;
/** The arcs start at the lower left (135°, clockwise from the right) and turn 270°, to the lower right. */
const START_DEG = 135;
const SPAN_DEG = 270;
/** The gap between two bands' arcs, in degrees. */
const GAP_DEG = 3;

/** The point at `angleDeg` on the circle of `radius` about the centre; y grows downwards. */
function pointAt(radius: number, angleDeg: number): [number, number] {
  const angle = (angleDeg * Math.PI) / 180;
  return [CENTRE + radius * Math.cos(angle), CENTRE + radius * Math.sin(angle)];
}

/** Each band's arc as an SVG path, Barely first: a quarter of the 270° each, a small gap between. */
export function ringArcs(radius: number): string[] {
  const quarter = SPAN_DEG / 4;
  return STRENGTH_BANDS.map((_, band) => {
    const from = START_DEG + quarter * band + (band > 0 ? GAP_DEG / 2 : 0);
    const to = START_DEG + quarter * (band + 1) - (band < 3 ? GAP_DEG / 2 : 0);
    const [x0, y0] = pointAt(radius, from);
    const [x1, y1] = pointAt(radius, to);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  });
}

/**
 * Where a reading's mark sits: `reading` 0 is the ring (the start of Barely), 1 the end of
 * Strongest (lobePosition in strength-bands.ts gives it from a norm); it is held to that span.
 * The angle turns the square with the arc, so it sits on the line.
 */
export function ringMark(reading: number, radius: number): { x: number; y: number; angleDeg: number } {
  const angleDeg = START_DEG + SPAN_DEG * Math.min(1, Math.max(0, reading));
  const [x, y] = pointAt(radius, angleDeg);
  return { x, y, angleDeg };
}

export interface RingProps {
  /** The band the reading is in: its arc is lit. */
  band?: StrengthBand;
  /** Where the reading sits, 0 to 1 along the four bands (ringMark); no mark without it. */
  reading?: number;
  /** The number inside a large ring, such as the strength "1.58". */
  text?: string;
  size?: keyof typeof SIZES;
  /** What a screen reader hears. Without it the ring is a picture of the words beside it. */
  label?: string;
}

export function Ring({ band, reading, text, size = "large", label }: RingProps) {
  const { radius, mark } = SIZES[size];
  const at = reading === undefined ? null : ringMark(reading, radius);
  return (
    <svg
      className={`ring ring-${size}`}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {ringArcs(radius).map((path, index) => (
        <path key={STRENGTH_BANDS[index]} d={path} data-band={STRENGTH_BANDS[index]} data-lit={STRENGTH_BANDS[index] === band || undefined} />
      ))}
      {at && (
        <rect
          className="ring-mark"
          x={at.x - mark / 2}
          y={at.y - mark / 2}
          width={mark}
          height={mark}
          transform={`rotate(${at.angleDeg.toFixed(1)} ${at.x.toFixed(2)} ${at.y.toFixed(2)})`}
        />
      )}
      {text && size === "large" && (
        <text x={CENTRE} y={CENTRE + 4}>
          {text}
        </text>
      )}
    </svg>
  );
}
