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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, useNavigation } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { useLibrary } from "../../app/library-session";
import type { AtlasBand } from "../../library/atlas-cloud";
import type { FigureMaterial } from "../../materials/material-file";
import { PATCH_SLOT_OFFSET } from "../../recipe";
import { explorePath } from "../atlas/atlas-position";
import { ATLAS_TEXT } from "../atlas/atlas-text";
import { nameOf, type BasisGroupNames } from "../gallery/basis-groups";
import { BAND_COLOURS } from "../look/strength-bands";
import { LibraryImage } from "../../ui/library-image";
import { useMediaMatch } from "../../ui/media-match";
import { Select } from "../../ui/select";
import { addressSearch, findGroups, pictureOfGroup, shownCount, sortWall, WALL_SORTS, type GalleryAutomaton, type GalleryGroup, type WallSort } from "./gallery";
import { useWallViewport } from "./wall-viewport";
import { useWallPhotos } from "./wall-photos";
import { FROM_WALL } from "./group-screen";
import { openLiveFace, type LiveFace } from "./live-faces";
import { useWallEye } from "./wall-eye";
import { levelPassage, openedLast, rememberOpened, STAGE_PASSAGE } from "./wall-passage";

const WORDS = SITE_WORDS.automata;
/** The plates of a deck, the deepest first: the barely responding level at the bottom, the strongest under the face. */
const LEVELS_DEEPEST_FIRST: readonly AtlasBand[] = [0, 1, 2, 3];
const STRONGEST: AtlasBand = 3;
const PATCHES_PER_SIDE = 16;
/** A face file can exceed 100 kB. Keep route transfers and visible posters ahead of the remaining reads. */
const CONCURRENT_FACE_FILES = 2;
/** The pointer may cross the room between two decks this long before the deck it left goes back down. */
const LEAVE_MS = 180;
/** A deck comes forward once the pointer has rested on it this long, so a pointer crossing the wall moves nothing. */
const ENTER_MS = 140;
/** A deck that changes place, when the wall is sorted or searched, glides there in this time. */
const GLIDE_MS = 420;
const GLIDE_EASING = "cubic-bezier(0.3, 0.9, 0.25, 1)";

/** What a page gives the wall so that a face can grow: the automaton's definition, its grid and its seed. */
/** A face's automaton and the replay its picture was read on: grid side, seed, and the step the face rests at. */
export type LoadFace<T> = (automaton: T) => Promise<{ material: FigureMaterial; side: number; seed: number; tick: number }>;

/** A live deck starts with its real seed. Released or still decks use the published picture. */
function DeckFace<T extends GalleryAutomaton>({ automaton, loadFace, forward, visible, retained, readFile, onFileSettled, wallHidden, carried }: {
  automaton: T;
  /** Absent: the face is the automaton's still. */
  loadFace?: LoadFace<T>;
  /** The reader is on the deck: a face that waits for its turn grows now. */
  forward: boolean;
  visible: boolean;
  retained: boolean;
  readFile: boolean;
  onFileSettled: (url: string) => void;
  wallHidden: boolean;
  carried: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const face = useRef<LiveFace | null>(null);
  const inView = useRef(visible);
  inView.current = visible;
  const side = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);
  const isForward = useRef(forward);
  isForward.current = forward;
  useEffect(() => { if (forward) face.current?.hurry(); }, [forward]);
  const [visited, setVisited] = useState(false);
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const still = !loadFace || !("gpu" in navigator) || failed;
  const state = still || !retained ? "still" : shown ? "live" : "waiting";

  useLayoutEffect(() => {
    if (visible) setVisited(true);
    face.current?.setInView(visible);
  }, [visible]);

  // A retained face can rest away from view. Only a visible deck may start a new replay.
  const keepReplay = retained && (shown || (visible && readFile));
  useLayoutEffect(() => {
    if (!keepReplay || !loadFace || still) return;
    let closed = false;
    loadFace(automaton).then((grown) => {
      if (closed || !canvas.current) return;
      onFileSettled(automaton.pictureUrl);
      side.current = grown.side;
      const opened = openLiveFace(canvas.current, grown.material, grown, {
        onShown: () => setShown(true),
        onFailed: () => setFailed(true),
      });
      opened.setInView(inView.current);
      if (isForward.current) opened.hurry();
      face.current = opened;
    }, () => { if (!closed) { onFileSettled(automaton.pictureUrl); setFailed(true); } });
    return () => {
      closed = true;
      face.current?.close();
      face.current = null;
      setShown(false);
    };
  }, [keepReplay, loadFace, automaton.pictureUrl, onFileSettled, still]);

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
    if (!visible || event.pointerType !== "mouse" || side.current === 0) return;
    const next = cellAt(event);
    if (last.current) face.current?.stroke(last.current, next);
    last.current = next;
  };

  return (
    <span className="automata-deck-face" data-state={state} style={carried ? { viewTransitionName: STAGE_PASSAGE } : undefined}
      onPointerMove={wake} onPointerLeave={() => { last.current = null; }}>
      {(visible || visited) && state === "still" &&
        <img src={automaton.pictureUrl} alt="" width={128} height={128}
          onLoad={still ? () => onFileSettled(automaton.pictureUrl) : undefined}
          onError={still ? () => onFileSettled(automaton.pictureUrl) : undefined} />}
      {retained && !still && <canvas ref={canvas} />}
    </span>
  );
}

