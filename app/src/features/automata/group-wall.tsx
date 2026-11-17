// The wall: every basis group that holds an automaton, as a deck on a table. A deck's face is the
// group's automaton, grown live when the deck comes into view (live-faces.ts). Under the face lie four
// plates, the group's own patches by response level, the strongest on top: depth in a deck is depth
// into the group. The table is drawn from one eye, the pointer (wall-eye.ts), so a deck away from it
// shows the edges of its plates in the levels' colours.
//
// The deck the reader is on comes forward, and its plates slide out from under the face: the
// strongest patches whole, beside the automaton, and the edges of the weaker levels behind them. The
// pointer moving across a face disturbs its cells, and the rule heals them. A deck opens the group's
// screen, where its face is the stage and its plates are the levels (wall-passage.ts); Back folds the
// group into its deck again, at the place the wall was left.
//
// With reduced motion, or where the browser cannot grow an automaton, a face is its still.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { useLibrary } from "../../app/library-session";
import type { AtlasBand } from "../../library/atlas-cloud";
import type { FigureMaterial } from "../../materials/material-file";
import { PATCH_SLOT_OFFSET } from "../../recipe";
import { ATLAS_TEXT } from "../atlas/atlas-text";
import { pictureSlots } from "../atlas/card-loading";
import { useNearScreen } from "../atlas/cloud-card";
import { nameOf, type BasisGroupNames } from "../gallery/basis-groups";
import { BAND_COLOURS } from "../look/strength-bands";
import { LibraryImage } from "../../ui/library-image";
import { useMediaMatch } from "../../ui/media-match";
import { Select } from "../../ui/select";
import { addressSearch, findGroups, pictureOfGroup, shownCount, sortWall, WALL_SORTS, type GalleryAutomaton, type GalleryGroup, type WallSort } from "./gallery";
import { useGroupPictures } from "./group-levels";
import { FROM_WALL } from "./group-screen";
import { openLiveFace, type LiveFace } from "./live-faces";
import { useWallEye } from "./wall-eye";
import { levelPassage, openedLast, rememberOpened, STAGE_PASSAGE } from "./wall-passage";

const WORDS = SITE_WORDS.automata;
/** The plates of a deck, the deepest first: the barely responding level at the bottom, the strongest under the face. */
const LEVELS_DEEPEST_FIRST: readonly AtlasBand[] = [0, 1, 2, 3];
const STRONGEST: AtlasBand = 3;
const PATCHES_PER_SIDE = 16;
/** A face starts to grow when this share of it is in the window. */
const SHARE_IN_VIEW = 0.25;
/** The pointer may cross the room between two decks this long before the deck it left goes back down. */
const LEAVE_MS = 180;
/** A deck that changes place, when the wall is sorted or searched, glides there in this time. */
const GLIDE_MS = 420;
const GLIDE_EASING = "cubic-bezier(0.3, 0.9, 0.25, 1)";

/** What a page gives the wall so that a face can grow: the automaton's definition, its grid and its seed. */
export type LoadFace<T> = (automaton: T) => Promise<{ material: FigureMaterial; side: number; seed: number }>;

/** A deck's face: black until its turn, then the automaton growing, then at rest; its still where it cannot grow. */
function DeckFace<T extends GalleryAutomaton>({ automaton, loadFace, forward, wallHidden, carried }: {
  automaton: T;
  /** Absent: the face is the automaton's still. */
  loadFace?: LoadFace<T>;
  /** The reader is on the deck: a face that waits for its turn grows now. */
  forward: boolean;
  wallHidden: boolean;
  carried: boolean;
}) {
  const self = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const face = useRef<LiveFace | null>(null);
  const inView = useRef(false);
  const side = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);
  const isForward = useRef(forward);
  isForward.current = forward;
  useEffect(() => { if (forward) face.current?.hurry(); }, [forward]);
  const [wanted, setWanted] = useState(false);
  const [state, setState] = useState<"waiting" | "live" | "still">(loadFace && "gpu" in navigator ? "waiting" : "still");

  useEffect(() => {
    const element = self.current;
    if (!element) return;
    const observer = new IntersectionObserver(([seen]) => {
      inView.current = seen?.isIntersecting ?? false;
      if (inView.current) setWanted(true);
      face.current?.setInView(inView.current);
    }, { threshold: SHARE_IN_VIEW });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!wanted || !loadFace || state === "still") return;
    let closed = false;
    loadFace(automaton).then((grown) => {
      if (closed || !canvas.current) return;
      side.current = grown.side;
      const opened = openLiveFace(canvas.current, grown.material, grown, {
        onShown: () => setState("live"),
        onFailed: () => setState("still"),
      });
      opened.setInView(inView.current);
      if (isForward.current) opened.hurry();
      face.current = opened;
    }, () => { if (!closed) setState("still"); });
    return () => {
      closed = true;
      face.current?.close();
      face.current = null;
    };
    // The state is read once, to skip a face that is a still from the start; a face that fails closes itself.
  }, [wanted, loadFace, automaton.id]);

  // A canvas that was not displayed has lost its picture: the cells are drawn again when the wall returns.
  useEffect(() => {
    if (!wallHidden) face.current?.redraw();
  }, [wallHidden]);

  const cellAt = (event: PointerEvent<HTMLSpanElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * side.current, y: ((event.clientY - box.top) / box.height) * side.current };
  };
  // The pointer is a light brush here: every move across the face stamps its path.
  const wake = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType !== "mouse" || side.current === 0) return;
    const next = cellAt(event);
    if (last.current) face.current?.stroke(last.current, next);
    last.current = next;
  };

  return (
    <span ref={self} className="automata-deck-face" data-state={state} style={carried ? { viewTransitionName: STAGE_PASSAGE } : undefined}
      onPointerMove={wake} onPointerLeave={() => { last.current = null; }}>
      {state === "still"
        ? <img src={automaton.pictureUrl} alt="" width={128} height={128} loading="lazy" />
        : <canvas ref={canvas} />}
    </span>
  );
}

