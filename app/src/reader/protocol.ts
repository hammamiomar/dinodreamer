import type { ReleaseLocation } from "../synthesis/protocol";

/** Displayed 256×256 opaque RGBA. The caller owns crop/resize and sees the same image. */
export interface ReadImageCommand {
  type: "read-image";
  id: number;
  pixels: Uint8ClampedArray;
}

/** Patch order is row-major, rank order is descending norm with block-id tie breaks. */
export interface ImageAddresses {
  dictionaryId: string;
  grid: 16;
  /** [256,32], top-32 block ids. Slot in library files is patch index + 5. */
  blocks: Uint16Array;
  /** [256,32,3], calibrated native-frame codes, before division by a material gate. */
  codes: Float32Array;
  /** [256,32], Euclidean code lengths. No gain factors. */
  norms: Float32Array;
}

export type ReaderCommand =
  | { type: "load"; release: ReleaseLocation }
  | ReadImageCommand
  | { type: "dispose" };

export type ReaderEvent =
  | { type: "ready" }
  | { type: "progress"; message: string; done: number; total: number }
  | { type: "image-addresses"; id: number; addresses: ImageAddresses }
  | { type: "failed"; id?: number; message: string };
