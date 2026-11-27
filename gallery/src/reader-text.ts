// The body of a public page before the app starts: the site's header, one heading and one paragraph, and a line of
// links out. Search crawlers that do not render, AI agents and link checkers read only this HTML. The app's
// createRoot replaces the root's content when it starts, so a visitor sees it only until then.
//
// The markup uses the frame's own classes (app/src/app/frame.tsx, styles.css: .site, .frame-header, .wordmark,
// .frame-nav, .page-message, .site-footer), so the header stands where the app's header will be, and the paragraph
// where the app's loading line appears. A frame class that changes name only changes how this text looks.
import { SITE_WORDS, fill } from "../../app/src/app/site-words.ts";
import { escapeHtml, type TopPage } from "./link-preview.ts";
import { PROJECT_SITE_ORIGIN } from "./site-location.ts";

/** External links rendered in the fallback footer. */
const ESSAY_URL = `${PROJECT_SITE_ORIGIN}/writing/dinodreamer/`;
const CODE_URL = "https://github.com/hammamiomar/dinodreamer";
const FEATURIZER_URL = "https://huggingface.co/hammamiomar/dinov3-vitb16-bsf-grassmannian-16384-rank3-k32";

/** A link in a paragraph: [words](/path) or [words](https://...). */
const PARAGRAPH_LINK = /\[([^\]]+)\]\((\/[^)\s]*|https:\/\/[^)\s]+)\)/g;

export interface ReaderText {
  heading: string;
  /** Plain words, with [words](address) for each link. */
  paragraph: string;
}

/** Build the fallback heading and summary paragraph for a public page or basis group panel. */
export function readerText(page: TopPage | null, block: number | null): ReaderText {
  if (block !== null) {
    return {
      heading: fill(SITE_WORDS.preview.blockHeading, { block }),
      paragraph: `${fill(SITE_WORDS.preview.blockDescriptionNoMaterial, { block })} ${SITE_WORDS.pageSummaries.home.paragraph}`,
    };
  }
  const { heading, paragraph } = SITE_WORDS.pageSummaries[page ?? "home"];
  return { heading, paragraph };
}

/** Render a summary paragraph as escaped HTML with [label](url) links. */
export function paragraphHtml(paragraph: string): string {
  let html = "";
  let from = 0;
  for (const match of paragraph.matchAll(PARAGRAPH_LINK)) {
    html += escapeHtml(paragraph.slice(from, match.index));
    html += `<a href="${escapeHtml(match[2]!)}">${escapeHtml(match[1]!)}</a>`;
    from = match.index + match[0].length;
  }
  return html + escapeHtml(paragraph.slice(from));
}

/** Render the fallback site header using the same navigation order as app/src/app/frame.tsx. */
function headerHtml(): string {
  const header = SITE_WORDS.header;
  const links = [
    `<a href="/index">${escapeHtml(header.explore)}</a>`,
    `<a href="/automata">${escapeHtml(header.playground)}</a>`,
    `<a href="/train">${escapeHtml(header.grow)}</a>`,
    `<a href="/picture">${escapeHtml(header.picture)}</a>`,
    `<a href="/how">${escapeHtml(header.how)}</a>`,
    `<a href="${ESSAY_URL}">${escapeHtml(header.essay)}</a>`,
    `<a href="/canvas" aria-label="${escapeHtml(header.experimental)}"><span class="frame-nav-full">${escapeHtml(header.experimental)}</span><span class="frame-nav-short" aria-hidden="true">${escapeHtml(header.experimentalShortForm)}</span></a>`,
    `<a href="${PROJECT_SITE_ORIGIN}" class="frame-nav-site">${escapeHtml(header.site)}</a>`,
  ];
  // On a phone the frame shows a Menu button in place of the links. It is here so that the header does not change
  // when the app starts; it opens the menu only once the app runs, and the paragraph links every page meanwhile.
  const menu = `<button type="button" class="button frame-menu" aria-expanded="false" aria-controls="site-navigation">${escapeHtml(header.menu)}</button>`;
  return `<header class="frame-header"><a href="/" class="wordmark">${escapeHtml(SITE_WORDS.frame.wordmark)}</a>${menu}<nav id="site-navigation" class="frame-nav" aria-label="${escapeHtml(header.navigationName)}">${links.join("")}</nav></header>`;
}

function footerHtml(): string {
  const words = SITE_WORDS.pageSummaries.footer;
  const links = [
    `<a href="${PROJECT_SITE_ORIGIN}">${escapeHtml(words.author)}</a>`,
    `<a href="${CODE_URL}">${escapeHtml(SITE_WORDS.footer.code)}</a>`,
    `<a href="${FEATURIZER_URL}">${escapeHtml(SITE_WORDS.footer.featurizer)}</a>`,
  ];
  return `<footer class="site-footer">${links.join("")}</footer>`;
}

/**
 * The root's content. On the home the app keeps its header out of view while the entrance is on the screen
 * (frame.tsx, data-entrance), so the reader text does the same.
 */
export function readerBody(text: ReaderText, home: boolean): string {
  const site = home ? `<div class="site" data-home="true" data-entrance="true">` : `<div class="site">`;
  const main = `<main class="page page-message"><h1>${escapeHtml(text.heading)}</h1><p>${paragraphHtml(text.paragraph)}</p></main>`;
  return `${site}${headerHtml()}${main}${footerHtml()}</div>`;
}

/** Inject fallback reader markup into the empty #root element of index.html. */
export function withReaderText(html: string, text: ReaderText, home: boolean): string {
  return html.replace('<div id="root"></div>', `<div id="root">${readerBody(text, home)}</div>`);
}
