// Pixel and coordinate helpers for the automaton diagrams; replay/figure-reference.ts defines the simulation.
import { pyramidPictureBytes, upsampleTorus } from "../../replay/figure-reference";
import type { AutomatonGrid } from "./automaton-record";
import { CHANNELS, PERCEPTION_FILTERS } from "./nca-math";

/** Convert a grid's first three channels plus 0.5, clamped to [0, 1], into RGBA bytes. */
export function gridPixels(grid: AutomatonGrid): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(new ArrayBuffer(grid.side * grid.side * 4));
  for (let cell = 0; cell < grid.side * grid.side; cell++) {
    for (let channel = 0; channel < 3; channel++) {
      pixels[cell * 4 + channel] = Math.round(255 * Math.min(1, Math.max(0, grid.state[cell * CHANNELS + channel]! + 0.5)));
    }
    pixels[cell * 4 + 3] = 255;
  }
  return pixels;
}

/** Upsample the coarse grid on the torus to the fine grid's `side` and convert to RGBA bytes. */
export function stretchedCoarsePixels(coarse: AutomatonGrid, side: number): Uint8ClampedArray<ArrayBuffer> {
  if (coarse.side * 2 !== side) throw new Error("The coarse grid has half the fine grid's side.");
  const pixels = new Uint8ClampedArray(new ArrayBuffer(side * side * 4));
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      for (let channel = 0; channel < 3; channel++) {
        pixels[(y * side + x) * 4 + channel] = Math.round(255 * Math.min(1, Math.max(0, upsampleTorus(coarse.state, coarse.side, x, y, channel) + 0.5)));
      }
      pixels[(y * side + x) * 4 + 3] = 255;
    }
  }
  return pixels;
}

/** Combined coarse + fine RGBA image using the replay's pyramid composition. */
export function imagePixels(fine: AutomatonGrid, coarse: AutomatonGrid): Uint8ClampedArray<ArrayBuffer> {
  return Uint8ClampedArray.from(pyramidPictureBytes(fine.state, coarse.state, fine.side));
}

/** Center cell index inside a `side x side` grid corresponding to a patch on the 16 x 16 grid. */
export function automatonCellAtPatch(patch: number, side: number): number {
  const cellsPerPatch = side / 16;
  return (Math.floor(patch / 16) * cellsPerPatch + Math.floor(cellsPerPatch / 2)) * side
    + (patch % 16) * cellsPerPatch + Math.floor(cellsPerPatch / 2);
}

/**
 * Convolve the grid's three color channels with each perception detector on the torus.
 * Identity returns the grid image; derivative detectors are normalized symmetrically around mid-grey.
 */
export function detectorPictures(grid: AutomatonGrid): Uint8ClampedArray<ArrayBuffer>[] {
  const { state, side } = grid;
  const at = (x: number, y: number, channel: number) => state[(((y + side) % side) * side + ((x + side) % side)) * CHANNELS + channel]!;
  return PERCEPTION_FILTERS.map((filter) => {
    if (filter.name === "identity") return gridPixels(grid);
    const responses = new Float32Array(side * side * 3);
    let largest = 1e-6;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        for (let channel = 0; channel < 3; channel++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += filter.kernel[(dy + 1) * 3 + (dx + 1)]! * at(x + dx, y + dy, channel);
          const response = sum / filter.divisor;
          responses[(y * side + x) * 3 + channel] = response;
          largest = Math.max(largest, Math.abs(response));
        }
      }
    }
    const pixels = new Uint8ClampedArray(side * side * 4);
    for (let cell = 0; cell < side * side; cell++) {
      for (let channel = 0; channel < 3; channel++) pixels[cell * 4 + channel] = Math.round(255 * (0.5 + 0.5 * responses[cell * 3 + channel]! / largest));
      pixels[cell * 4 + 3] = 255;
    }
    return pixels;
  });
}
