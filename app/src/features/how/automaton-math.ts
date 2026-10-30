// Arithmetic for the automaton diagrams; replay/figure-reference.ts defines the simulation.
import { pyramidPictureBytes, upsampleTorus } from "../../replay/figure-reference";
import type { AutomatonGrid } from "./automaton-record";
import { BIAS_OFFSET, CHANNELS, HIDDEN, PERCEPTION_FILTERS, PERCEPTIONS, W2_OFFSET } from "./nca-math";

/** A grid's colours as pixels: its first three channels plus 0.5, clamped, one pixel a cell. */
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

/** The coarse grid's colours stretched to the fine grid's `side`, as the fine cells read it (the replay's upsample on the torus), plus 0.5. */
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

/** The image a coarse + fine automaton shows: the stretched coarse grid added to the fine one, by the replay's own formula. */
export function imagePixels(fine: AutomatonGrid, coarse: AutomatonGrid): Uint8ClampedArray<ArrayBuffer> {
  return Uint8ClampedArray.from(pyramidPictureBytes(fine.state, coarse.state, fine.side));
}

export function moveAutomatonCell(cell: number, side: number, key: string): number {
  if (key === "Home") return 0;
  if (key === "End") return side * side - 1;
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -side, ArrowDown: side }[key] ?? 0;
  return Math.max(0, Math.min(side * side - 1, cell + offset));
}

/** Mean over views of each view's squared response distance, divided by the fixed median squared. */
export function automatonTargetLoss(meanResponses: readonly (readonly number[])[], target: readonly number[], medianNorm: number): number {
  if (!meanResponses.length || !(medianNorm > 0)) throw new Error("The target loss requires views and a positive median response magnitude.");
  let distance = 0;
  for (const response of meanResponses) {
    for (let coordinate = 0; coordinate < 3; coordinate++) distance += (response[coordinate]! - target[coordinate]!) ** 2;
  }
  return distance / meanResponses.length / (medianNorm * medianNorm);
}

/** The coarse rule stores W1 [96,64], b [96], and W2 [16,96]. */
export function automatonParameter(index: number): { matrix: string; coordinate: string } {
  if (index < BIAS_OFFSET) return { matrix: "W1", coordinate: `${Math.floor(index / PERCEPTIONS) + 1}, ${index % PERCEPTIONS + 1}` };
  if (index < W2_OFFSET) return { matrix: "b", coordinate: String(index - BIAS_OFFSET + 1) };
  const output = index - W2_OFFSET;
  return { matrix: "W2", coordinate: `${Math.floor(output / HIDDEN) + 1}, ${output % HIDDEN + 1}` };
}

export function largestAbsoluteCoordinate(values: ArrayLike<number>): number {
  let largest = 0;
  for (let index = 1; index < values.length; index++) if (Math.abs(values[index]!) > Math.abs(values[largest]!)) largest = index;
  return largest;
}

/** The comparison has 16 × 16 patches; its 256-pixel resize preserves the 128-cell locations. */
export function automatonCellAtPatch(patch: number, side: number): number {
  const cellsPerPatch = side / 16;
  return (Math.floor(patch / 16) * cellsPerPatch + Math.floor(cellsPerPatch / 2)) * side
    + (patch % 16) * cellsPerPatch + Math.floor(cellsPerPatch / 2);
}

export function automatonPatchAtCell(cell: number, side: number): number {
  const cellsPerPatch = side / 16;
  return Math.floor(Math.floor(cell / side) / cellsPerPatch) * 16 + Math.floor((cell % side) / cellsPerPatch);
}

/**
 * The grid through each of the four detectors (nca-math.ts, PERCEPTION_FILTERS), as RGBA pictures
 * of its three colour channels: the value is the grid itself; each change detector's picture
 * is its response on the torus, divided by the filter's divisor, then stretched so the largest
 * magnitude in the picture is full white or full black about mid-grey. The rule applies the
 * same four detectors to all 16 channels; the pictures show the three a reader can see.
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
