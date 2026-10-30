// The terminal commands' thumbnail encoder: sharp applies the rule of thumbnail.ts. Node only;
// the Worker uses imagesThumbnail instead.

import sharp from "sharp";
import { THUMBNAIL_PIXELS, THUMBNAIL_QUALITY, type MakeThumbnail } from "./thumbnail.ts";

export const sharpThumbnail: MakeThumbnail = async (png) => {
  const scaled = sharp(png).resize({ width: THUMBNAIL_PIXELS, height: THUMBNAIL_PIXELS, fit: "inside", withoutEnlargement: true });
  return new Uint8Array(await scaled.webp({ quality: THUMBNAIL_QUALITY }).toBuffer());
};
