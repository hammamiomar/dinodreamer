// A basis group number opens a preview of its strongest public pictures, with selected patches
// marked. Hover and keyboard focus show a floating card; touch opens a modal sheet. The Atlas
// loader shares these reads with the Index cards.

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useMediaMatch } from "../../ui/media-match";
import { fill, SITE_WORDS } from "../../app/site-words";
import { BasisGroupLink } from "../look/basis-group-panel";
import { useLibrary } from "../../app/library-session";
import type { AtlasBand } from "../../library/atlas-cloud";
import { PATCH_SLOT_OFFSET } from "../../recipe";
import { LibraryImage } from "../../ui/library-image";
import { ATLAS_TEXT } from "../atlas/atlas-text";
import { pictureSlots, type CardContent } from "../atlas/card-loading";
import { cardLoader } from "../atlas/cloud-card";
import { useCoarsePointer } from "../editor/coarse-pointer";
import { STRENGTH_BANDS } from "../look/strength-bands";
import { familyName } from "./playground";

const WORDS = SITE_WORDS.playground;
/** The bands the peek shows, strongest first; Barely says little about a block. */
const PREVIEW_BANDS: readonly AtlasBand[] = [3, 2, 1];
/** A hover shows the card after this long, so a pointer crossing the heading does not flash it. */
const HOVER_SHOW_MS = 180;
/** The card stays this long after the pointer leaves, so it can move from the heading into the card. */
const HOVER_HIDE_MS = 160;
/** A library picture is 16 × 16 patches; a slot names one of them after the class and register tokens. */
const PATCHES_PER_SIDE = 16;

type BlockPreviewContent = { status: "loading" } | { status: "ready"; content: CardContent } | { status: "failed" };

/**
 * The block's Atlas record and decoded pictures, read once it is wanted; the loader shares the read
 * with the Atlas. The content belongs to its block: when the block changes (the stage's number after
 * another automaton is chosen), the old block's pictures are not shown.
 */
function useBlockPreviewContent(block: number, wanted: boolean): BlockPreviewContent {
  const library = useLibrary();
  const [state, setState] = useState<{ block: number; content: BlockPreviewContent }>({ block, content: { status: "loading" } });
  const current = state.block === block ? state.content : { status: "loading" as const };
  useEffect(() => {
    if (!wanted || current.status === "ready") return;
    let live = true;
    cardLoader(library).load(block, "screen").then(
      (content) => { if (live) setState({ block, content: { status: "ready", content } }); },
      () => { if (live) setState({ block, content: { status: "failed" } }); },
    );
    return () => { live = false; };
  }, [library, block, wanted, current.status]);
  return current;
}

/** The card: the block's pictures by band with their patches marked, its family, and the way to the block page. */
function BlockPreviewCard({ block, family, content, onOpenBlock }: {
  block: number;
  family: string | undefined;
  content: BlockPreviewContent;
  /** The sheet closes as its link opens the panel, so no modal stays open under the panel. */
  onOpenBlock?: () => void;
}) {
  const library = useLibrary();
  const failedPicture = (imageId: number) => content.status === "ready" && content.content.failed.has(library.thumbnailUrl(imageId));
  const bands = content.status === "ready"
    ? pictureSlots(content.content.cloud.pictures, (picture) => failedPicture(picture.imageId))
      .map((slots, band) => ({ band: band as AtlasBand, slots }))
      .filter(({ band, slots }) => PREVIEW_BANDS.includes(band) && slots.length > 0)
      .sort((a, b) => PREVIEW_BANDS.indexOf(a.band) - PREVIEW_BANDS.indexOf(b.band))
    : [];
  return (
    <div className="playground-preview-card">
      {content.status === "loading" && <p className="muted">{fill(WORDS.peekLoading, { block })}</p>}
      {content.status === "failed" && <p className="muted">{WORDS.peekFailed}</p>}
      {bands.map(({ band, slots }) => (
        <div key={band} className="playground-preview-band">
          <span className={`band ${STRENGTH_BANDS[band]}`}>{ATLAS_TEXT.bands[band]}</span>
          {slots.map((slot, position) => {
            if (slot.kind === "tile") return <span key={`tile:${position}`} className="playground-preview-picture" aria-hidden="true" />;
            const patch = slot.picture.slot - PATCH_SLOT_OFFSET;
            return (
              <span key={`${slot.picture.imageId}:${slot.picture.slot}`} className="playground-preview-picture">
                <LibraryImage src={library.thumbnailUrl(slot.picture.imageId)} alt={ATLAS_TEXT.pictureName(block, ATLAS_TEXT.bands[band])} decoding="sync" />
                <i style={{ left: `${((patch % PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100}%`, top: `${(Math.floor(patch / PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100}%` }} />
              </span>
            );
          })}
        </div>
      ))}
      <p className="playground-preview-foot">
        <span>{family === undefined ? "" : familyName(family)}</span>
        <BasisGroupLink block={block} onClick={onOpenBlock}>{WORDS.openBlock}</BasisGroupLink>
      </p>
    </div>
  );
}

