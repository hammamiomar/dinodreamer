// The Painter landing page at /canvas links to the editor and shows the gallery
// and creations saved in this browser.

import { Link } from "react-router";
import { YourCanvases } from "../saved/your-canvases";
import { CANVAS_TEXT } from "./canvas-text";
import { GallerySection } from "../gallery/gallery-page";
import "./landing.css";

export function CanvasPage() {
  return (
    <main className="landing">
      <section className="landing-introduction">
        <h1 className="label">{CANVAS_TEXT.label}</h1>
        <p className="landing-claim">{CANVAS_TEXT.claim}</p>
        <div className="landing-words">
          {CANVAS_TEXT.paragraphs.map((paragraph, at) => <p key={at}>{withReference(paragraph)}</p>)}
        </div>
        <p className="landing-actions">
          <Link className="button primary" to="/create">{CANVAS_TEXT.open}</Link>
        </p>
      </section>
      <div className="landing-section">
        <GallerySection />
      </div>
      <div className="landing-section">
        <YourCanvases />
      </div>
    </main>
  );
}

/** The paragraph, with the method's name linked to its paper where the words appear. */
function withReference(paragraph: string) {
  const { words, url } = CANVAS_TEXT.reference;
  const at = paragraph.indexOf(words);
  if (at < 0) return paragraph;
  return (
    <>
      {paragraph.slice(0, at)}
      <a className="landing-reference" href={url} target="_blank" rel="noreferrer">{words}</a>
      {paragraph.slice(at + words.length)}
    </>
  );
}
