// The Automata page (/automata): the gallery of every basis group. Its address is the state (gallery.ts):
// the wall, one group's screen, or one automaton on that screen. The automata are the published index;
// the owner's names for the groups come with them. The owner's view draws the same wall and the same
// screen over every research run (features/owner/).

import { useMemo, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import type { BasisGroupPanelOutlet } from "../look/basis-group-panel";
import { fill, SITE_WORDS } from "../../app/site-words";
import { MaterialStage, PUBLISHED_SOURCE } from "../../replay/material-stage";
import { fetchPublishedMaterial, materialFileUrl, useMaterialIndex, usePublishedMaterial } from "../gallery/material-gallery";
import { HomeMaterial } from "../home/home-material-view";
import { nameOf, type BasisGroupNames } from "../gallery/basis-groups";
import { useBasisGroupNames } from "./basis-group-names";
import {
  addressSearch, arrangeGroups, automatonToPlay, groupOfAutomaton, neighboursOf, readAddress, SAVED_GROUP, type GalleryAutomaton, type GalleryGroup,
} from "./gallery";
import { frameWordsOf, GroupScreen } from "./group-screen";
import { GroupWall } from "./group-wall";
import { automatonOfEntry, type PublishedAutomaton } from "./published-automata";
import { SavedScreen, useSavedAutomata } from "./saved-automata";
import "./automata.css";

const WORDS = SITE_WORDS.automata;

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

/**
 * A published automaton growing in a card's square: its poster until its file is read and the replay
 * shows, and the poster alone where the browser cannot grow it. Nothing is brushed here; the card opens the group.
 */
function LiveCardPicture({ automaton }: { automaton: PublishedAutomaton }) {
  const file = usePublishedMaterial(automaton.entry.id);
  const [noReplay, setNoReplay] = useState(false);
  return (
    <HomeMaterial entry={automaton.entry} material={file.status === "ready" && !noReplay ? file.value : null} posterUrl={automaton.pictureUrl}
      brush={false} onNoReplay={() => setNoReplay(true)} />
  );
}

export function AutomataPage() {
  const index = useMaterialIndex();
  const names = useBasisGroupNames();
  const groups = useMemo(
    () => arrangeGroups(index.index.entries.map((entry) => automatonOfEntry(entry, materialFileUrl(entry.id, "poster.png")))),
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
    referencePatch: async (block) => (entry !== null && entry.block === block ? (await fetchPublishedMaterial(entry.id)).file.anchor : null),
  }), [entry]);
  const panel: ReactNode = <Outlet context={panelOutlet} />;

  // The saved automata: the address asks for them, or names one of them and no published one (Train's link to a new automaton).
  const namesSaved = address.automaton !== null && saved.automata.some((each) => each.entry.id === address.automaton);
  if (address.group === SAVED_GROUP || (group === null && namesSaved)) return <SavedScreen saved={saved} />;

  if (group === null || playing === null) {
    const missing = typeof address.group === "number" && status === null ? fill(WORDS.unknownGroup, { group: address.group }) : status;
    const savedWay = (
      <Link className="link-control automata-saved-way" to={`/automata${addressSearch({ group: SAVED_GROUP, automaton: null })}`}>
        {saved.automata.length === 0 ? WORDS.savedLine : fill(WORDS.savedLineCount, { count: saved.automata.length })}
      </Link>
    );
    return (
      <GroupWall groups={groups} names={names} status={missing} aside={savedWay} renderLive={(automaton) => <LiveCardPicture automaton={automaton} />}>
        {panel}
      </GroupWall>
    );
  }
  const { automaton } = playing;
  return (
    <GroupScreen group={group} name={nameOf(names, group.group)} neighbours={neighboursOf(groups, group.group)} playing={playing} onChoose={choose}
      stage={<MaterialStage entries={[automaton.entry]} source={PUBLISHED_SOURCE} layout="instrument" frameWords={frameWordsOf(automaton)} />}>
      {panel}
    </GroupScreen>
  );
}