/**
 * A basis group's number that is also the peek's trigger: the link to the block page. With a mouse the
 * peek floats beside or under it while the pointer is on the number or on the peek, and a click follows
 * the link. With keys, focus on the number (a keyboard's focus, :focus-visible) shows the peek, Enter
 * follows the link, Tab goes into the peek, and Escape closes it and returns to the number. With a
 * finger, a tap on the number opens the sheet, a native modal dialog that Escape and a tap outside it
 * close; the sheet's own link leads to the block page. `wrap` places the number link in its heading;
 * `className` names the wrapper, whose stylesheet places the peek (never over a stage).
 */
function BlockNumberPeek({ block, family, className, wrap, asSheet }: {
  block: number;
  family: string | undefined;
  className: string;
  wrap: (number: ReactNode) => ReactNode;
  /** The peek opens as a sheet (a modal dialog) instead of floating beside the number: with a finger, or where no room is beside it. */
  asSheet: boolean;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const content = useBlockPreviewContent(block, open);
  const previewId = useId();
  const numberId = useId();
  const sheet = useRef<HTMLDialogElement>(null);
  const number = useRef<HTMLAnchorElement>(null);

  const later = (next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  const now = (next: boolean) => later(next, 0);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Another block in the same place (the stage's number when the automaton changes) starts closed.
  useEffect(() => { setOpen(false); }, [block]);

  useEffect(() => {
    const element = sheet.current;
    if (!asSheet || !element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [asSheet, open]);

  // A finger's tap opens the sheet instead of following the link; a mouse's click and Enter follow it.
  const onNumberClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!asSheet) return;
    event.preventDefault();
    now(true);
  };
  // Only a keyboard's focus shows the peek: a click's focus is on its way to the block page.
  const onNumberFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    if (!asSheet && event.currentTarget.matches(":focus-visible")) now(true);
  };
  // The peek stays while the focus is in the heading or the peek (its link), and goes when it leaves.
  const onHeadBlur = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.relatedTarget;
    if (!(target instanceof Node && event.currentTarget.contains(target))) later(false, HOVER_HIDE_MS);
  };
  // Escape returns the focus to the number first: that keyboard focus would open the peek again.
  const onHeadKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    number.current?.focus();
    now(false);
  };

  const link = (
    <BasisGroupLink ref={number} id={numberId} block={block} aria-expanded={open} aria-controls={previewId}
      aria-haspopup={asSheet ? "dialog" : undefined}
      onClick={onNumberClick}
      onFocus={onNumberFocus}
      onPointerEnter={asSheet ? undefined : () => later(true, HOVER_SHOW_MS)} />
  );

  if (asSheet) {
    return (
      <div className={className}>
        {wrap(link)}
        <dialog ref={sheet} id={previewId} className="playground-preview-sheet" aria-label={`${block}`} onClose={() => setOpen(false)}
          onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="playground-preview-sheet-head">
            <span className="heading">{block}</span>
            <button type="button" className="playground-word" onClick={() => setOpen(false)}>{WORDS.close}</button>
          </div>
          <BlockPreviewCard block={block} family={family} content={content} onOpenBlock={() => setOpen(false)} />
        </dialog>
      </div>
    );
  }
  // The pointer may move from the number into the peek: inside the wrapper an open peek stays.
  return (
    <div className={className}
      onPointerEnter={() => { if (open) now(true); }}
      onPointerLeave={() => later(false, HOVER_HIDE_MS)}
      onBlur={onHeadBlur}
      onKeyDown={onHeadKeyDown}>
      {wrap(link)}
      {open && (
        <div id={previewId} className="playground-preview" role="group" aria-labelledby={numberId}>
          <BlockPreviewCard block={block} family={family} content={content} />
        </div>
      )}
    </div>
  );
}

/** A block group's heading on the shelf: the number, its peek under it, and the count. */
export function BlockHeading({ block, count, family }: { block: number; count: number; family: string | undefined }) {
  const coarse = useCoarsePointer();
  return (
    <BlockNumberPeek block={block} family={family} className="playground-block-head" asSheet={coarse} wrap={(number) => (
      <>
        <h2 className="heading">{number}</h2>
        <span className="playground-count" aria-label={fill(WORDS.blockCount, { count })}>{count}</span>
      </>
    )} />
  );
}

/** Where the Automata page is two panes (playground.css): the stage's peek floats beside the stage, over the shelf. */
const TWO_PANES = "(min-width: 1200px)";

/**
 * The stage's display number on the Automata page: the same peek as a group's
 * number on the shelf and the same link. Beside the stage, over the shelf, where the page is two
 * panes; as a sheet in one column, where the frame is under the number, and with a finger.
 */
export function StageBlockNumber({ block, family }: { block: number; family: string | undefined }) {
  const coarse = useCoarsePointer();
  const twoPanes = useMediaMatch(TWO_PANES);
  return <BlockNumberPeek block={block} family={family} className="playground-head-number" asSheet={coarse || !twoPanes}
    wrap={(number) => <h1 className="display">{number}</h1>} />;
}
