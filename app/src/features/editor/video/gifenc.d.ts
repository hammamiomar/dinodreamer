// gifenc 1.0.3 ships no types; this is the part of its API the GIF clip uses.

declare module "gifenc" {
  export type Palette = number[][];

  export interface GIFEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, options?: { palette?: Palette; delay?: number; transparent?: boolean; repeat?: number }): void;
    finish(): void;
    /** The GIF so far; gifenc allocates it on a plain ArrayBuffer. */
    bytes(): Uint8Array<ArrayBuffer>;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GIFEncoderInstance;
  /** A palette of at most `maxColors` colours for RGBA pixels. */
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: "rgb565" | "rgb444" | "rgba4444" }): Palette;
  /** Each pixel's index into the palette. */
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: "rgb565" | "rgb444" | "rgba4444"): Uint8Array;
}
