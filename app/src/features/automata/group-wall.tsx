// The wall: every basis group that holds an automaton, and one stage. The index on the right holds one
// square per group, all the same size: the group's automaton, with its name under it. The stage on the
// left shows the group the reader is looking at, large: its number and name, its automaton growing, and
// its four strongest patches, so the page's comparison is made before a group is opened. Pointing at a
// square, or giving it the keyboard's focus, brings its group to the stage; on a screen without a pointer
// the square that scrolls past the reading line does. A square opens the group's screen; Back returns to
// the wall at the place it was left.
//
// One automaton grows at a time, the stage's, once the reader has stayed on its group a moment. With
// reduced motion the stage shows the still.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { useLibrary } from "../../app/library-session";
import { ATLAS_TEXT } from "../atlas/atlas-text";
import { pictureSlots } from "../atlas/card-loading";
import { nameOf, type BasisGroupNames } from "../gallery/basis-groups";
import { BAND_COLOURS } from "../look/strength-bands";
import { LibraryImage } from "../../ui/library-image";
import { useMediaMatch } from "../../ui/media-match";
import { addressSearch, pictureOfGroup, shownCount, wallOrder, type GalleryAutomaton, type GalleryGroup } from "./gallery";
import { useGroupPictures } from "./group-levels";
import { FROM_WALL } from "./group-screen";

const WORDS = SITE_WORDS.automata;
/** The stage starts the group's automaton growing after the reader has stayed on the group this long. */
const SETTLE_MS = 350;
/** Without a pointer, the reading line: a square takes the stage when it crosses this band of the window. */
const READING_LINE = "-62% 0px -34% 0px";

/** The strongest level, the one the stage shows. */
const STRONGEST = 3;
const PATCHES_PER_SIDE = 16;

/** The group's four strongest patches in a row, each with its patch marked. */
function StrongestPatches({ block }: { block: number }) {
  const library = useLibrary();
  const content = useGroupPictures(block, true);
  const slots = content.status === "ready"
    ? pictureSlots(content.value.cloud.pictures, (picture) => content.value.failed.has(library.thumbnailUrl(picture.imageId)))[STRONGEST]!
    : [];
  return (
    <span className="automata-wall-patches" style={{ "--band": BAND_COLOURS[STRONGEST] } as CSSProperties}>
      {slots.map((slot, position) => {
        if (slot.kind === "tile") return <span key={position} className="automata-level-picture automata-level-tile" />;
        const patch = slot.picture.slot - 5;
        return (
          <span key={position} className="automata-level-picture">
            <LibraryImage src={library.thumbnailUrl(slot.picture.imageId)} alt={ATLAS_TEXT.pictureName(block, ATLAS_TEXT.bands[STRONGEST])} />
            <i style={{ left: `${((patch % PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100}%`, top: `${(Math.floor(patch / PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100}%` }} />
          </span>
        );
      })}
    </span>
  );
}

/** True once `key` has stayed the same for `delay` milliseconds; false again as soon as it changes. */
function useSettled(key: unknown, delay: number): boolean {
  const [settled, setSettled] = useState<unknown>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(key), delay);
    return () => window.clearTimeout(timer);
  }, [key, delay]);
  return settled === key;
}

function groupLink(group: number) {
  return { search: addressSearch({ group, automaton: null }) };
}

/** The group the reader is looking at, large. */
function WallStage<T extends GalleryAutomaton>({ group, name, mark, live, renderLive }: {
  group: GalleryGroup<T>;
  name: string | null;
  mark?: ReactNode;
  live: boolean;
  renderLive?: (automaton: T) => ReactNode;
}) {
  const picture = pictureOfGroup(group);
  const count = shownCount(group.automata);
  return (
    <section className="automata-wall-stage" aria-label={fill(WORDS.cardName, { group: group.group, name: name ?? "" }).trim()}>
      <div className="automata-wall-stage-title">
        <span className="automata-wall-stage-number">{group.group}</span>
        {name !== null && <span className="automata-wall-stage-name">{name}</span>}
      </div>
      <Link className="automata-wall-stage-picture" to={groupLink(group.group)} state={FROM_WALL} tabIndex={-1} aria-hidden="true">
        {picture && (live && renderLive
          ? <span key={picture.id} className="automata-wall-stage-live">{renderLive(picture)}</span>
          : <img key={picture.id} src={picture.pictureUrl} alt="" width={128} height={128} />)}
      </Link>
      <StrongestPatches key={group.group} block={group.group} />
      <p className="automata-wall-stage-line">
        {mark ?? <span>{count === 1 ? WORDS.cardCountOne : fill(WORDS.cardCount, { count })}</span>}
        <Link className="link-control" to={groupLink(group.group)} state={FROM_WALL}>{fill(WORDS.stageOpen, { group: group.group })}</Link>
      </p>
    </section>
  );
}

