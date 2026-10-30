// How it works: a card of words and a stage with the model map and the section's figure. Desktop
// keeps both in one screen; mobile places both in the browser document. Continue, the act
// tabs, the steps, the map's stages and the arrow keys move it, and the address's hash carries
// it (how-navigation.ts), so Back returns and a link lands on a section. The words are in
// app/site-words.ts under `how`; the figures in figures/; the map in how-map.tsx.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { HowFigure } from "./figures/how-figure";
import { GlossaryTerms } from "./glossary-terms";
import { HowFactsReporter, useHowFactsState } from "./how-facts";
import { HowMap } from "./how-map";
import { Select } from "../../ui/select";
import { useMediaMatch } from "../../ui/media-match";
import { HowMobileLayout } from "./how-mobile-layout";
import { firstSectionOfAct, hashForSection, keyboardMoves, nextSection, previousSection, sectionIndexFromHash, sectionIndexOf, sectionsOfAct } from "./how-navigation";
import { HOW_ACTS, HOW_SECTIONS, litBy, STAGE_SECTION, type HowStage } from "./how-sections";
import "./how.css";

const WORDS = SITE_WORDS.how;
type SectionWords = (typeof WORDS.sections)[keyof typeof WORDS.sections];
/** Where a citation's key leads: the reference's page for readers, else the reference itself. */
const CITATION_LINKS = new Map<string, string>(WORDS.references.map((reference) => [reference.key, ("link" in reference && reference.link) || reference.url]));
const MARKUP = /\[([^\]]+)\]\(([a-z0-9-]+)\)|\*\*([^*]+)\*\*/g;

/**
 * A sentence with its markup rendered: "[the words](key)" is a citation, highlighted and linking to
 * the reference `key`; "**a term**" is a term the reader should hold on to, bold and underlined.
 */
export function cite(text: string): ReactNode[] {
  const pieces: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKUP)) {
    pieces.push(text.slice(last, match.index));
    if (match[3] !== undefined) {
      pieces.push(<strong key={match.index} className="how-term">{match[3]}</strong>);
    } else {
      const href = CITATION_LINKS.get(match[2]!);
      pieces.push(href ? <a key={match.index} className="how-cite" href={href} target="_blank" rel="noreferrer">{match[1]}</a> : match[1]);
    }
    last = match.index + match[0].length;
  }
  pieces.push(text.slice(last));
  return pieces;
}

export function HowPage() {
  const mobile = useMediaMatch("(max-width: 1023px)");
  const location = useLocation();
  const navigate = useNavigate();
  const index = sectionIndexFromHash(location.hash);
  const section = HOW_SECTIONS[index]!;
  const figure = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Only desktop has a fixed figure pane. Mobile section navigation uses document scrolling.
    if (!mobile) figure.current?.scrollTo(0, 0);
  }, [section.id, mobile]);
  const go = (next: number | null) => {
    if (next === null || next === index) return;
    void navigate({ pathname: "/how", hash: hashForSection(next) });
  };
  const goStage = (stage: HowStage) => go(sectionIndexOf(STAGE_SECTION[stage]));
  const { facts, report } = useHowFactsState();
  // On the glossary, the term under the pointer or the focus lights its section's stages on the map.
  const [termSection, setTermSection] = useState<string | null>(null);
  const termIndex = section.act === "glossary" && termSection !== null ? sectionIndexOf(termSection) : null;
  const map = litBy(section.map, termIndex === null ? null : HOW_SECTIONS[termIndex]!);

  // The arrow keys move the story, unless the reader is in a control or the basis group panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !keyboardMoves(event.target)) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        go(event.key === "ArrowRight" ? nextSection(index) : previousSection(index));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const explanation = <HowCard index={index} onGo={go} onLight={setTermSection} facts={facts} />;
  const stage = (
    <section className="how-stage" aria-label={WORDS.map.name}>
      <div className="how-stage-map">
        <HowMap state={map} litGroup={map.present.includes("basis") ? Number(facts.litGroup ?? facts.group) : null} onSelect={goStage} />
      </div>
      <div className="how-figure" key={section.act} ref={figure}>
        <HowFactsReporter value={report}>
          <HowFigure figure={section.figure} />
        </HowFactsReporter>
      </div>
    </section>
  );

  return (
    <main className="how" data-act={section.act} data-section={section.id}>
      <h1 className="visually-hidden">{WORDS.title}</h1>
      <ChapterPager index={index} onGo={go} />
      {mobile ? <HowMobileLayout stage={stage} card={explanation} /> : <>{explanation}{stage}</>}

      <Outlet />
    </main>
  );
}