/** The places of a forward deck's fanned plates: the level in front at 0, then the others, strongest first. */
export function fanOrder(front: AtlasBand): Record<AtlasBand, number> {
  const behind = [3, 2, 1, 0].filter((band) => band !== front) as AtlasBand[];
  const order = { [front]: 0 } as Record<AtlasBand, number>;
  behind.forEach((band, place) => { order[band] = place + 1; });
  return order;
}

/**
 * The deck's four plates, the group's photographs by level, under the face. The four levels keep their
 * geometry while a visible deck waits for photos. When the deck comes forward the plates fan out beside
 * the face, the strongest level in front and the others behind it, each showing its edge in its colour.
 * A click on a plate behind brings its level to the front; a click on the front plate opens the group.
 */
function DeckPlates({ block, wanted, carried, forward }: {
  block: number; wanted: boolean; carried: boolean; forward: boolean;
}) {
  const library = useLibrary();
  const slots = useWallPhotos(library, block, wanted);
  const [front, setFront] = useState<AtlasBand>(STRONGEST);
  useEffect(() => { if (!forward) setFront(STRONGEST); }, [forward]);
  const order = fanOrder(front);
  return (
    <>
      {LEVELS_DEEPEST_FIRST.map((band) => (
        <span key={band} className="automata-deck-plate" data-front={band === front || undefined}
          title={forward && band !== front ? ATLAS_TEXT.bands[band] : undefined}
          onClick={(event) => {
            if (!forward || band === front) return;
            // A level behind comes to the front; the deck's link does not open.
            event.preventDefault();
            event.stopPropagation();
            setFront(band);
          }}
          style={{ "--depth": STRONGEST - band + 1, "--order": order[band], "--band": BAND_COLOURS[band], viewTransitionName: carried ? levelPassage(band) : undefined } as CSSProperties}>
          {(slots?.[band] ?? []).map((slot, position) => {
            if (slot.kind === "tile") return <span key={position} className="automata-level-picture automata-level-tile" />;
            const patch = slot.picture.slot - PATCH_SLOT_OFFSET;
            return (
              <span key={position} className="automata-level-picture">
                <LibraryImage {...{ fetchpriority: "low" }} src={library.thumbnailUrl(slot.picture.imageId)} alt={ATLAS_TEXT.pictureName(block, ATLAS_TEXT.bands[band])} />
                <i style={{ left: `${((patch % PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100}%`, top: `${(Math.floor(patch / PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100}%` }} />
              </span>
            );
          })}
          <span className="automata-deck-plate-level" aria-hidden="true">{ATLAS_TEXT.bands[band]}</span>
        </span>
      ))}
    </>
  );
}

