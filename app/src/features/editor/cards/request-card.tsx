// A request card shows its source, Response and Appearance controls, brush and code
// space. Selection changes the lit edges and enables the brush without changing the
// card's size, so nearby controls stay put. Card clicks select the request; section
// clicks select a term. Recipe edits go through the editor reducer.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, Dispatch, ReactNode } from "react";
import { Link } from "react-router";
import { GRID, type Request, type Token } from "../../../recipe";
import { ExplainButton, ExplanationText, useExplanation } from "../../../ui/explain";
import { basisGroupPath, PANEL_OPENED } from "../../look/basis-group-panel";
import { BasisGroupLinkLabel } from "../../../ui/basis-group-link-label";
import { LockSquare } from "../canvas/lock-square";
import { hasPaintedRespondArea, lookTermId, respondTermId, tokenCell, type AreaTerm } from "../model";
import { BRUSH_HELP, TERM_TEXT, tokenLabel } from "../presentation";
import type { EditorAction } from "../state";
import type { InkPair, InkTarget } from "../inks";
import { CodeBlocks } from "./code-blocks";
import { InkPicker, InkSwatch } from "./ink-picker";
import { MadeFrom } from "./made-from";
import { LibraryImage } from "../../../ui/library-image";
import { ReferenceStrip } from "./picture-strip";
import { Stepper } from "./stepper";
import type { StepRule } from "./stepping";
import { TermSwitch } from "./term-row";
import { PatchGrid } from "../../../ui/patch-grid";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";

const WORDS = CREATE_TEXT.request;

/** The card's "?": the card's lines, then the brush's help. */
const CARD_EXPLANATION = [...WORDS.explanation, BRUSH_HELP] as const;

/** The source picture's side, in CSS pixels. */
const SOURCE_PICTURE_SIZE = 96;

/** A term weight's stepper: 0.1 a press, 1 with Shift, from 0 up; a weight has no maximum. */
const WEIGHT_STEPS: StepRule = { step: 0.1, largeStep: 1, min: 0 };

export function RequestCard({
  request,
  ink,
  look,
  selectedTerm,
  paints,
  linked,
  problems,
  brushPalette,
  codeSpace,
  previewUrl,
  dispatch,
  onEditWindow,
}: {
  request: Request;
  ink: string;
  /** The request's Appearance tone (presentation.ts lookInk). */
  look: string;
  /** The selected term of this request, if one is selected: the brush paints this card. */
  selectedTerm?: AreaTerm;
  /** The terms a stroke paints now: the selected one, or both while the lock is closed. */
  paints: { respond: boolean; look: boolean };
  /** The two areas take one stroke together (state.ts, the lock rule). */
  linked: boolean;
  /** What blocks each term, if anything ("no area painted"). */
  problems: { respond: string | null; look: string | null };
  /** The brush on one line: live on the selected card, greyed on the others. */
  brushPalette: ReactNode;
  /** The request's code space. */
  codeSpace: ReactNode;
  previewUrl(imageId: number): string;
  dispatch: Dispatch<EditorAction>;
  onEditWindow(imageId: number): void;
}) {
  const { id, block, respondLike } = request;
  const selected = selectedTerm !== undefined;
  const painted = hasPaintedRespondArea(respondLike.source);
  const about = useExplanation();
  // The block number opens the basis group's panel over the Canvas (look/basis-group-panel.tsx).
  const panel = { to: basisGroupPath("/create", "", block), state: PANEL_OPENED };
  // A card that arrives selected (a drop, or a return to Canvas) comes into view in its column.
  // A later selection moves nothing, so this runs once, as the card mounts.
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected && card.current) revealInColumn(card.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section
      ref={card}
      className="request-card"
      data-card="request"
      data-request={id}
      data-selected={selected || undefined}
      style={{ "--paint": ink } as CSSProperties}
      aria-label={fill(WORDS.name, { id })}
      onClick={() => dispatch({ type: "activateRequest", requestId: id })}
    >
      <div className="request-head">
        <SourcePicture token={respondLike.source} src={previewUrl(respondLike.source.imageId)} size={SOURCE_PICTURE_SIZE} />
        <div className="request-side">
          <Link to={panel.to} state={panel.state} preventScrollReset className="display mono request-block basis-group-number-link" aria-label={fill(WORDS.openBlock, { block })}>
            <BasisGroupLinkLabel block={block} />
          </Link>
          <span className="label">{painted ? WORDS.blockWord : fill(WORDS.blockToken, { token: tokenLabel(respondLike.source) })}</span>
        </div>
        <div className="request-actions">
          <ExplainButton explanation={about} subject={fill(WORDS.explainSubject, { id })} />
          <button
            type="button"
            className="chip"
            aria-label={fill(WORDS.remove, { id })}
            onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: "removeRequest", requestId: id });
            }}
          >
            ×
          </button>
        </div>
      </div>

      <TermSections
        request={request}
        pair={{ code: ink, look }}
        selectedTerm={selectedTerm}
        paints={paints}
        linked={linked}
        problems={problems}
        brushPalette={brushPalette}
        onEditWindow={onEditWindow}
        dispatch={dispatch}
      />

      <div className="request-code-space">{codeSpace}</div>

      <ExplanationText explanation={about}>
        {CARD_EXPLANATION.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </ExplanationText>
    </section>
  );
}

