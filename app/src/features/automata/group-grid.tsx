// A basis group's grid (gallery.ts): a row for each state an automaton starts from, a column for each
// thing its training asked for, and in a cell one picture, however many automata share the place. The
// cell that holds the automaton on the stage is marked and shows that automaton. A phone's grid is
// turned: the methods run down the page and the starts across it, so a picture keeps a useful size.
// The automata are one stop for the Tab key; the arrow keys move from cell to cell and play each one.
// An empty place that Train offers is a link to Train with its start and method (trainPathOfPlace), a
// Tab stop of its own; any other empty place shows a dash.

import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { GalleryMethod, GalleryPlace, GalleryStart } from "../gallery/gallery-place";
import { samePlace } from "../gallery/gallery-place";
import { ExplainButton, ExplanationReveal, useExplanation } from "../../ui/explain";
import { cellAt, cellBeside, methodBands, pictureOfCell, trainPathOfPlace, type GalleryAutomaton, type GalleryCell, type GalleryGroup } from "./gallery";

const WORDS = SITE_WORDS.automata;
const ARROWS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const;

/**
 * What one cell of the table shows: its automata when it holds any, and whether the stage plays one of
 * them; else the way to train one there, or a dash where Train does not offer the place.
 */
function Cell<T extends GalleryAutomaton>({ group, place, cell, playing, onChoose, caption }: {
  group: number;
  place: GalleryPlace;
  cell: GalleryCell<T> | null;
  playing: T;
  onChoose: (automaton: T) => void;
  /** What the cell says under its picture: by default its number of tries, when it holds more than one. */
  caption?: (cell: GalleryCell<T>) => string;
}) {
  const names = { start: WORDS.starts[place.start], method: WORDS.methods[place.method] };
  if (cell === null) {
    const train = trainPathOfPlace(group, place);
    if (train !== null) {
      return (
        <Link className="automata-cell automata-cell-empty automata-cell-train" to={train} aria-label={fill(WORDS.cellTrain, names)}>
          {WORDS.cellTrainMark}
        </Link>
      );
    }
    return (
      <span className="automata-cell automata-cell-empty" role="img" aria-label={fill(WORDS.cellEmpty, names)}>
        <span aria-hidden="true">{WORDS.cellEmptyMark}</span>
      </span>
    );
  }
  const here = samePlace(playing.place, place);
  const shown = here ? playing : pictureOfCell(cell);
  const count = cell.tries.length;
  return (
    <button type="button" className="automata-cell" aria-pressed={here} tabIndex={here ? 0 : -1}
      data-start={place.start} data-method={place.method} data-hidden={!shown.shown || undefined}
      aria-label={fill(WORDS.cellName, { ...names, count: count === 1 ? WORDS.cardCountOne : fill(WORDS.cellTries, { count }) })}
      onClick={() => onChoose(shown)}>
      <img src={shown.pictureUrl} alt="" width={128} height={128} loading="lazy" />
      <span className="automata-cell-count">{caption ? caption(cell) : count > 1 ? fill(WORDS.cellTries, { count }) : ""}</span>
    </button>
  );
}

export function GroupGrid<T extends GalleryAutomaton>({ group, playing, turned, onChoose, cellCaption }: {
  group: GalleryGroup<T>;
  /** The automaton on the stage; its cell is marked. */
  playing: T;
  /** A phone's grid: the methods down the page, the starts across it. */
  turned: boolean;
  onChoose: (automaton: T) => void;
  cellCaption?: (cell: GalleryCell<T>) => string;
}) {
  const table = useRef<HTMLTableElement>(null);
  const explanation = useExplanation();
  const bands = methodBands(group.methods);

  // An arrow key plays the next cell that holds an automaton in its direction and takes the focus there.
  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (!(event.key in ARROWS) || !(event.target instanceof HTMLButtonElement)) return;
    event.preventDefault();
    const pressed = ARROWS[event.key as keyof typeof ARROWS];
    // On a turned grid the rows are the methods, so the keys follow what the eye sees.
    const direction = turned ? ({ left: "up", right: "down", up: "left", down: "right" } as const)[pressed] : pressed;
    const next = cellBeside(group, playing.place, direction);
    if (samePlace(next.place, playing.place)) return;
    onChoose(pictureOfCell(next));
    const selector = `button[data-start="${next.place.start}"][data-method="${next.place.method}"]`;
    requestAnimationFrame(() => table.current?.querySelector<HTMLButtonElement>(selector)?.focus());
  };

  const cell = (start: GalleryStart, method: GalleryMethod) => (
    <td key={`${start}/${method}`}>
      <Cell group={group.group} place={{ start, method }} cell={cellAt(group, { start, method })} playing={playing} onChoose={onChoose} caption={cellCaption} />
    </td>
  );
  // The columns' title stands over the columns; the rows' title is the table's corner, over the rows' names.
  const titles = (
    <p className="automata-grid-titles">
      <span className="label">{turned ? WORDS.startsTitle : WORDS.methodsTitle}</span>
      <ExplainButton explanation={explanation} subject={WORDS.gridExplainSubject} />
    </p>
  );
  const explained = (
    <ExplanationReveal explanation={explanation}>
      {WORDS.gridExplanation.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    </ExplanationReveal>
  );

  if (turned) {
    return (
      <div className="automata-grid" data-turned>
        {titles}
        {explained}
        <table ref={table} aria-label={fill(WORDS.gridName, { group: group.group })} onKeyDown={onKeyDown}
          style={{ "--columns": group.starts.length, "--rows": group.methods.length } as CSSProperties}>
          <colgroup>
            {group.starts.map((start) => <col key={start} className="automata-grid-column" />)}
          </colgroup>
          <thead>
            <tr>
              {group.starts.map((start) => <th key={start} scope="col">{WORDS.starts[start]}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="automata-grid-rows-title">
              <th colSpan={group.starts.length}><span className="label">{WORDS.methodsTitle}</span></th>
            </tr>
          </tbody>
          {bands.map((band) => (
            <tbody key={band.space}>
              {band.methods.map((method) => [
                <tr key={`${method}/name`} className="automata-grid-row-name">
                  <th scope="row" colSpan={group.starts.length}>
                    <span className="label">{WORDS.methodSpaces[band.space]}</span> {WORDS.methodColumns[method]}
                  </th>
                </tr>,
                <tr key={method}>{group.starts.map((start) => cell(start, method))}</tr>,
              ])}
            </tbody>
          ))}
        </table>
      </div>
    );
  }
  return (
    <div className="automata-grid">
      {titles}
      {explained}
      <table ref={table} aria-label={fill(WORDS.gridName, { group: group.group })} onKeyDown={onKeyDown}
        style={{ "--columns": group.methods.length, "--rows": group.starts.length } as CSSProperties}>
        <colgroup>
          <col className="automata-grid-label" />
          {group.methods.map((method) => <col key={method} className="automata-grid-column" />)}
        </colgroup>
        <thead>
          <tr>
            <td rowSpan={2} className="automata-grid-corner"><span className="label">{WORDS.startsTitle}</span></td>
            {bands.map((band) => (
              <th key={band.space} scope="colgroup" colSpan={band.methods.length} className="automata-grid-band">
                <span>{WORDS.methodSpaces[band.space]}</span>
              </th>
            ))}
          </tr>
          <tr>
            {group.methods.map((method) => <th key={method} scope="col">{WORDS.methodColumns[method]}</th>)}
          </tr>
        </thead>
        <tbody>
          {group.starts.map((start) => (
            <tr key={start}>
              <th scope="row">{WORDS.starts[start]}</th>
              {group.methods.map((method) => cell(start, method))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
