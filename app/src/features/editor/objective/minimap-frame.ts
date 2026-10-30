// The minimap's frame: the square window of code coordinates 1 and 2 it shows. A
// request's frame fits the block's recorded codes plus the requested code. Measured
// codes do not change the frame; a code outside it sits on the border as an arrow.

export interface MinimapFrame {
  centreA: number;
  centreB: number;
  /** The width of the window in code units, the same on both axes. */
  span: number;
}

/** Fraction of the plot left empty around the fitted points. */
const MARGIN = 0.14;
/** How far inside the border an out-of-frame code's arrow sits, as a fraction of the size. */
const ARROW_INSET = 0.06;

/** Fits every point with a margin and a nonzero span; no points gives a unit window. */
export function minimapFrame(points: readonly (readonly [number, number])[]): MinimapFrame {
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (const [a, b] of points) {
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
    minB = Math.min(minB, b);
    maxB = Math.max(maxB, b);
  }
  if (points.length === 0) return { centreA: 0, centreB: 0, span: 1 };
  const span = Math.max(maxA - minA, maxB - minB, 1e-3) / (1 - 2 * MARGIN);
  return { centreA: (minA + maxA) / 2, centreB: (minB + maxB) / 2, span };
}

export interface PlotPoint {
  x: number;
  y: number;
  /** The code lies outside the frame: drawn on the border as an arrow at `angle` (radians, 0 = up, clockwise). */
  outside: boolean;
  angle: number;
}

/** Where a code's coordinates 1 and 2 fall in a plot of `size` pixels, unclamped; y grows upwards. */
function plotPosition(frame: MinimapFrame, size: number, a: number, b: number): { x: number; y: number } {
  const scale = size / frame.span;
  return { x: size / 2 + (a - frame.centreA) * scale, y: size / 2 - (b - frame.centreB) * scale };
}

/**
 * The zero axes to draw: the vertical line where coordinate 1 is 0 and the horizontal
 * line where coordinate 2 is 0, each only when that zero lies inside the frame. A
 * neighbourhood of positive codes gets no false zero cross at the border.
 */
export function zeroAxes(frame: MinimapFrame, size: number): { x?: number; y?: number } {
  const zero = plotPosition(frame, size, 0, 0);
  const inside = (value: number) => value >= 0 && value <= size;
  return { ...(inside(zero.x) ? { x: zero.x } : {}), ...(inside(zero.y) ? { y: zero.y } : {}) };
}

/** Maps a code's coordinates 1 and 2 into a plot of `size` pixels; y grows upwards. */
export function plotPoint(frame: MinimapFrame, size: number, a: number, b: number): PlotPoint {
  const { x, y } = plotPosition(frame, size, a, b);
  const inset = size * ARROW_INSET;
  const outside = x < 0 || x > size || y < 0 || y > size;
  if (!outside) return { x, y, outside, angle: 0 };
  // Along the ray from the centre toward the point, stop at the inset border.
  const dx = x - size / 2;
  const dy = y - size / 2;
  const limit = size / 2 - inset;
  const factor = limit / Math.max(Math.abs(dx), Math.abs(dy));
  return { x: size / 2 + dx * factor, y: size / 2 + dy * factor, outside, angle: Math.atan2(dx, -dy) };
}