/**
 * The card's two sections, Code over Appearance, with the control strip between them.
 * Code's body ends with its "blocks" line (code-blocks.tsx).
 * On the hairline, the lock square (state.ts, the lock rule) and the
 * one brush; Code's weight and switch at the bottom of its section, Appearance's at the
 * top of its section, so the two switches, the lock and the brush are within one row of
 * each other. An edge strip on each section's left is lit while the brush paints it, both
 * while locked: Code's in the request's ink, Appearance's in the ink's lighter tone, as on
 * the canvas. A CLS or storage request has no Code area and no lock; the strip keeps the brush.
 */
function TermSections({
  request,
  pair,
  selectedTerm,
  paints,
  linked,
  problems,
  brushPalette,
  onEditWindow,
  dispatch,
}: {
  request: Request;
  /** The request's ink and Appearance tone (inks.ts). */
  pair: InkPair;
  selectedTerm?: AreaTerm;
  paints: { respond: boolean; look: boolean };
  linked: boolean;
  problems: { respond: string | null; look: string | null };
  brushPalette: ReactNode;
  onEditWindow(imageId: number): void;
  dispatch: Dispatch<EditorAction>;
}) {
  const { id, block, respondLike, lookLike } = request;
  const painted = hasPaintedRespondArea(respondLike.source);
  const respondText = painted ? TERM_TEXT.respond : TERM_TEXT.respondPrefix;
  const select = (term: AreaTerm) => dispatch({ type: "select", selection: { kind: "term", requestId: id, term } });
  // The colour picker (ink-picker.tsx): open for the request while the lock is closed, else for one term.
  const [picking, setPicking] = useState<InkTarget | null>(null);
  const swatch = (target: InkTarget) => <InkSwatch target={target} pair={pair} onOpen={() => setPicking(target)} />;

  return (
    <div
      className="term-sections"
      data-hinge={hingeOf(painted, linked)}
      data-lit={(paints.respond && paints.look) || undefined}
      style={{ "--paint-look": pair.look } as CSSProperties}
    >
      <TermSection
        term="respond"
        name={respondText.name}
        lit={paints.respond}
        selected={selectedTerm === "respond"}
        controlsAt="bottom"
        enabled={respondLike.enabled}
        weight={respondLike.weight}
        problem={problems.respond}
        swatch={swatch(linked ? "request" : "respond")}
        onSelect={() => select("respond")}
        onEnabled={(enabled) => dispatch({ type: "setTermEnabled", termId: respondTermId(id), enabled })}
        onWeight={(weight) => dispatch({ type: "setTermWeight", termId: respondTermId(id), weight })}
      >
        <MadeFrom block={block} source={respondLike.source} />
        <CodeBlocks request={request} dispatch={dispatch} />
      </TermSection>
      <div className="control-strip">
        {painted && <LockSquare linked={linked} onChange={(next) => dispatch({ type: "setAreasLinked", requestId: id, linked: next })} />}
        <div className="strip-brush">{brushPalette}</div>
      </div>
      <TermSection
        term="look"
        name={TERM_TEXT.look.name}
        lit={paints.look}
        selected={selectedTerm === "look"}
        controlsAt="top"
        enabled={lookLike.enabled}
        weight={lookLike.weight}
        problem={problems.look}
        swatch={linked ? undefined : swatch("look")}
        onSelect={() => select("look")}
        onEnabled={(enabled) => dispatch({ type: "setTermEnabled", termId: lookTermId(id), enabled })}
        onWeight={(weight) => dispatch({ type: "setTermWeight", termId: lookTermId(id), weight })}
      >
        <ReferenceStrip requestId={id} onEditWindow={onEditWindow} />
      </TermSection>
      {picking && (
        <InkPicker
          requestId={id}
          target={picking}
          pair={pair}
          onPick={(colour) => dispatch({ type: "pickInk", requestId: id, target: picking, colour })}
          onDefault={() => dispatch({ type: "clearInk", requestId: id, target: picking })}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/**
 * The lock is the hinge of the two sections' edges: joined while one
 * stroke paints both fields, broken while they paint apart. A CLS or storage request has
 * no Code field, so no lock and no hinge.
 */
function hingeOf(painted: boolean, linked: boolean): "joined" | "broken" | undefined {
  if (!painted) return undefined;
  return linked ? "joined" : "broken";
}

function TermSection({
  term,
  name,
  lit,
  selected,
  controlsAt,
  enabled,
  weight,
  problem,
  swatch,
  onSelect,
  onEnabled,
  onWeight,
  children,
}: {
  term: AreaTerm;
  name: string;
  /** The colour swatch after the name (ink-picker.tsx), where this section has one. */
  swatch?: ReactNode;
  /** The brush paints this section's area: its edge strip is lit. */
  lit: boolean;
  selected: boolean;
  /** Where the weight and switch sit: next to the control strip, at Code's bottom and Appearance's top. */
  controlsAt: "top" | "bottom";
  enabled: boolean;
  weight: number;
  problem: string | null;
  onSelect(): void;
  onEnabled(enabled: boolean): void;
  onWeight(weight: number): void;
  children: ReactNode;
}) {
  const controls = (
    <div className="section-controls">
      {problem && <span className="term-blocker label">{problem}</span>}
      {/* A span, not a label: a label would pass a click on "×" to the stepper's − button. */}
      <span className="term-weight label mono" onClick={(event) => event.stopPropagation()}>
        ×
        <Stepper kind="weight" value={weight} label={fill(WORDS.weightName, { name })} rule={WEIGHT_STEPS} onCommit={onWeight} />
      </span>
      <TermSwitch on={enabled} label={name} onChange={onEnabled} />
    </div>
  );
  return (
    <section className="term-section" data-term={term} data-lit={lit || undefined} data-off={!enabled || undefined} aria-label={name} onClick={onSelect}>
      <div className="section-head">
        <span className="section-name">
          <button type="button" className="term-select" aria-pressed={selected}>
            {name}
          </button>
          {swatch}
        </span>
        {controlsAt === "top" && controls}
      </div>
      <div className="section-body">{children}</div>
      {controlsAt === "bottom" && controls}
    </section>
  );
}

/**
 * Brings a card into view inside the Requests column, the nearest way, and never scrolls the
 * page. Where the column flows under the stage (a phone), it does not scroll by itself and
 * nothing moves: the canvas is where the visitor works, and a page scroll under a finger would
 * give the tap's click to whatever moved under it.
 */
export function revealInColumn(card: HTMLElement) {
  const column = card.closest<HTMLElement>(".requests-scroll");
  if (!column || !/(auto|scroll)/.test(getComputedStyle(column).overflowY)) return;
  const view = column.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  // Above the view: its top to the view's top. Below it: its bottom to the view's bottom, unless it is taller than the view.
  if (box.top < view.top) column.scrollTop -= view.top - box.top;
  else if (box.bottom > view.bottom) column.scrollTop += Math.min(box.bottom - view.bottom, box.top - view.top);
}

/** The token's picture on its 16 × 16 grid, with the token's cell marked; a CLS or storage token has no cell. */
export function SourcePicture({ token, src, size }: { token: Token; src: string; size: number }) {
  const cell = tokenCell(token);
  return (
    <span className="source-picture" style={{ width: size, height: size }}>
      <LibraryImage src={src} alt={fill(WORDS.imageName, { id: token.imageId })} loading="lazy" />
      <PatchGrid className="source-grid" />
      {cell && (
        <i
          className="source-cell"
          aria-hidden="true"
          style={{
            left: `${(cell.column / GRID) * 100}%`,
            top: `${(cell.row / GRID) * 100}%`,
            width: `${100 / GRID}%`,
            height: `${100 / GRID}%`,
          }}
        />
      )}
    </span>
  );
}
