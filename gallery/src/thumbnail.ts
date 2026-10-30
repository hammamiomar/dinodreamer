// The thumbnail published beside each approved image: a 256 px WebP at quality 75, the
// same encoding as the library's thumbs. The landing row and the
// Gallery page show 120 px tiles; they read this file, not the full PNG of up to 2 MB.
// Two encoders apply this one rule: sharp in the owner's terminal commands
// (thumbnail-sharp.ts, Node only) and the Images binding in the Worker's owner page
// (imagesThumbnail below). The Worker cannot run sharp.

export const THUMBNAIL_PIXELS = 256;
export const THUMBNAIL_QUALITY = 75;
export const THUMBNAIL_CONTENT_TYPE = "image/webp";

/**
 * A submitted PNG as its thumbnail: scaled to fit inside 256 × 256 with its aspect ratio
 * kept. A submitted image is 256 × 256 already, so its thumbnail has the same size; a
 * smaller image is not enlarged.
 */
export type MakeThumbnail = (png: ArrayBuffer | Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>;

/** The part of the Workers Images binding (env.IMAGES) that the thumbnail uses. */
export interface ImagesBinding {
  input(stream: ReadableStream<Uint8Array>): ImageTransformer;
}

export interface ImageTransformer {
  transform(options: { width: number; height: number; fit: "scale-down" }): ImageTransformer;
  output(options: { format: typeof THUMBNAIL_CONTENT_TYPE; quality: number }): Promise<{ response(): Response }>;
}

/**
 * The Worker's encoder: Cloudflare Images. "scale-down" fits the image inside the box and never
 * enlarges it, as sharp's fit "inside" without enlargement does.
 */
export function imagesThumbnail(images: ImagesBinding): MakeThumbnail {
  return async (png) => {
    const result = await images
      .input(new Response(png).body!)
      .transform({ width: THUMBNAIL_PIXELS, height: THUMBNAIL_PIXELS, fit: "scale-down" })
      .output({ format: THUMBNAIL_CONTENT_TYPE, quality: THUMBNAIL_QUALITY });
    return new Uint8Array(await result.response().arrayBuffer());
  };
}
