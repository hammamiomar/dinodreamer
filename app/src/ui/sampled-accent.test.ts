import { describe, expect, test } from "vitest";
import { cellColours, GREY_LINE, sampledAccent, srgbChromaLimit } from "./sampled-accent";

const SIDE = 128;

/** A SIDE × SIDE picture whose pixel (x, y) has the colour `at(x, y)`. */
function picture(at: (x: number, y: number) => readonly [number, number, number]): Uint8ClampedArray {
  const pixels_N4 = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) pixels_N4.set([...at(x, y), 255], 4 * (y * SIDE + x));
  return pixels_N4;
}

/** "oklch(72.0% 0.120 29.2)" → [72, 0.12, 29.2]. */
function parts(colour: string): number[] {
  return colour.match(/[\d.]+/g)!.map(Number);
}

describe("the sampled accent", () => {
  test("a one-colour material gives its own hue at lightness 0.72, its chroma held inside sRGB", () => {
    const [lightness, chroma, hue] = parts(sampledAccent(picture(() => [200, 30, 30]), SIDE));
    expect(lightness).toBe(72);
    expect(hue).toBeGreaterThan(20);
    expect(hue).toBeLessThan(35);
    expect(chroma).toBeGreaterThan(0.1);
    expect(chroma).toBeLessThanOrEqual(srgbChromaLimit(0.72, (hue * Math.PI) / 180) + 0.001);
  });

  test("a grey material gets the grey line", () => {
    expect(sampledAccent(picture(() => [128, 128, 128]), SIDE)).toBe(GREY_LINE);
    expect(sampledAccent(picture((x, y) => ((x + y) % 2 ? [40, 40, 40] : [220, 220, 220])), SIDE)).toBe(GREY_LINE);
  });

  test("a grey material with a third of its patches green keeps the green, where a mean colour would not", () => {
    const pixels_N4 = picture((x) => (x < SIDE / 3 ? [40, 200, 60] : [128, 128, 128]));
    const [, chroma, hue] = parts(sampledAccent(pixels_N4, SIDE));
    expect(chroma).toBeGreaterThan(0.1);
    expect(hue).toBeGreaterThan(130);
    expect(hue).toBeLessThan(150);
  });

  test("the hue is weighted by chroma: red and blue patches in equal parts give a magenta", () => {
    const [, , hue] = parts(sampledAccent(picture((x) => (x < SIDE / 2 ? [255, 0, 0] : [0, 0, 255])), SIDE));
    expect(hue).toBeGreaterThan(300);
    expect(hue).toBeLessThan(340);
  });

  test("a picture is read as 16 × 16 cells, each the mean of its pixels, at any size", () => {
    for (const side of [128, 256]) {
      const pixels_N4 = new Uint8ClampedArray(side * side * 4).fill(255);
      const cells_C3 = cellColours(pixels_N4, side);
      expect(cells_C3).toHaveLength(16 * 16 * 3);
      expect(cells_C3[0]).toBeCloseTo(1, 6);
      expect(cells_C3[cells_C3.length - 3]).toBeCloseTo(1, 6);
    }
  });
});
