// The Automata page (/automata): the gallery of every basis group. Its address is the state (gallery.ts):
// the wall, one group's screen, or one automaton on that screen. The automata are the published index;
// the owner's names for the groups come with them. The owner's view draws the same wall and the same
// screen over every research run (features/owner/).

import { useMemo, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import type { BasisGroupPanelOutlet } from "../look/basis-group-panel";
import { fill, SITE_WORDS } from "../../app/site-words";
import { MaterialStage, PUBLISHED_SOURCE } from "../../replay/material-stage";
import { fetchPublishedMaterial, materialFileUrl, useMaterialIndex } from "../gallery/material-gallery";
import { nameOf, type BasisGroupNames } from "../gallery/basis-groups";
import { noAutomatonSearch } from "../atlas/cloud-browser";
import { trainPath } from "../look/strongest-request";
import { useBasisGroupNames } from "./basis-group-names";
import {
  addressSearch, arrangeGroups, automatonToPlay, groupOfAutomaton, neighboursOf, readAddress, SAVED_GROUP, type GalleryAutomaton, type GalleryGroup,
} from "./gallery";
import { gridNoteOf, GroupScreen } from "./group-screen";
import { GroupWall, type LoadFace } from "./group-wall";
import { automatonOfEntry, type PublishedAutomaton } from "./published-automata";
import { SavedScreen, useSavedAutomata } from "./saved-automata";
import "./automata.css";

const WORDS = SITE_WORDS.automata;
/** The basis collection's size, for the wall's count of the groups with an automaton. */
const BASIS_GROUPS = 16384;

/**
 * The group the address opens: the one it names, or the one that holds the automaton it names (a link
 * from before the groups had screens). Null for the wall, and for a group that holds no automaton.
 */
export function useOpenGroup<T extends GalleryAutomaton>(groups: readonly GalleryGroup<T>[]) {
  const [search] = useSearchParams();
  const address = readAddress(search);
  const group = typeof address.group === "number"
    ? groups.find((each) => each.group === address.group) ?? null
    : address.automaton !== null ? groupOfAutomaton(groups, address.automaton) : null;
  return { address, group, playing: group === null ? null : automatonToPlay(group, address.automaton) };
}

/** Plays an automaton of the open group: the address names it, in the same history entry. */
export function useChoose(): (automaton: GalleryAutomaton) => void {
  const navigate = useNavigate();
  const location = useLocation();
  return (automaton) => {
    const search = addressSearch({ group: automaton.group, automaton: automaton.id });
    navigate({ pathname: location.pathname, search }, { replace: true, state: location.state, preventScrollReset: true });
  };
}

/** A published automaton's definition for the wall's face: its file, with the grid and the seed of its published reading. */
const loadPublishedFace: LoadFace<PublishedAutomaton> = async (automaton) => ({
  material: await fetchPublishedMaterial(automaton.entry),
  side: automaton.entry.side,
  seed: automaton.entry.seed,
  tick: automaton.entry.tick,
});

export function AutomataPage() {
  const index = useMaterialIndex();
  const names = useBasisGroupNames();
  const groups = useMemo(
    () => arrangeGroups(index.index.entries.map((entry) => automatonOfEntry(entry, materialFileUrl(entry, "poster.png")))),
    [index.index.entries],
  );
  const status = index.status === "loading" ? WORDS.loading
    : index.status === "failed" ? fill(WORDS.failed, { message: index.message })
    : groups.length === 0 ? WORDS.nothingPublished : null;
  return <PublishedGallery groups={groups} names={names} status={status} />;
}

function PublishedGallery({ groups, names, status }: { groups: GalleryGroup<PublishedAutomaton>[]; names: BasisGroupNames; status: string | null }) {
  const { address, group, playing } = useOpenGroup(groups);
  const choose = useChoose();
  const saved = useSavedAutomata();
  // The basis group panel over this page opens the playing automaton's group on its reference patch.
  const entry = playing?.automaton.entry ?? null;
  const panelOutlet = useMemo<BasisGroupPanelOutlet>(() => ({
    referencePatch: async (block) => (entry !== null && entry.block === block ? (await fetchPublishedMaterial(entry)).file.anchor : null),
  }), [entry]);
  const panel: ReactNode = <Outlet context={panelOutlet} />;

  // The saved automata: the address asks for them, or names one of them and no published one (Train's link to a new automaton).
  const namesSaved = address.automaton !== null && saved.automata.some((each) => each.entry.id === address.automaton);
  if (address.group === SAVED_GROUP || (group === null && namesSaved)) return <SavedScreen saved={saved} />;

  // Keep the wall mounted under the group, so Back restores its sort, filter and scroll position.
  const open = group !== null && playing !== null;
  // A group the address names that has no automaton: the way to train one.
  const missing = typeof address.group === "number" && status === null ? <MissingGroup group={address.group} /> : status;
  const savedWay = (
    <Link className="link-control automata-saved-way" to={{ search: addressSearch({ group: SAVED_GROUP, automaton: null }) }}>
      {saved.automata.length === 0 ? WORDS.savedLine : fill(WORDS.savedLineCount, { count: saved.automata.length })}
    </Link>
  );
  return (
    <>
      <GroupWall groups={groups} names={names} status={open ? null : missing} aside={savedWay} loadFace={loadPublishedFace} hidden={open}
        lead={status === null && <WallCount groups={groups.length} />}>
        {!open && panel}
      </GroupWall>
      {open && (
        <GroupScreen group={group} name={nameOf(names, group.group)} neighbours={neighboursOf(groups, group.group)} playing={playing} onChoose={choose}
          savedCount={saved.automata.length}
          stage={<MaterialStage entry={playing.automaton.entry} source={PUBLISHED_SOURCE} gridNote={gridNoteOf(playing.automaton)} />}>
          {panel}
        </GroupScreen>
      )}
    </>
  );
}

/** The wall's count: how many of the collection's groups have an automaton, and the way to those with none. */
function WallCount({ groups }: { groups: number }) {
  // The Index page it opens is drawn once, as a fresh Index visit's is.
  const [random] = useState(Math.random);
  const none = BASIS_GROUPS - groups;
  return (
    <p className="automata-wall-count">
      {fill(WORDS.wallCount, { count: groups.toLocaleString("en-US"), total: BASIS_GROUPS.toLocaleString("en-US") })}{" "}
      <Link className="link-control" to={`/index${noAutomatonSearch(none, random)}`}>{fill(WORDS.wallNone, { count: none.toLocaleString("en-US") })}</Link>
    </p>
  );
}

/** A group the address names with no automaton: it says so, and offers to train one. */
function MissingGroup({ group }: { group: number }) {
  return (
    <>
      {fill(WORDS.unknownGroup, { group })}{" "}
      {group < BASIS_GROUPS && <Link className="link-control" to={trainPath(group, "")}>{WORDS.unknownGroupTrain}</Link>}
    </>
  );
}
