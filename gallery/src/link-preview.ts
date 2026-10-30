// One branded image and video for shared site links. Tags are served in HTML because link
// readers do not run JavaScript. Preview media is fixed on the public CDN, independent of gallery selection.
import { SITE_WORDS, fill } from "../../app/src/app/site-words.ts";

export const SITE_PREVIEW = {
  image: "/previews/site/dinodreamer-hibiscus-v1.jpg",
  video: "/previews/site/dinodreamer-hibiscus-v1.mp4",
  width: 1280,
  height: 640,
} as const;

export interface LinkPreview {
  title: string;
  description: string;
  url: string;
  media: { image: string; video: string; width: number; height: number };
}

/** Legacy material recordings remain addressable and are included when that material is purged. */
export function previewKeys(materialId: string): { image: string; video: string } {
  return { image: `previews/${materialId}/poster.png`, video: `previews/${materialId}/preview.mp4` };
}

const escapeAttribute = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Keep the shared page's identity; its media never depends on a gallery selection or bucket lookup. */
export function routePreview(block: number | null, pageUrl: string, mediaOrigin: string): LinkPreview {
  const words = SITE_WORDS.preview;
  return {
    title: block === null ? words.title : fill(words.blockTitle, { block }),
    description: block === null ? words.homeDescription : fill(words.blockDescriptionNoMaterial, { block }),
    url: pageUrl,
    media: {
      image: new URL(SITE_PREVIEW.image, mediaOrigin).href,
      video: new URL(SITE_PREVIEW.video, mediaOrigin).href,
      width: SITE_PREVIEW.width,
      height: SITE_PREVIEW.height,
    },
  };
}

/** Direct downloadable MP4 and matching poster, with explicit non-square dimensions. */
export function previewTags(preview: LinkPreview): string {
  const { media } = preview;
  const property: [string, string][] = [
    ["og:site_name", "Dinodreamer"],
    ["og:type", "website"],
    ["og:title", preview.title],
    ["og:description", preview.description],
    ["og:url", preview.url],
    ["og:image", media.image],
    ["og:image:secure_url", media.image],
    ["og:image:type", "image/jpeg"],
    ["og:image:width", String(media.width)],
    ["og:image:height", String(media.height)],
    ["og:video", media.video],
    ["og:video:secure_url", media.video],
    ["og:video:type", "video/mp4"],
    ["og:video:width", String(media.width)],
    ["og:video:height", String(media.height)],
  ];
  // Twitter's large-image card uses the poster. Messages also understands the direct stream tag.
  const name: [string, string][] = [
    ["twitter:card", "summary_large_image"],
    ["twitter:title", preview.title],
    ["twitter:description", preview.description],
    ["twitter:image", media.image],
    ["twitter:player:stream", media.video],
    ["twitter:player:stream:content_type", "video/mp4"],
  ];
  return [
    ...property.map(([key, value]) => `<meta property="${key}" content="${escapeAttribute(value)}" />`),
    ...name.map(([key, value]) => `<meta name="${key}" content="${escapeAttribute(value)}" />`),
  ].join("\n    ");
}

/** Set the title and append metadata without changing the application document or its scripts. */
export function withPreviewTags(html: string, preview: LinkPreview): string {
  const titled = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttribute(preview.title)}</title>`);
  const at = titled.indexOf("</head>");
  if (at < 0) return html;
  return `${titled.slice(0, at)}  ${previewTags(preview)}\n  ${titled.slice(at)}`;
}