/** The four plates under a face, read when the deck comes near the window. */
function DeckPlates({ block, wanted, carried }: { block: number; wanted: boolean; carried: boolean }) {
  const library = useLibrary();
  const content = useGroupPictures(block, wanted);
  const slots = content.status === "ready"
    ? pictureSlots(content.value.cloud.pictures, (picture) => content.value.failed.has(library.thumbnailUrl(picture.imageId)))
    : null;
  // A group whose pictures cannot be read has no plates: a deck never shows a level it cannot fill.
  if (content.status === "failed") return null;
  return (
    <>
      {LEVELS_DEEPEST_FIRST.map((band) => (
        <span key={band} className="automata-deck-plate"
          style={{ "--depth": STRONGEST - band + 1, "--band": BAND_COLOURS[band], viewTransitionName: carried ? levelPassage(band) : undefined } as CSSProperties}>
          {(slots?.[band] ?? []).map((slot, position) => {
            if (slot.kind === "tile") return <span key={position} className="automata-level-picture automata-level-tile" />;
            const patch = slot.picture.slot - PATCH_SLOT_OFFSET;
            return (
              <span key={position} className="automata-level-picture">
                <LibraryImage src={library.thumbnailUrl(slot.picture.imageId)} alt={ATLAS_TEXT.pictureName(block, ATLAS_TEXT.bands[band])} />
                <i style={{ left: `${((patch % PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100}%`, top: `${(Math.floor(patch / PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100}%` }} />
              </span>
            );
          })}
        </span>
      ))}
    </>
  );
}

