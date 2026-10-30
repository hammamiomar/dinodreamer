import type { ImageAddresses } from "../../reader/protocol";
import type { CloudToken } from "./cloud-token";
import { GRID, PATCH_SLOT_OFFSET } from "../../recipe";

export interface PictureBlock {
  block: number;
  tokens: CloudToken[];
  meanNorm: number;
}

export interface PictureReadout {
  dictionaryId: string;
  /** Descending winning-patch count, then mean norm, then block ID. */
  blocks: PictureBlock[];
  byBlock: Map<number, PictureBlock>;
}

/** Decode the reader result once and reuse it across block pages. No library metadata reads. */
export function pictureReadout(addresses: ImageAddresses): PictureReadout {
  const winners = 32;
  const entries = GRID * GRID * winners;
  if (addresses.grid !== GRID || addresses.blocks.length !== entries || addresses.norms.length !== entries || addresses.codes.length !== entries * 3) {
    throw new Error("The image analyzer did not return complete selected responses for the picture.");
  }
  const byBlock = new Map<number, PictureBlock>();
  for (let cell = 0; cell < GRID * GRID; cell++) {
    const seen = new Set<number>();
    for (let rank = 0; rank < winners; rank++) {
      const index = cell * winners + rank;
      const block = addresses.blocks[index];
      const norm = addresses.norms[index];
      const code: [number, number, number] = [addresses.codes[index * 3], addresses.codes[index * 3 + 1], addresses.codes[index * 3 + 2]];
      if (block >= 16384 || seen.has(block) || !Number.isFinite(norm) || norm < 0 || code.some((value) => !Number.isFinite(value))) {
        throw new Error("The image analyzer returned invalid selected responses for a patch.");
      }
      seen.add(block);
      let entry = byBlock.get(block);
      if (!entry) {
        entry = { block, tokens: [], meanNorm: 0 };
        byBlock.set(block, entry);
      }
      entry.tokens.push({ source: "upload", code, norm, slot: cell + PATCH_SLOT_OFFSET });
      entry.meanNorm += norm;
    }
  }
  for (const entry of byBlock.values()) entry.meanNorm /= entry.tokens.length;
  const blocks = [...byBlock.values()].sort((a, b) => b.tokens.length - a.tokens.length || b.meanNorm - a.meanNorm || a.block - b.block);
  return { dictionaryId: addresses.dictionaryId, blocks, byBlock };
}

export interface PreparedPicture {
  name: string;
  pixels: Uint8ClampedArray;
  preview: Blob;
}

/** The same centre crop is displayed and read, with transparent pixels on white. */
export function centreSquare(width: number, height: number): { x: number; y: number; side: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("The picture has no readable size.");
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

export async function preparePicture(file: File): Promise<PreparedPicture> {
  const bitmap = await createImageBitmap(file);
  try {
    const crop = centreSquare(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not prepare this picture.");
    context.fillStyle = "white";
    context.fillRect(0, 0, 256, 256);
    context.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, 256, 256);
    const pixels = context.getImageData(0, 0, 256, 256).data;
    const preview = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The picture preview could not be made.")), "image/png"));
    return { name: file.name, pixels, preview };
  } finally {
    bitmap.close();
  }
}