function Deck<T extends GalleryAutomaton>({ group, name, mark, loadFace, forward, fan, carried, visible, retained, readFile, photosReady, onFileSettled, wallHidden, onLook, onLeave, onOpen }: {
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
  visible: boolean;
  retained: boolean;
  readFile: boolean;
  photosReady: boolean;
  onFileSettled: (url: string) => void;
  wallHidden: boolean;
  /** The reader is on the deck: by the keyboard `now`, by the pointer after it has rested (ENTER_MS). */
  onLook: (deck: HTMLElement, now: boolean) => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  const self = useRef<HTMLLIElement>(null);
  const picture = pictureOfGroup(group);
  const count = shownCount(group.automata);
  return (
    // The pointer's entry and exit belong to the whole deck: a pointer that arrives quickly can land on the
    // list item around the link before the link itself, and the deck must still come forward.
    <li ref={self} className="automata-deck" data-group={group.group} data-forward={forward || undefined} style={{ "--fan": fan } as CSSProperties}
      onPointerEnter={(event) => { if (event.pointerType === "mouse" && self.current) onLook(self.current, false); }} onPointerLeave={onLeave}>
      <Link className="automata-deck-link" to={{ search: addressSearch({ group: group.group, automaton: null }) }} state={FROM_WALL} viewTransition
        aria-label={fill(WORDS.cardName, { group: group.group, name: name ?? "" }).trim()} onClick={onOpen}
        onFocus={() => { if (self.current) onLook(self.current, true); }} onBlur={onLeave}>
        <span className="automata-deck-body">
          <DeckPlates block={group.group} wanted={visible && photosReady} carried={carried} forward={forward} />
          {picture && <DeckFace key={loadFace ? picture.pictureUrl : `poster-${picture.pictureUrl}`} visible={visible} retained={retained} readFile={readFile} onFileSettled={onFileSettled} automaton={picture} loadFace={loadFace} forward={forward} wallHidden={wallHidden} carried={carried} />}
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
  /** A group's screen is open over the wall: the wall keeps its recent faces and scroll position. */
  hidden?: boolean;
  children?: ReactNode;
}) {
  const [sort, setSort] = useState<WallSort>("featured");
  const [words, setWords] = useState("");
  const name = (group: number) => nameOf(names, group);
  const ordered = findGroups(sortWall(groups, sort, name), words, name);
  const still = useMediaMatch("(prefers-reduced-motion: reduce)");
  const table = useRef<HTMLOListElement>(null);
  const order = ordered.map(group => group.group).join(" ");
  const departing = useNavigation().state !== "idle";
  const admitting = !departing && !hidden;
  const { visible, recent } = useWallViewport(table, order, !hidden, departing);
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const onFileSettled = useCallback((url: string) => {
    setSettled(previous => previous.has(url) ? previous : new Set(previous).add(url));
  }, []);
  const missingFiles = ordered.filter(group => {
    if (!visible.has(group.group)) return false;
    const face = pictureOfGroup(group);
    return face !== null && !settled.has(face.pictureUrl);
  });
  const deferred = new Set(missingFiles.slice(CONCURRENT_FACE_FILES).map(group => group.group));
  useWallEye(table, !still && !departing, admitting);
  useDecksGlide(table, order, still);
  const [forward, setForward] = useState<{ group: number; fan: 1 | -1 } | null>(null);
  // Rendering again after a deck is marked as the one that opens puts the passage's names on it before the page changes.
  const [, setMarked] = useState(0);
  const leaving = useRef(0);
  const entering = useRef(0);
  useEffect(() => () => { window.clearTimeout(leaving.current); window.clearTimeout(entering.current); }, []);
  useEffect(() => { if (hidden) setForward(null); }, [hidden]);

  const look = (group: number, deck: HTMLElement, now: boolean) => {
    window.clearTimeout(leaving.current);
    window.clearTimeout(entering.current);
    const come = () => {
      const wall = table.current?.getBoundingClientRect();
      const box = deck.getBoundingClientRect();
      const fan = wall && box.left + box.width / 2 > wall.left + wall.width / 2 ? -1 : 1;
      setForward((before) => (before?.group === group ? before : { group, fan }));
    };
    // A deck already forward stays; another waits until the pointer has rested on it.
    if (now || forward?.group === group) come();
    else entering.current = window.setTimeout(come, ENTER_MS);
  };
  const leave = (group: number) => {
    window.clearTimeout(entering.current);
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
            forward={admitting && forward?.group === group.group} fan={forward?.group === group.group ? forward.fan : 1}
            visible={admitting && visible.has(group.group)} retained={visible.has(group.group) || recent.includes(group.group)} readFile={!deferred.has(group.group)} photosReady={missingFiles.length === 0} onFileSettled={onFileSettled}
            carried={carried === group.group} wallHidden={!admitting}
            onLook={(deck, now) => look(group.group, deck, now)} onLeave={() => leave(group.group)} onOpen={() => open(group.group)} />
        ))}
      </ol>
      {ordered.length > 0 && (
        <nav className="automata-wall-navigation" aria-label={WORDS.wallNavigation}>
          <NavLink to="/" end>{WORDS.homeLink}</NavLink>
          <NavLink to={explorePath()}>{SITE_WORDS.header.explore}</NavLink>
          <NavLink to="/automata">{SITE_WORDS.header.playground}</NavLink>
          <NavLink to="/train">{SITE_WORDS.header.grow}</NavLink>
          <NavLink to="/how" aria-label={SITE_WORDS.header.how}>
            <span className="frame-nav-full">{SITE_WORDS.header.how}</span>
            <span className="frame-nav-short">{SITE_WORDS.header.howShortForm}</span>
          </NavLink>
          <NavLink to="/canvas">{SITE_WORDS.header.experimental}</NavLink>
        </nav>
      )}
      {children}
    </main>
  );
}
