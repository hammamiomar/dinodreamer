// Stills on a canvas: a frame's 256 × 256 RGBA pixels become a WebP blob for the
// recording, and a still comes back as RGBA at the clip's size with the stage's
// smoothing. Both need the browser's canvas, so the rules in recording.ts and clip.ts
// take them as functions.

import { IMAGE_SIZE } from "../canvas/draw";
import type { Still } from "../run/recording";

/** WebP quality of a still: about 20 to 40 KB at 256 px. */
const STILL_QUALITY = 0.8;

/** A frame's pixels as a 256 px WebP. */
export async function encodeStill(pixels: Uint8ClampedArray): Promise<Blob> {
  const canvas = new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The recording needs a 2-D canvas.");
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), IMAGE_SIZE, IMAGE_SIZE), 0, 0);
  return canvas.convertToBlob({ type: "image/webp", quality: STILL_QUALITY });
}

/** A still drawn at `size` pixels square, scaled smoothly as the stage draws the image, as RGBA. */
export async function decodeStill(still: Still, size: number): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(still.blob);
  try {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The clip needs a 2-D canvas.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size, size);
    return context.getImageData(0, 0, size, size).data;
  } finally {
    bitmap.close();
  }
}