function Deck<T extends GalleryAutomaton>({ group, name, mark, loadFace, forward, fan, carried, wallHidden, onLook, onLeave, onOpen }: {
  group: GalleryGroup<T>;
  name: string | null;
  /** The owner's view: in the count's place, how many of the group's automata a visitor sees. */
  mark?: ReactNode;
  loadFace?: LoadFace<T>;
  /** The reader is on this deck: it comes forward and its plates slide out. */
  forward: boolean;
  /** The side the plates slide out to: 1 to the right, -1 to the left, where the wall has the room. */
  fan: 1 | -1;
  carried: boolean;
  wallHidden: boolean;
  onLook: (deck: HTMLElement) => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  const self = useRef<HTMLLIElement>(null);
  const near = useNearScreen(self);
  const picture = pictureOfGroup(group);
  const count = shownCount(group.automata);
  return (
    <li ref={self} className="automata-deck" data-group={group.group} data-forward={forward || undefined} style={{ "--fan": fan } as CSSProperties}>
      <Link className="automata-deck-link" to={{ search: addressSearch({ group: group.group, automaton: null }) }} state={FROM_WALL} viewTransition
        aria-label={fill(WORDS.cardName, { group: group.group, name: name ?? "" }).trim()} onClick={onOpen}
        onPointerEnter={(event) => { if (event.pointerType === "mouse" && self.current) onLook(self.current); }} onPointerLeave={onLeave}
        onFocus={() => { if (self.current) onLook(self.current); }} onBlur={onLeave}>
        <span className="automata-deck-body">
          <DeckPlates block={group.group} wanted={near} carried={carried} />
          {picture && <DeckFace automaton={picture} loadFace={loadFace} forward={forward} wallHidden={wallHidden} carried={carried} />}
        </span>
        <span className="automata-deck-words">
          <span className="automata-deck-name">{name ?? group.group}</span>
          <span className="automata-deck-facts">
            {name !== null && <span>{group.group}</span>}
            {mark ?? <span>{count === 1 ? WORDS.cardCountOne : fill(WORDS.cardCount, { count })}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * When the decks change places (another order, or other words in the find field), each deck that stays
 * glides from where it stood to where it stands. `order` names the decks in their order; the places are
 * read after every layout, so the glide starts from where a deck was last drawn.
 */
function useDecksGlide(table: RefObject<HTMLElement | null>, order: string, still: boolean): void {
  const places = useRef(new Map<string, { left: number; top: number }>());
  useLayoutEffect(() => {
    const element = table.current;
    if (!element) return;
    const origin = element.getBoundingClientRect();
    const before = places.current;
    const now = new Map<string, { left: number; top: number }>();
    for (const deck of element.querySelectorAll<HTMLElement>(".automata-deck")) {
      // A deck's place in the table, so that scrolling between two layouts is no move.
      const place = { left: deck.offsetLeft, top: deck.offsetTop };
      const key = deck.dataset.group!;
      now.set(key, place);
      const from = before.get(key);
      if (still || origin.width === 0 || !from || (from.left === place.left && from.top === place.top)) continue;
      deck.animate([{ transform: `translate(${from.left - place.left}px, ${from.top - place.top}px)` }, { transform: "none" }], { duration: GLIDE_MS, easing: GLIDE_EASING });
    }
    if (origin.width > 0) places.current = now;
  }, [table, order, still]);
}

export function GroupWall<T extends GalleryAutomaton>({ groups, names, status, aside, markOf, loadFace, lead, hidden = false, children }: {
  groups: readonly GalleryGroup<T>[];
  names: BasisGroupNames;
  /** What the wall says in the decks' place while the automata load, or when there is none: null once it has decks. */
  status: string | null;
  /** At the right of the heading: the way to the saved automata. */
  aside?: ReactNode;
  markOf?: (group: GalleryGroup<T>) => ReactNode;
  /** How a face grows; the page supplies it, since a page knows where its files are. Absent: every face is a still. */
  loadFace?: LoadFace<T>;
  /** The owner's view: its line under the heading. A visitor's wall has the heading alone. */
  lead?: ReactNode;
  /** A group's screen is open over the wall: the wall keeps its grown faces and is not displayed. */
  hidden?: boolean;
  children?: ReactNode;
}) {
  const [sort, setSort] = useState<WallSort>("featured");
  const [words, setWords] = useState("");
  const name = (group: number) => nameOf(names, group);
  const ordered = findGroups(sortWall(groups, sort, name), words, name);
  const still = useMediaMatch("(prefers-reduced-motion: reduce)");
  const table = useRef<HTMLOListElement>(null);
  useWallEye(table, !still, !hidden);
  useDecksGlide(table, ordered.map((group) => group.group).join(" "), still);
  const [forward, setForward] = useState<{ group: number; fan: 1 | -1 } | null>(null);
  // Rendering again after a deck is marked as the one that opens puts the passage's names on it before the page changes.
  const [, setMarked] = useState(0);
  const leaving = useRef(0);
  useEffect(() => () => window.clearTimeout(leaving.current), []);
  useEffect(() => { if (hidden) setForward(null); }, [hidden]);

  const look = (group: number, deck: HTMLElement) => {
    window.clearTimeout(leaving.current);
    const wall = table.current?.getBoundingClientRect();
    const box = deck.getBoundingClientRect();
    const fan = wall && box.left + box.width / 2 > wall.left + wall.width / 2 ? -1 : 1;
    setForward((before) => (before?.group === group ? before : { group, fan }));
  };
  const leave = (group: number) => {
    window.clearTimeout(leaving.current);
    leaving.current = window.setTimeout(() => setForward((before) => (before?.group === group ? null : before)), LEAVE_MS);
  };
  const open = (group: number) => {
    rememberOpened(group);
    flushSync(() => setMarked((count) => count + 1));
  };
  const carried = hidden ? null : openedLast();

  return (
    <main className="page automata-wall" hidden={hidden}>
      <header className="automata-wall-head">
        <h1 className="heading">{WORDS.wallTitle}</h1>
        {aside}
        {lead}
        {groups.length > 0 && (
          <div className="automata-wall-tools">
            <input className="input automata-find" type="search" aria-label={WORDS.find} placeholder={WORDS.findPlaceholder} value={words}
              onChange={(event) => setWords(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setWords(""); }} />
            <label className="automata-sort">
              <span className="label">{WORDS.sort}</span>
              <Select value={sort} onChange={(event) => setSort(event.target.value as WallSort)}>
                {WALL_SORTS.map((each) => <option key={each} value={each}>{WORDS.sorts[each]}</option>)}
              </Select>
            </label>
          </div>
        )}
      </header>
      {status !== null && <p className="automata-status" role="status">{status}</p>}
      {status === null && groups.length > 0 && ordered.length === 0 && (
        <p className="automata-status" role="status">{fill(WORDS.findNothing, { words: words.trim() })}</p>
      )}
      <ol ref={table} className="automata-table" data-forward={forward !== null || undefined} data-still={still || undefined}>
        {ordered.map((group) => (
          <Deck key={group.group} group={group} name={nameOf(names, group.group)} mark={markOf?.(group)} loadFace={still ? undefined : loadFace}
            forward={forward?.group === group.group} fan={forward?.group === group.group ? forward.fan : 1}
            carried={carried === group.group} wallHidden={hidden}
            onLook={(deck) => look(group.group, deck)} onLeave={() => leave(group.group)} onOpen={() => open(group.group)} />
        ))}
      </ol>
      {children}
    </main>
  );
}
