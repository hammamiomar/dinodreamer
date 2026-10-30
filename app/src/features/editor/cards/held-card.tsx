// A held token waits for its first painting stroke. Its card uses the next request's
// ink and keeps the brush in place when deselected, so selection never moves nearby
// controls. Clicking arms the brush; Remove releases the token without a request.

import { useEffect, useRef } from "react";
import type { CSSProperties, Dispatch, ReactNode } from "react";
import type { TokenHandoff } from "../../../app/handoff";
import { hasPaintedRespondArea } from "../model";
import { TERM_TEXT } from "../presentation";
import type { EditorAction } from "../state";
import { SourcePicture, revealInColumn } from "./request-card";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";

const WORDS = CREATE_TEXT.held;

/** The held token's picture: larger than a request's, since its card has one section. In CSS pixels. */
const HELD_PICTURE_SIZE = 112;

export function HeldCard({
  handoff,
  ink,
  selected,
  brushPalette,
  previewUrl,
  dispatch,
}: {
  handoff: TokenHandoff;
  ink: string;
  selected: boolean;
  /** The brush's shape and size: live while the held token is selected, greyed otherwise. */
  brushPalette: ReactNode;
  previewUrl(imageId: number): string;
  dispatch: Dispatch<EditorAction>;
}) {
  const areas = hasPaintedRespondArea(handoff.token) ? fill(CREATE_TEXT.areas.both, { respond: TERM_TEXT.respond.name, look: TERM_TEXT.look.name }) : TERM_TEXT.look.name;
  // Armed on arrival from the block viewer: the card comes into view in its column as it mounts, as a request card that arrives selected does.
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected && card.current) revealInColumn(card.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section
      ref={card}
      className="request-card held-card"
      data-card="held"
      data-selected={selected || undefined}
      style={{ "--paint": ink } as CSSProperties}
      aria-label={fill(WORDS.name, { block: handoff.block })}
      onClick={() => dispatch({ type: "select", selection: { kind: "held" } })}
    >
      <div className="request-head">
        <SourcePicture token={handoff.token} src={previewUrl(handoff.token.imageId)} size={HELD_PICTURE_SIZE} />
        <div className="request-side">
          <span className="display mono request-block">{handoff.block}</span>
          <span className="label">{WORDS.side}</span>
        </div>
        <div className="request-actions">
          <button
            type="button"
            className="chip"
            aria-label={fill(WORDS.remove, { block: handoff.block })}
            onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: "releaseHeld" });
            }}
          >
            ×
          </button>
        </div>
      </div>
      <div className="term-sections">
        <div className="term-section" data-lit={selected || undefined}>
          <div className="section-head">
            <button type="button" className="term-select" aria-pressed={selected} title={WORDS.firstStroke}>
              {areas}
            </button>
            <div className="section-brush">{brushPalette}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
