// The glossary section's figure: the references the work stands on, in citation order
// (app/site-words.ts, how.references). The terms themselves are in the card (../glossary-terms.tsx).
import { SITE_WORDS } from "../../../app/site-words";
import "./figures.css";

const WORDS = SITE_WORDS.how;

export function ReferencesFigure() {
  return (
    <section className="how-references" aria-labelledby="how-references-heading">
      <h3 id="how-references-heading" className="label">{WORDS.referencesHeading}</h3>
      {/* role="list": a list without markers keeps its list semantics in every screen reader. */}
      <ol role="list">
        {WORDS.references.map((reference) => (
          <li key={reference.key}>
            <a href={reference.url} target="_blank" rel="noreferrer">{reference.text}</a>
          </li>
        ))}
      </ol>
    </section>
  );
}
