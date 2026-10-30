import { describe, expect, it } from "vitest";
import { CELLS, GRID } from "../../../recipe";
import { MOVEMENT_FULL_SCALE, frameMovement, meanMovement, movementLightness } from "./movement";

const SIDE = 256;

/** A 256 × 256 RGBA image of one grey level, alpha 255. */
function flat(level: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = level;
    pixels[offset + 1] = level;
    pixels[offset + 2] = level;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

describe("frameMovement", () => {
  it("is zero everywhere when nothing changed", () => {
    const cells = frameMovement(flat(100), flat(100))!;
    expect(cells).toHaveLength(CELLS);
    expect(Math.max(...cells)).toBe(0);
  });

  it("averages the absolute change of a cell's pixels over its pixels and the three colour channels", () => {
    const before = flat(100);
    const after = flat(100);
    // Cell (row 2, column 5) spans pixels 32..47 in y and 80..95 in x: raise its red channel by 20 in every pixel,
    // and its blue by 10 in one pixel only.
    for (let y = 32; y < 48; y++) for (let x = 80; x < 96; x++) after[(y * SIDE + x) * 4] = 120;
    after[(32 * SIDE + 80) * 4 + 2] = 90;
    const cells = frameMovement(before, after)!;
    const cell = 2 * GRID + 5;
    // (256 pixels × 20 + 10) over 256 pixels × 3 channels.
    expect(cells[cell]).toBeCloseTo((256 * 20 + 10) / (256 * 3), 6);
    expect(cells[cell - 1]).toBe(0);
    expect(cells[cell + GRID]).toBe(0);
  });

  it("ignores the alpha channel and the direction of the change", () => {
    const before = flat(100);
    const after = flat(100);
    for (let offset = 3; offset < after.length; offset += 4) after[offset] = 0;
    expect(Math.max(...frameMovement(before, after)!)).toBe(0);
    expect(frameMovement(flat(100), flat(90))![0]).toBe(10);
    expect(frameMovement(flat(90), flat(100))![0]).toBe(10);
  });

  it("has no answer for images that do not match the grid", () => {
    expect(frameMovement(new Uint8ClampedArray(4), new Uint8ClampedArray(4))).toBeUndefined();
    expect(frameMovement(flat(0), new Uint8ClampedArray(4))).toBeUndefined();
  });
});

describe("movement readouts", () => {
  it("takes the mean over cells and clips the lightness at the fixed scale", () => {
    const cells = new Float32Array(CELLS);
    cells[0] = MOVEMENT_FULL_SCALE * 2;
    cells[1] = MOVEMENT_FULL_SCALE / 2;
    expect(meanMovement(cells)).toBeCloseTo((MOVEMENT_FULL_SCALE * 2.5) / CELLS, 6);
    const lightness = movementLightness(cells);
    expect(lightness[0]).toBe(1);
    expect(lightness[1]).toBe(0.5);
    expect(lightness[2]).toBe(0);
  });
});
