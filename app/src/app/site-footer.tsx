// The footer at the end of every page that does not fit the window (frame.tsx): one 32 px line
// with the way to How, the credits for the encoder and the featurizer, the source code, the author's site, and the one
// promise about the visitor's work. The image editor is under Experimental in the header. Its words are site-words.ts.

import { Link } from "react-router";
import { SITE_WORDS } from "./site-words";

/** The encoder's repository, with its license (the DINOv3 License). */
const DINO_URL = "https://github.com/facebookresearch/dinov3";
/** The block sparse featurizer as trained, published with its loader and card (Apache-2.0). */
const FEATURIZER_URL = "https://huggingface.co/hammamiomar/dinov3-vitb16-bsf-grassmannian-16384-rank3-k32";
/** The source code of the site, the engine and the Worker. */
const CODE_URL = "https://github.com/hammamiomar/dinodreamer";
/** The author's personal site. */
const AUTHOR_URL = "https://hammamiomar.com";

const WORDS = SITE_WORDS.footer;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link to="/how">{WORDS.how}</Link>
      <a href={DINO_URL} target="_blank" rel="noreferrer">
        {WORDS.dino}
      </a>
      <a href={FEATURIZER_URL} target="_blank" rel="noreferrer" title={WORDS.featurizerTitle}>
        {WORDS.featurizer}
      </a>
      <a href={CODE_URL} target="_blank" rel="noreferrer" title={WORDS.codeTitle}>
        {WORDS.code}
      </a>
      <a href={AUTHOR_URL} target="_blank" rel="noreferrer">
        {WORDS.author}
      </a>
      <p>{WORDS.device}</p>
    </footer>
  );
}
