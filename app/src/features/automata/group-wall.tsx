// The wall: every basis group that holds an automaton, one card each. A card is a pair, the picture of
// the group's automaton beside the group's four strongest patches, so the page's comparison is made
// before a group is opened. The groups the owner featured for the site come first and larger. A card
// opens the group's screen; Back returns to the wall at the place it was left.
//
// A card's automaton is a still until it plays: the featured cards in view grow live, a few at once,
// and any other card grows while the pointer is on it. With reduced motion every card is a still.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { useLibrary } from "../../app/library-session";
import { ATLAS_TEXT } from "../atlas/atlas-text";
import { pictureSlots } from "../atlas/card-loading";
import { useNearScreen } from "../atlas/cloud-card";
import { nameOf, type BasisGroupNames } from "../gallery/basis-groups";
import { BAND_COLOURS } from "../look/strength-bands";
import { LibraryImage } from "../../ui/library-image";
import { useMediaMatch } from "../../ui/media-match";
import { cardsPlaying, groupPath, pictureOfGroup, shownCount, siteFeatured, wallOrder, type GalleryAutomaton, type GalleryGroup } from "./gallery";
import { useGroupPictures } from "./group-levels";
import { FROM_WALL } from "./group-screen";

const WORDS = SITE_WORDS.automata;
/** A featured card has come into view at this share of its box. */
const SHARE_IN_VIEW = 0.4;

/** The strongest level, the one a card shows. */
const STRONGEST = 3;
const PATCHES_PER_SIDE = 16;

/** The group's four strongest patches, two by two, read when the card comes near the view. */
function StrongestPatches({ block, wanted }: { block: number; wanted: boolean }) {
  const library = useLibrary();
  const content = useGroupPictures(block, wanted);
  const slots = content.status === "ready"
    ? pictureSlots(content.value.cloud.pictures, (picture) => content.value.failed.has(library.thumbnailUrl(picture.imageId)))[STRONGEST]!
    : [];
  return (
    <span className="automata-card-patches" style={{ "--band": BAND_COLOURS[STRONGEST] } as CSSProperties}>
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

function GroupCard<T extends GalleryAutomaton>({ group, name, mark, live, renderLive, onInView, onPointer }: {
  group: GalleryGroup<T>;
  name: string | null;
  /** The owner's view: a line under the count, such as how many a visitor sees. */
  mark?: ReactNode;
  /** Whether the card's automaton grows now, in the still's place. */
  live: boolean;
  renderLive?: (automaton: T) => ReactNode;
  /** A featured card tells the wall when it comes into view and when it leaves. */
  onInView?: (inView: boolean) => void;
  onPointer: (on: boolean) => void;
}) {
  const self = useRef<HTMLAnchorElement>(null);
  const near = useNearScreen(self);
  const picture = pictureOfGroup(group);
  const count = shownCount(group.automata);
  const reportsView = onInView !== undefined;
  const report = useRef(onInView);
  report.current = onInView;
  useEffect(() => {
    const element = self.current;
    if (!element || !reportsView) return;
    const observer = new IntersectionObserver(([seen]) => report.current?.(seen?.isIntersecting ?? false), { threshold: SHARE_IN_VIEW });
    observer.observe(element);
    return () => { observer.disconnect(); report.current?.(false); };
  }, [reportsView]);
  return (
    <Link ref={self} className="automata-card" to={groupPath(group.group)} state={FROM_WALL} data-featured={siteFeatured(group) || undefined}
      aria-label={fill(WORDS.cardName, { group: group.group, name: name ?? "" }).trim()}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") onPointer(true); }} onPointerLeave={() => onPointer(false)}>
      <span className="automata-card-pair">
        <span className="automata-card-automaton">
          {picture && (live && renderLive ? renderLive(picture) : <img src={picture.pictureUrl} alt="" width={128} height={128} loading="lazy" />)}
        </span>
        <StrongestPatches block={group.group} wanted={near} />
      </span>
      <span className="automata-card-words">
        <span className="automata-card-title">{name ?? group.group}</span>
        <span className="automata-card-facts">
          {name !== null && <span>{group.group}</span>}
          <span>{count === 1 ? WORDS.cardCountOne : fill(WORDS.cardCount, { count })}</span>
          {mark}
        </span>
      </span>
    </Link>
  );
}

export function GroupWall<T extends GalleryAutomaton>({ groups, names, status, aside, markOf, renderLive, children }: {
  groups: readonly GalleryGroup<T>[];
  names: BasisGroupNames;
  /** What the wall says in the cards' place while the automata load, or when there is none: null once it has cards. */
  status: string | null;
  /** At the right of the heading: the way to the saved automata. */
  aside?: ReactNode;
  markOf?: (group: GalleryGroup<T>) => ReactNode;
  /** A card's automaton growing live in its square; the page supplies it, since a page knows where its files are. */
  renderLive?: (automaton: T) => ReactNode;
  children?: ReactNode;
}) {
  const ordered = wallOrder(groups);
  const automata = groups.reduce((sum, group) => sum + shownCount(group.automata), 0);
  const still = useMediaMatch("(prefers-reduced-motion: reduce)");
  const [inView, setInView] = useState<ReadonlySet<number>>(new Set());
  const [pointed, setPointed] = useState<number | null>(null);
  const playing = cardsPlaying(ordered.filter((group) => inView.has(group.group)).map((group) => group.group));
  const seen = (group: number, visible: boolean) => setInView((before) => {
    if (before.has(group) === visible) return before;
    const after = new Set(before);
    if (visible) after.add(group);
    else after.delete(group);
    return after;
  });
  return (
    <main className="page automata-wall">
      <header className="automata-wall-head">
        <h1 className="heading">{WORDS.wallTitle}</h1>
        {aside}
        <p className="muted">{fill(WORDS.wallLead, { groups: groups.length, automata: automata.toLocaleString() })}</p>
      </header>
      {status !== null && <p className="automata-status" role="status">{status}</p>}
      <div className="automata-cards">
        {ordered.map((group) => (
          <GroupCard key={group.group} group={group} name={nameOf(names, group.group)} mark={markOf?.(group)}
            live={!still && (playing.has(group.group) || pointed === group.group)} renderLive={renderLive}
            onInView={siteFeatured(group) ? (visible) => seen(group.group, visible) : undefined}
            onPointer={(on) => setPointed((before) => (on ? group.group : before === group.group ? null : before))} />
        ))}
      </div>
      {children}
    </main>
  );
}
