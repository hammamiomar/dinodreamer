// The footer at the end of every page that does not fit the window (frame.tsx): one 32 px line
// with the author's site, the source code and the featurizer. How it works and the image editor
// are in the header; the encoder is credited on How it works and in the README; the site says
// where the visitor's work stays where it is kept and published. Its words are site-words.ts.

import { SITE_WORDS } from "./site-words";

/** The author's site, of which this app is one part; the header links it too (frame.tsx). */
export const SITE_URL = "https://computervision.vision";
/** The source code of the site, the engine and the Worker. */
const CODE_URL = "https://github.com/hammamiomar/dinodreamer";
/** The block sparse featurizer as trained, published with its loader and card (Apache-2.0). */
const FEATURIZER_URL = "https://huggingface.co/hammamiomar/dinov3-vitb16-bsf-grassmannian-16384-rank3-k32";

const WORDS = SITE_WORDS.footer;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <a href={SITE_URL} target="_blank" rel="noreferrer" title={WORDS.siteTitle}>
        {WORDS.site}
      </a>
      <a href={CODE_URL} target="_blank" rel="noreferrer" title={WORDS.codeTitle}>
        {WORDS.code}
      </a>
      <a href={FEATURIZER_URL} target="_blank" rel="noreferrer" title={WORDS.featurizerTitle}>
        {WORDS.featurizer}
      </a>
    </footer>
  );
}
