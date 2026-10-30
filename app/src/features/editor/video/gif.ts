// The GIF clip, where the browser has no H.264 encoder: the same stills at 256 px,
// one palette per frame, through gifenc (MIT). Loaded only when a
// clip is saved on such a browser.

import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { CLIP, type ClipEncoder } from "./clip";

/** Colours per frame: the GIF maximum. */
const PALETTE_SIZE = 256;

export const gifEncoder: ClipEncoder = {
  extension: "gif",
  async encode(plan, decode) {
    const size = CLIP.gifSize;
    const frameMs = 1000 / CLIP.fps;
    const gif = GIFEncoder();
    for (const { still, repeat } of plan) {
      const rgba = await decode(still, size);
      const palette = quantize(rgba, PALETTE_SIZE);
      const index = applyPalette(rgba, palette);
      // A held still is one GIF frame with the whole hold as its delay.
      gif.writeFrame(index, size, size, { palette, delay: Math.round(frameMs * repeat) });
    }
    gif.finish();
    return new Blob([gif.bytes()], { type: "image/gif" });
  },
};
