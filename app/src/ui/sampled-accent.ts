// The sampled accent. The language has no fixed accent: the
// one coloured line on a page is the colour of the living material it belongs to, read again every
// few hundred ticks and set as --sampled on the element that holds it. The frame's line and the
// ring's mark use it (material-frame.css, ring.css).
//
// The rule takes the material's vivid part, not its average: a mean colour is grey by construction,
// since a material's colours cancel (two measured materials gave chroma 0.001 and 0.019). The
// picture is read as 16 × 16 cells; the line's hue is the cells' hue weighted by their chroma, its
// chroma the cells' 75th percentile, held inside sRGB, its lightness fixed. A material whose
// cells are nearly all grey gets a grey line, --ink-2, which is what it is.
//
// A player reads the picture back from the GPU (FigureReplay.readPixels), not from its canvas:
// Chrome gives an on-page WebGPU canvas back as transparent to drawImage once its frame is
// presented, and the replay's frame callback runs after that.

/** How often a player reads its picture again, in ticks: about every 3.3 s at the default 1x. */
export const SAMPLE_EVERY_TICKS = 200;
/** The picture is read as this many cells along a side: the reader's 16 × 16 patch grid. */
export const SAMPLE_CELLS = 16;
/** The line's OKLab lightness: readable on black, the same for every material. */
const LINE_LIGHTNESS = 0.72;
/** The cells' chroma at this fraction of their sorted list is the line's chroma. */
const CHROMA_PERCENTILE = 0.75;
/** Under this chroma a material is grey. */
const GREY_CHROMA = 0.02;
/** The line of a grey material. */
export const GREY_LINE = "var(--ink-2)";

/** Each sRGB byte in linear light: a table, since a picture of 256 × 256 has 196,608 bytes to convert. */
const LINEAR = Float64Array.from({ length: 256 }, (_, byte) => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});

/** Linear sRGB to OKLab [L, a, b] (Björn Ottosson's matrices, as CSS Color 4 uses them). */
function oklab(red: number, green: number, blue: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to linear sRGB, the inverse of oklab(). */
function linearSrgb(lightness: number, a: number, b: number): [number, number, number] {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** The largest OKLCH chroma that stays inside sRGB at this lightness and hue, by bisection. */
export function srgbChromaLimit(lightness: number, hueRad: number): number {
  const inside = (chroma: number) =>
    linearSrgb(lightness, chroma * Math.cos(hueRad), chroma * Math.sin(hueRad)).every((channel) => channel >= -1e-6 && channel <= 1 + 1e-6);
  let low = 0;
  let high = 0.4;
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2;
    if (inside(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * The picture's 16 × 16 cells in OKLab: each cell the mean of its pixels in linear light. `side`
 * is the picture's width and height in pixels (FigureReplay.pictureSide).
 */
export function cellColours(pixels_N4: Uint8ClampedArray, side: number): Float64Array {
  const sums_C3 = new Float64Array(SAMPLE_CELLS * SAMPLE_CELLS * 3);
  const counts_C = new Float64Array(SAMPLE_CELLS * SAMPLE_CELLS);
  for (let y = 0; y < side; y++) {
    const row = Math.floor((y * SAMPLE_CELLS) / side) * SAMPLE_CELLS;
    for (let x = 0; x < side; x++) {
      const cell = row + Math.floor((x * SAMPLE_CELLS) / side);
      const pixel = 4 * (y * side + x);
      sums_C3[3 * cell] += LINEAR[pixels_N4[pixel]];
      sums_C3[3 * cell + 1] += LINEAR[pixels_N4[pixel + 1]];
      sums_C3[3 * cell + 2] += LINEAR[pixels_N4[pixel + 2]];
      counts_C[cell] += 1;
    }
  }
  const cells_C3 = new Float64Array(sums_C3.length);
  for (let cell = 0; cell < counts_C.length; cell++) {
    const count = Math.max(1, counts_C[cell]);
    cells_C3.set(oklab(sums_C3[3 * cell] / count, sums_C3[3 * cell + 1] / count, sums_C3[3 * cell + 2] / count), 3 * cell);
  }
  return cells_C3;
}

/** The value at `fraction` of an ascending list, interpolated between its neighbours. */
function percentile(sorted: Float64Array, fraction: number): number {
  const at = fraction * (sorted.length - 1);
  const below = Math.floor(at);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
}

/**
 * The line for a picture (RGBA bytes, `side` × `side` pixels). Hue: the chroma-weighted circular
 * mean of the cells' hues, which is the angle of the sum of their (a, b) vectors. Chroma: the
 * 75th percentile of the cells' chroma, held inside sRGB at the line's lightness and hue.
 * Lightness: 0.72. Under chroma 0.02 the material is grey and the line is --ink-2.
 */
export function sampledAccent(pixels_N4: Uint8ClampedArray, side: number): string {
  const cells_C3 = cellColours(pixels_N4, side);
  const chromas_C = new Float64Array(cells_C3.length / 3);
  let sumA = 0;
  let sumB = 0;
  for (let cell = 0; cell < chromas_C.length; cell++) {
    const a = cells_C3[3 * cell + 1];
    const b = cells_C3[3 * cell + 2];
    chromas_C[cell] = Math.hypot(a, b);
    sumA += a;
    sumB += b;
  }
  const hueRad = Math.atan2(sumB, sumA);
  const chroma = Math.min(percentile(chromas_C.sort(), CHROMA_PERCENTILE), srgbChromaLimit(LINE_LIGHTNESS, hueRad));
  if (chroma < GREY_CHROMA) return GREY_LINE;
  const hueDeg = ((hueRad * 180) / Math.PI + 360) % 360;
  // Rounded down, so the written chroma never leaves sRGB.
  return `oklch(${(LINE_LIGHTNESS * 100).toFixed(1)}% ${(Math.floor(chroma * 1000) / 1000).toFixed(3)} ${hueDeg.toFixed(1)})`;
}
