// The automaton diagrams read row-major grids with 16 channels per cell. The filters match
// replay/figure-reference.ts; the simulation itself lives in the replay package.

import { CHANNELS, HIDDEN, PERCEPTIONS } from "../../replay/figure-reference";

export { CHANNELS, HIDDEN, PERCEPTIONS };
/** The coarse rule's two matrices in its 7,776 values: W1 [96 × 64], its bias [96], W2 [16 × 96]. */
export const W1_VALUES = HIDDEN * PERCEPTIONS;
export const BIAS_OFFSET = W1_VALUES;
export const W2_OFFSET = W1_VALUES + HIDDEN;

/**
 * The four fixed filters of the perception, as the reference applies them on the torus (rows top to
 * bottom, columns left to right), with their divisors: identity, Sobel x / 8, Sobel y / 8 and the
 * nine-point Laplacian / 16.
 */
export const PERCEPTION_FILTERS: readonly { name: "identity" | "sobelX" | "sobelY" | "laplacian"; kernel: readonly number[]; divisor: number }[] = [
  { name: "identity", kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0], divisor: 1 },
  { name: "sobelX", kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1], divisor: 8 },
  { name: "sobelY", kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1], divisor: 8 },
  { name: "laplacian", kernel: [1, 2, 1, 2, -12, 2, 1, 2, 1], divisor: 16 },
];

/** A cell's 3 × 3 neighbourhood on the torus, [9 × 16]: row-major neighbours, 16 channels each. */
export function neighbourhood(state: Float32Array, side: number, cell: number): Float32Array {
  const x = cell % side;
  const y = Math.floor(cell / side);
  const values = new Float32Array(9 * CHANNELS);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const neighbour = ((y + dy + side) % side) * side + ((x + dx + side) % side);
      values.set(state.subarray(neighbour * CHANNELS, (neighbour + 1) * CHANNELS), ((dy + 1) * 3 + dx + 1) * CHANNELS);
    }
  }
  return values;
}
