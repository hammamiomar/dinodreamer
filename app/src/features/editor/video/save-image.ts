// Download the stage picture as <title>-<step>.png. The stage may show a restored
// creation's stored picture before the worker loads it.

import { downloadBlob } from "../../../ui/files";
import { IMAGE_SIZE } from "../canvas/draw";
import { savedFileName } from "./clip";

export async function saveImage(pixels: Uint8ClampedArray, title: string, step: number): Promise<void> {
  const canvas = new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Saving the image needs a 2-D canvas.");
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), IMAGE_SIZE, IMAGE_SIZE), 0, 0);
  downloadBlob(await canvas.convertToBlob({ type: "image/png" }), savedFileName(title, step, "png"));
}
