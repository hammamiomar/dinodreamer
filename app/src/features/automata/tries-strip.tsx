// The tries of the cell on the stage (gallery.ts): every automaton that shares its start and its
// method, in one strip, one row high, whatever their number. The one that plays is marked. The strip
// is one stop for the Tab key; the left and right arrow keys step through it, Home and End reach its
// ends. It keeps its height with one try or seventy, so choosing a cell moves nothing on the page.

import { useEffect, useRef, type KeyboardEvent } from "react";
import { fill, SITE_WORDS } from "../../app/site-words";
import { pageScale } from "../../ui/page-scale";
import { tryAfter, type GalleryAutomaton, type GalleryCell } from "./gallery";

const WORDS = SITE_WORDS.automata;
/** The room a try keeps from the strip's edge when the strip scrolls to it, in page pixels. */
const STRIP_MARGIN = 8;

export function TriesStrip<T extends GalleryAutomaton>({ cell, playing, position, onChoose }: {
  cell: GalleryCell<T>;
  playing: T;
  position: number;
  onChoose: (automaton: T) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const count = cell.tries.length;

  // The playing try stays in the strip's view, also when a key or the address chose it. Only the
  // strip scrolls, and only sideways: the page keeps its place.
  useEffect(() => {
    const element = strip.current;
    const pressed = element?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!element || !pressed) return;
    const scale = pageScale(element);
    const box = element.getBoundingClientRect();
    const item = pressed.getBoundingClientRect();
    if (item.left < box.left) element.scrollLeft -= (box.left - item.left) / scale + STRIP_MARGIN;
    else if (item.right > box.right) element.scrollLeft += (item.right - box.right) / scale + STRIP_MARGIN;
  }, [playing.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, Home: -count, End: count }[event.key];
    if (steps === undefined) return;
    event.preventDefault();
    const next = tryAfter(cell, playing.id, steps);
    if (next.id === playing.id) return;
    onChoose(next);
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>(`[data-automaton="${CSS.escape(next.id)}"]`)?.focus());
  };

  return (
    <section className="automata-tries" aria-label={WORDS.triesTitle}>
      <p className="automata-tries-line">
        <span className="label">{WORDS.triesTitle}</span>
        <span className="automata-tries-place">{fill(WORDS.triesPlace, { at: position, count })}</span>
        <span className="automata-tries-words">{count === 1 ? WORDS.triesOne : WORDS.triesMany}</span>
      </p>
      <div ref={strip} className="automata-tries-strip" role="toolbar" aria-orientation="horizontal" onKeyDown={onKeyDown}>
        {cell.tries.map((automaton, index) => (
          <button key={automaton.id} type="button" className="automata-try" aria-pressed={automaton.id === playing.id}
            tabIndex={automaton.id === playing.id ? 0 : -1} data-automaton={automaton.id} data-hidden={!automaton.shown || undefined}
            aria-label={fill(WORDS.tryName, { at: index + 1, count })} onClick={() => onChoose(automaton)}>
            <img src={automaton.pictureUrl} alt="" width={128} height={128} loading="lazy" />
          </button>
        ))}
      </div>
    </section>
  );
}
