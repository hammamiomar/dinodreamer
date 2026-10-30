// The glossary, in the card: every term of the page defined once (app/site-words.ts,
// how.glossary). A term the story explains is a link to its section (how-sections.ts,
// TERM_SECTIONS); while the pointer or the focus rests on it, the model map lights that
// section's stages. So the glossary is also the page's index.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { hashForSection, sectionIndexOf } from "./how-navigation";
import { TERM_SECTIONS } from "./how-sections";

const WORDS = SITE_WORDS.how;
type SectionId = keyof typeof WORDS.sections;

export function GlossaryTerms({ onLight }: { onLight: (sectionId: string | null) => void }) {
  const [pointedSection, setPointedSection] = useState<string | null>(null);
  const [focusedSection, setFocusedSection] = useState<string | null>(null);
  useEffect(() => {
    // Keyboard focus takes priority; leaving one input must not clear the other.
    onLight(focusedSection ?? pointedSection);
    // The map must forget the term when a link or a navigation control closes the glossary.
    return () => onLight(null);
  }, [focusedSection, pointedSection, onLight]);

  return (
    <dl className="how-terms">
      {WORDS.glossary.map((entry) => {
        const sectionId = TERM_SECTIONS[entry.term];
        const index = sectionId === undefined ? null : sectionIndexOf(sectionId);
        return (
          <div key={entry.term} id={`term-${entry.term.replace(/\s+/g, "-")}`}>
            <dt>
              {index === null || sectionId === undefined ? entry.term : (
                <Link
                  to={{ pathname: "/how", hash: hashForSection(index) }}
                  onPointerEnter={() => setPointedSection(sectionId)}
                  onPointerLeave={() => setPointedSection(null)}
                  onFocus={() => setFocusedSection(sectionId)}
                  onBlur={() => setFocusedSection(null)}
                >
                  {entry.term}
                  <span className="visually-hidden">, {fill(WORDS.map.open, { stage: WORDS.sections[sectionId as SectionId].heading })}</span>
                </Link>
              )}
            </dt>
            <dd>{entry.definition}</dd>
          </div>
        );
      })}
    </dl>
  );
}
