import { SIDE } from "./figure-recipe";
import { START_RADIUS, type MaterialKind } from "./material-kind";

// Preview still shown before training starts. Matches the engine's initial noise or
// centre-disc distribution with a fixed local PRNG seed so the preview is deterministic.

const COARSE_SIDE = SIDE / 2;

/**
 * 1 for the cells whose centres lie within `radius` of the grid centre, else 0, row-major: the
 * engine's `centre_disc`. On the fine grid with START_RADIUS it keeps 812 cells, rows and columns 48–79.
 */
export function centreDisc(side: number, radius: number): Uint8Array {
  const offset = (index: number) => index - side / 2 + 0.5;
  return Uint8Array.from({ length: side * side }, (_, cell) => {
    const dx = offset(cell % side);
    const dy = offset(Math.floor(cell / side));
    return dx * dx + dy * dy <= radius * radius ? 1 : 0;
  });
}

/** A small seeded generator (a linear congruential step), so the still is the same on every visit. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

/** The still of a kind's start: 128 × 128 RGBA bytes. */
export function startStill(kind: MaterialKind, seed = 20261023): Uint8ClampedArray<ArrayBuffer> {
  const random = generator(seed);
  const seeded = kind.start === "centre-disc";
  const fineMask = seeded ? centreDisc(SIDE, START_RADIUS) : null;
  const coarseMask = seeded ? centreDisc(COARSE_SIDE, START_RADIUS / 2) : null;
  const colour = (count: number, mask: Uint8Array | null) =>
    Float32Array.from({ length: count * 3 }, (_, value) => (mask && !mask[Math.floor(value / 3)] ? 0 : random()));
  const fine_N3 = colour(SIDE * SIDE, fineMask);
  const coarse_N3 = kind.rule === "pyramid" ? colour(COARSE_SIDE * COARSE_SIDE, coarseMask) : null;
  const pixels_N4 = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let cell = 0; cell < SIDE * SIDE; cell++) {
    // A coarse cell covers 2 × 2 fine cells (nearest, for the still).
    const coarseCell = Math.floor(Math.floor(cell / SIDE) / 2) * COARSE_SIDE + Math.floor((cell % SIDE) / 2);
    for (let channel = 0; channel < 3; channel++) {
      const value = fine_N3[cell * 3 + channel] + (coarse_N3 ? coarse_N3[coarseCell * 3 + channel] : 0);
      // A zero state shows as 0.5, byte 128.
      pixels_N4[cell * 4 + channel] = Math.round(Math.min(1, Math.max(0, value + 0.5)) * 255);
    }
    pixels_N4[cell * 4 + 3] = 255;
  }
  return pixels_N4;
}
