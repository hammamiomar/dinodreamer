// The head of a public page as the Worker serves it: its title, its description, its canonical address and one
// branded image and video for shared links. Tags are served in HTML because link readers do not run JavaScript.
// Preview media is fixed on the public CDN, independent of gallery selection. The page's reader text, in its body,
// is reader-text.ts.
import { SITE_WORDS, fill } from "../../app/src/app/site-words.ts";

export const SITE_PREVIEW = {
  image: "/previews/site/dinodreamer-hibiscus-v2.jpg",
  video: "/previews/site/dinodreamer-hibiscus-v2.mp4",
  width: 1280,
  height: 640,
} as const;

/** The five top pages, each with its own title, description and reader text (site-words.ts, pageSummaries). */
export const TOP_PAGES = ["home", "index", "automata", "train", "how"] as const;
export type TopPage = (typeof TOP_PAGES)[number];

export interface LinkPreview {
  title: string;
  description: string;
  /** The shared address, query included: a shared automaton link opens that automaton. */
  url: string;
  /** The page's address for search engines: no query; a basis group's panel at /basis/<group> over any page. */
  canonical: string;
  media: { image: string; video: string; width: number; height: number };
}

/** Legacy material recordings remain addressable and are included when that material is purged. */
export function previewKeys(materialId: string): { image: string; video: string } {
  return { image: `previews/${materialId}/poster.png`, video: `previews/${materialId}/preview.mp4` };
}

export const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Map the first pathname segment to a top-level page key, or return null for secondary pages. */
export function topPageOf(segment: string): TopPage | null {
  if (segment === "") return "home";
  return (TOP_PAGES as readonly string[]).includes(segment) ? (segment as TopPage) : null;
}

/** Keep the shared page's identity; its media never depends on a gallery selection or bucket lookup. */
export function routePreview(page: TopPage | null, block: number | null, pageUrl: string, mediaOrigin: string): LinkPreview {
  const url = new URL(pageUrl);
  const media = {
    image: new URL(SITE_PREVIEW.image, mediaOrigin).href,
    video: new URL(SITE_PREVIEW.video, mediaOrigin).href,
    width: SITE_PREVIEW.width,
    height: SITE_PREVIEW.height,
  };
  if (block !== null) {
    return {
      title: fill(SITE_WORDS.preview.blockTitle, { block }),
      description: fill(SITE_WORDS.preview.blockDescriptionNoMaterial, { block }),
      url: pageUrl,
      canonical: `${url.origin}/basis/${block}`,
      media,
    };
  }
  const own = page === null ? null : SITE_WORDS.pageSummaries[page];
  return {
    // The Painter's page, Create and Picture keep the site's name and the home's sentence.
    title: own?.title ?? SITE_WORDS.preview.title,
    description: own?.description ?? SITE_WORDS.pageSummaries.home.description,
    url: pageUrl,
    // "/how/" and "/how" are one page.
    canonical: `${url.origin}${url.pathname.replace(/(.)\/$/, "$1")}`,
    media,
  };
}

/** Direct downloadable MP4 and matching poster, with explicit non-square dimensions. */
export function previewTags(preview: LinkPreview): string {
  const { media } = preview;
  const property: [string, string][] = [
    ["og:site_name", "DinoDreamer"],
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
    `<link rel="canonical" href="${escapeHtml(preview.canonical)}" />`,
    ...property.map(([key, value]) => `<meta property="${key}" content="${escapeHtml(value)}" />`),
    ...name.map(([key, value]) => `<meta name="${key}" content="${escapeHtml(value)}" />`),
  ].join("\n    ");
}

/** Rewrite <title> and meta description and insert Open Graph and Twitter tags before </head>. */
export function withPreviewTags(html: string, preview: LinkPreview): string {
  const titled = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(preview.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(preview.description)}" />`);
  const at = titled.indexOf("</head>");
  if (at < 0) return html;
  return `${titled.slice(0, at)}  ${previewTags(preview)}\n  ${titled.slice(at)}`;
}