/** One square of the index: the group's automaton and its name. */
function IndexSquare<T extends GalleryAutomaton>({ group, name, mark, chosen, followsScroll, onLook }: {
  group: GalleryGroup<T>;
  name: string | null;
  mark?: ReactNode;
  chosen: boolean;
  /** Without a pointer: the square takes the stage when it crosses the reading line. */
  followsScroll: boolean;
  onLook: () => void;
}) {
  const self = useRef<HTMLAnchorElement>(null);
  const picture = pictureOfGroup(group);
  const look = useRef(onLook);
  look.current = onLook;
  useEffect(() => {
    const element = self.current;
    if (!element || !followsScroll) return;
    const observer = new IntersectionObserver(([seen]) => { if (seen?.isIntersecting) look.current(); }, { rootMargin: READING_LINE });
    observer.observe(element);
    return () => observer.disconnect();
  }, [followsScroll]);
  return (
    <li>
      <Link ref={self} className="automata-index-square" to={groupLink(group.group)} state={FROM_WALL} data-chosen={chosen || undefined}
        aria-label={fill(WORDS.cardName, { group: group.group, name: name ?? "" }).trim()}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") onLook(); }} onFocus={onLook}>
        <span className="automata-index-picture">
          {picture && <img src={picture.pictureUrl} alt="" width={128} height={128} loading="lazy" />}
        </span>
        <span className="automata-index-name">{name ?? group.group}</span>
        {mark && <span className="automata-index-mark">{mark}</span>}
      </Link>
    </li>
  );
}

export function GroupWall<T extends GalleryAutomaton>({ groups, names, status, aside, markOf, renderLive, lead, children }: {
  groups: readonly GalleryGroup<T>[];
  names: BasisGroupNames;
  /** What the wall says in the index's place while the automata load, or when there is none: null once it has groups. */
  status: string | null;
  /** At the right of the heading: the way to the saved automata. */
  aside?: ReactNode;
  markOf?: (group: GalleryGroup<T>) => ReactNode;
  /** The stage's automaton growing live; the page supplies it, since a page knows where its files are. */
  renderLive?: (automaton: T) => ReactNode;
  /** The owner's view: its line under the heading, in the sentence's place. */
  lead?: ReactNode;
  children?: ReactNode;
}) {
  const ordered = wallOrder(groups);
  const automata = groups.reduce((sum, group) => sum + shownCount(group.automata), 0);
  const still = useMediaMatch("(prefers-reduced-motion: reduce)");
  const noPointer = useMediaMatch("(hover: none)");
  const [looked, setLooked] = useState<number | null>(null);
  const current = ordered.find((group) => group.group === looked) ?? ordered[0];
  const settled = useSettled(current?.group, SETTLE_MS);
  return (
    <main className="page automata-wall">
      <header className="automata-wall-head">
        <h1 className="heading">{WORDS.wallTitle}</h1>
        {aside}
        {lead ?? <p className="muted">{fill(WORDS.wallLead, { groups: groups.length, automata: automata.toLocaleString() })}</p>}
      </header>
      {status !== null && <p className="automata-status" role="status">{status}</p>}
      {current && (
        <div className="automata-wall-body">
          <WallStage group={current} name={nameOf(names, current.group)} mark={markOf?.(current)} live={!still && settled} renderLive={renderLive} />
          <ol className="automata-index">
            {ordered.map((group) => (
              <IndexSquare key={group.group} group={group} name={nameOf(names, group.group)} mark={markOf?.(group)}
                chosen={group.group === current.group} followsScroll={noPointer} onLook={() => setLooked(group.group)} />
            ))}
          </ol>
        </div>
      )}
      {children}
    </main>
  );
}