/** The phone's chapter picker and step buttons share the page's section navigation. */
function ChapterPager({ index, onGo }: { index: number; onGo: (index: number | null) => void }) {
  const section = HOW_SECTIONS[index]!;
  const steps = sectionsOfAct(section.act);
  const step = steps.findIndex((entry) => entry.index === index) + 1;
  const position = { step, total: steps.length };
  const before = previousSection(index);
  const after = nextSection(index);
  return (
    <div className="how-chapter-pager">
      <div className="how-chapter-controls">
        <button type="button" aria-label={WORDS.previousStep} disabled={before === null} onClick={() => onGo(before)}>
          <span aria-hidden="true">‹</span>
        </button>
        <label className="how-chapter-select">
          <span className="visually-hidden">{fill(WORDS.stepOf, { act: WORDS.acts[section.act], ...position })}</span>
          <Select value={section.act} onChange={(event) => onGo(firstSectionOfAct(event.target.value as typeof section.act))}>
            {HOW_ACTS.map((act) => <option key={act} value={act}>{WORDS.acts[act]}</option>)}
          </Select>
          <span className="how-chapter-label" aria-hidden="true">
            <span className="how-chapter-title">{WORDS.acts[section.act]}</span>
            <span className="how-chapter-position">· {fill(WORDS.stepPosition, position)}</span>
          </span>
        </label>
        <button type="button" aria-label={WORDS.nextStep} disabled={after === null} onClick={() => onGo(after)}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}

/** The card: the act tabs, the section's words (the glossary's terms on its act), its steps within the act, Back and Continue. */
function HowCard({ index, onGo, onLight, facts }: {
  index: number;
  onGo: (index: number | null) => void;
  onLight: (sectionId: string | null) => void;
  facts: Record<string, string | number>;
}) {
  const section = HOW_SECTIONS[index]!;
  const words = WORDS.sections[section.id as keyof typeof WORDS.sections] as SectionWords;
  const steps = sectionsOfAct(section.act);
  const step = steps.findIndex((entry) => entry.index === index) + 1;
  const say = (text: string) => fill(text, facts);
  return (
    <aside className="how-card" aria-label={WORDS.cardName}>
      <ul className="how-acts">
        {HOW_ACTS.map((act) => (
          <li key={act}>
            <button type="button" aria-current={act === section.act ? "true" : undefined} onClick={() => onGo(firstSectionOfAct(act))}>{WORDS.acts[act]}</button>
          </li>
        ))}
      </ul>
      <div className="how-section-words" key={section.id}>
        <p className="label">{steps.length > 1 ? fill(WORDS.stepOf, { act: WORDS.acts[section.act], step, total: steps.length }) : WORDS.acts[section.act]}</p>
        <h2 className="heading">{words.heading}</h2>
        <p className="how-claim">{cite(say(words.claim))}</p>
        <div className="how-words">
          {words.paragraphs.map((paragraph, at) => <p key={at}>{cite(say(paragraph))}</p>)}
          {"findings" in words && <ul>{(words.findings as readonly string[]).map((finding, at) => <li key={at}>{cite(say(finding))}</li>)}</ul>}
          {section.act === "glossary" && <GlossaryTerms onLight={onLight} />}
        </div>
      </div>
      <div className="how-navigation">
        <ul className="how-steps" aria-label={WORDS.stepsName} aria-hidden={steps.length < 2 || undefined}>
          {steps.length > 1 && steps.map((entry, step) => (
            <li key={entry.section.id}>
              <button type="button" aria-current={entry.index === index ? "step" : undefined} aria-label={fill(WORDS.stepName, { step: step + 1, heading: (WORDS.sections[entry.section.id as keyof typeof WORDS.sections] as SectionWords).heading })} onClick={() => onGo(entry.index)} />
            </li>
          ))}
        </ul>
        <Moves index={index} onGo={onGo} next={words.next} />
      </div>
    </aside>
  );
}

function Moves({ index, onGo, next }: { index: number; onGo: (index: number | null) => void; next: string }): ReactNode {
  const after = nextSection(index);
  const before = previousSection(index);
  return (
    <div className="how-moves">
      <button type="button" className="how-back" disabled={before === null} onClick={() => onGo(before)}>{WORDS.back}</button>
      {after !== null && <button type="button" className="button primary" onClick={() => onGo(after)}>{next} <span aria-hidden="true">→</span></button>}
    </div>
  );
}
