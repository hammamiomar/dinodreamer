// One basis group's screen: the stage with one automaton playing, beside the group's own patches by
// level, its grid, and the tries of the cell on the stage. Choosing a cell or a try plays it on the
// stage and keeps the address in step, in one history entry: Back leaves the group for the wall.
// The page supplies the stage, since a page knows where its automata's files are (the published
// gallery, or the owner's research runs).

import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { useMediaMatch } from "../../ui/media-match";
import { Segmented } from "../../ui/segmented";
import { BasisGroupLink } from "../look/basis-group-panel";
import { addressSearch, type GalleryAutomaton, type GalleryCell, type GalleryGroup } from "./gallery";
import { GroupGrid } from "./group-grid";
import { GroupLevels } from "./group-levels";
import { TriesStrip } from "./tries-strip";

const WORDS = SITE_WORDS.automata;
/** A phone: the grid is turned and the stage stays at the top of the window (automata.css). */
export const PHONE = "(max-width: 640px)";
/** What a phone shows under the automaton: the group's pictures and grid, or the stage's controls. */
type PhoneView = "gallery" | "controls";
const PHONE_VIEWS = [
  { value: "gallery", label: WORDS.phoneGallery },
  { value: "controls", label: WORDS.phoneControls },
] as const;

/** The state the wall's links carry, so "All basis groups" can return to the wall at the place it was left. */
export const FROM_WALL = { fromWall: true } as const;

/** The frame's two corner lines for an automaton: how it was made, and its grids with the grid's size. */
export function frameWordsOf(automaton: GalleryAutomaton): { label: string; note: (side: number) => string } {
  return {
    label: fill(WORDS.making, { start: WORDS.startsInLine[automaton.place.start], method: WORDS.methods[automaton.place.method] }),
    note: (side) => fill(automaton.grids === "fine" ? WORDS.gridsFine : WORDS.gridsCoarseFine, { side }),
  };
}

/** The line above the number: back to the wall, and the neighbouring groups in the wall's order. */
function GroupWays({ neighbours }: { neighbours: { previous: number | null; next: number | null } }) {
  const location = useLocation();
  const navigate = useNavigate();
  const cameFromWall = (location.state as { fromWall?: boolean } | null)?.fromWall === true;
  return (
    <p className="automata-ways">
      {/* From the wall, the way back is Back: the wall returns at the place it was left. */}
      <Link className="link-control" to={{ search: "" }} onClick={(event) => {
        if (!cameFromWall) return;
        event.preventDefault();
        navigate(-1);
      }}>{WORDS.allGroups}</Link>
      <span>
        {neighbours.previous !== null && <Link className="link-control" to={{ search: addressSearch({ group: neighbours.previous, automaton: null }) }} state={location.state} replace>{WORDS.previousGroup}</Link>}
        {neighbours.next !== null && <Link className="link-control" to={{ search: addressSearch({ group: neighbours.next, automaton: null }) }} state={location.state} replace>{WORDS.nextGroup}</Link>}
      </span>
    </p>
  );
}

export function GroupScreen<T extends GalleryAutomaton>({ group, name, neighbours, playing, stage, onChoose, nameField, paneHead, cellCaption, children }: {
  group: GalleryGroup<T>;
  /** The owner's name for the group, or null when it has none. */
  name: string | null;
  neighbours: { previous: number | null; next: number | null };
  playing: { automaton: T; cell: GalleryCell<T> };
  stage: ReactNode;
  onChoose: (automaton: T) => void;
  /** The owner's view: the field that names the group, in the name's place. */
  nameField?: ReactNode;
  /** The owner's view: its line at the top of the pane, and what a cell says under its picture. */
  paneHead?: ReactNode;
  cellCaption?: (cell: GalleryCell<T>) => string;
  /** The basis group panel's outlet. */
  children?: ReactNode;
}) {
  const phone = useMediaMatch(PHONE);
  const [phoneView, setPhoneView] = useState<PhoneView>("gallery");
  return (
    <main className="automata-group" data-group={group.group} data-phone-view={phone ? phoneView : undefined}>
      <section className="automata-stage" aria-label={String(group.group)}>
        <header className="automata-head">
          <GroupWays neighbours={neighbours} />
          <h1 className="automata-title">
            <span className="display"><BasisGroupLink block={group.group} /></span>
            {nameField ?? (name !== null && <span className="automata-name heading">{name}</span>)}
          </h1>
        </header>
        {stage}
      </section>
      {phone && (
        <div className="automata-phone-views">
          <Segmented<PhoneView> label={WORDS.phoneViewsName} segments={PHONE_VIEWS} value={phoneView} onChange={setPhoneView} />
        </div>
      )}
      <div className="automata-pane" data-owner={paneHead !== undefined || undefined}>
        {paneHead}
        <GroupLevels block={group.group} />
        <GroupGrid group={group} playing={playing.automaton} turned={phone} onChoose={onChoose} cellCaption={cellCaption} />
        <TriesStrip cell={playing.cell} playing={playing.automaton} onChoose={onChoose} />
      </div>
      {children}
    </main>
  );
}
