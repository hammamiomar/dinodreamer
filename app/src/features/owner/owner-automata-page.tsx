// The owner's view of the Automata page (/admin/automata): the same wall and the same screen a visitor
// has (features/automata/), over every research run. A run a visitor does not see is present and dim.
// On a group's screen the owner names the group, and under the stage chooses what the public sees:
// show or hide an automaton, make it the picture of its cell or of its group, feature it for the site.
// One switch shows the page exactly as a visitor sees it. Submitted automata wait on a screen of their
// own (owner-pending.tsx). The rules are owner-automata.ts; the Worker serves this page only after its
// owner check and owns every operation (gallery/src/admin.ts).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Outlet, useSearchParams } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { BasisGroupPanelOutlet } from "../look/basis-group-panel";
import { MaterialStage, type MaterialSource } from "../../replay/material-stage";
import { MaterialFrame } from "../../ui/material-frame";
import { Segmented } from "../../ui/segmented";
import { useLoaded } from "../../ui/use-loaded";
import { refreshBasisGroupNames, useBasisGroupNames } from "../automata/basis-group-names";
import { useChoose, useOpenGroup } from "../automata/automata-page";
import { arrangeGroups, neighboursOf, shownCount, type GalleryCell, type GalleryGroup } from "../automata/gallery";
import { gridNoteOf, GroupScreen } from "../automata/group-screen";
import { GroupWall } from "../automata/group-wall";
import { NAME_CHARACTERS, nameOf } from "../gallery/basis-groups";
import { fetchPublishedMaterial, materialFileUrl } from "../gallery/material-gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { fetchPromotedRunEntries, fetchResearchManifest, fetchResearchMaterial, lastStillUrl } from "../research/research-api";
import type { ResearchManifest, ResearchRun } from "../research/research-runs";
import {
  actionsFor, afterChange, ownerAutomata, ownerCounts, requiresConfirmation,
  type OwnerAutomaton, type OwnerAutomatonAction, type OwnerChange, type OwnerRead,
} from "./owner-automata";
import { fetchOwnerMaterials, purgeOwnerMaterial, sendGroupName, sendOwnerAction, sendPictureMark, showResearchRuns, type MaterialCdnPurge, type PendingSubmission } from "./owner-materials";
import { CanvasReview } from "./canvas-review";
import { AutomatonLabel } from "./automaton-label";
import { PENDING_GROUP, PendingScreen } from "./owner-pending";
import "../automata/automata.css";
import "./owner-automata.css";

const WORDS = SITE_WORDS.automataOwner;
const PICTURES = {
  poster: (entry: MaterialEntry) => materialFileUrl(entry, "poster.png"),
  still: (run: ResearchRun) => lastStillUrl(run) ?? "",
};

type PageRead =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; read: OwnerRead; pending: PendingSubmission[] };

/** What the page shows: every run, or exactly what a visitor sees. */
type OwnerView = "every" | "visitor";
const VIEWS = [
  { value: "every", label: WORDS.viewEvery },
  { value: "visitor", label: WORDS.viewVisitor },
] as const;

/** One owner operation on one automaton, and what its answer changes on the page. */
async function send(action: Exclude<OwnerAutomatonAction, "purge">, automaton: OwnerAutomaton): Promise<OwnerChange> {
  switch (action) {
    case "show":
      // A hidden automaton keeps its record and comes back as it was; a run that was never shown is published now.
      if (automaton.state === "hidden") return { shown: [(await sendOwnerAction("restore", automaton.id))!] };
      return { shown: await showResearchRuns([automaton.run!.id]) };
    case "hide":
      return { hidden: [(await sendOwnerAction("hide", automaton.id))!] };
    case "cell-picture":
    case "group-picture":
      return { shown: await sendPictureMark(action, automaton.id) };
    case "feature":
    case "unfeature":
      return { shown: [(await sendOwnerAction(action, automaton.id))!] };
  }
}

export function OwnerAutomataPage() {
  const [page, setPage] = useState<PageRead>({ status: "loading" });
  // The research run index is large and no action changes it: it is read once. The automata's lists are read
  // again after a review, which moves a submission into the published index.
  const [manifest, setManifest] = useState<ResearchManifest | null | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    fetchResearchManifest().then(
      (read) => { if (current) setManifest(read); },
      (error: unknown) => { if (current) setPage({ status: "failed", message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (manifest === undefined) return;
    let current = true;
    const read = async () => {
      const materials = await fetchOwnerMaterials();
      // Files are read only for an automaton whose own id claims a run that has no entry of its own.
      const promotions = await fetchPromotedRunEntries(manifest?.runs ?? [], [...materials.shown, ...materials.hidden]);
      return { materials, promotions };
    };
    read().then(
      ({ materials, promotions }) => {
        if (current) setPage({ status: "ready", read: { shown: materials.shown, hidden: materials.hidden, manifest, promotions }, pending: materials.pending });
      },
      (error: unknown) => { if (current) setPage({ status: "failed", message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { current = false; };
  }, [manifest, revision]);
  if (page.status !== "ready") {
    return (
      <main className="page owner-automata-status">
        {page.status === "loading" ? <p>{WORDS.loading}</p> : <p role="alert">{fill(WORDS.failed, { message: page.message })}</p>}
      </main>
    );
  }
  const change = (next: OwnerChange) => setPage((before) => (before.status === "ready" ? { ...before, read: afterChange(before.read, next) } : before));
  return <OwnerGallery read={page.read} pending={page.pending} onChange={change} onReviewed={() => setRevision((value) => value + 1)} />;
}

function OwnerGallery({ read, pending, onChange, onReviewed }: {
  read: OwnerRead;
  pending: PendingSubmission[];
  onChange: (change: OwnerChange) => void;
  onReviewed: () => void;
}) {
  const names = useBasisGroupNames();
  const [search] = useSearchParams();
  const [view, setView] = useState<OwnerView>("every");
  const { automata, unfiled } = useMemo(() => ownerAutomata(read, PICTURES), [read]);
  const groupTotals = useMemo(() => {
    const totals = new Map<number, number>();
    for (const automaton of automata) totals.set(automaton.group, (totals.get(automaton.group) ?? 0) + 1);
    return totals;
  }, [automata]);
  const visible = useMemo(() => (view === "visitor" ? automata.filter((automaton) => automaton.shown) : automata), [automata, view]);
  const groups = useMemo(() => arrangeGroups(visible), [visible]);
  const { group, playing } = useOpenGroup(groups);
  const choose = useChoose();
  const [busy, setBusy] = useState(false);
  // The last action's result, or the question Purge asks, on the line under the stage's bar.
  const [result, setResult] = useState<{ id: string; text: string } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [cdn, setCdn] = useState<MaterialCdnPurge | null>(null);

  const act = async (action: OwnerAutomatonAction, automaton: OwnerAutomaton) => {
    if (busy) return;
    setBusy(true);
    setAsking(null);
    try {
      if (action === "purge") {
        const purge = await purgeOwnerMaterial(automaton.id);
        if (purge) setCdn((previous) => ({ place: purge.place, prefixes: [...new Set([...(previous?.prefixes ?? []), ...purge.prefixes])] }));
        onChange({ gone: [automaton.id] });
      } else {
        onChange(await send(action, automaton));
      }
      setResult({ id: automaton.id, text: WORDS.results[action] });
    } catch (error) {
      setResult({ id: automaton.id, text: fill(WORDS.actionFailed, { action: WORDS.actions[action], message: error instanceof Error ? error.message : String(error) }) });
    } finally {
      setBusy(false);
    }
  };

  const counts = ownerCounts(automata);
  const ownerLine = (
    <>
      <div className="owner-automata-line">
        <p>
          <span className="label">{WORDS.heading}</span>
          <span>{fill(WORDS.counts, { shown: counts.shown.toLocaleString(), all: counts.all.toLocaleString() })}</span>
          {unfiled > 0 && <span>{fill(WORDS.unfiled, { count: unfiled })}</span>}
          {pending.length > 0 && (
            <Link className="link-control owner-automata-pending" to={{ search: `?group=${PENDING_GROUP}` }}>
              {pending.length === 1 ? WORDS.pendingOne : fill(WORDS.pending, { count: pending.length })}
            </Link>
          )}
        </p>
        <Segmented<OwnerView> label={WORDS.viewsName} segments={VIEWS} value={view} onChange={setView} />
      </div>
      {cdn && <section aria-label={WORDS.clearCachedFiles}>
        <p role="status">{WORDS.clearCachedFiles} {cdn.place}</p>
        <ul>{cdn.prefixes.map((prefix) => <li key={prefix}><code>{prefix}</code></li>)}</ul>
        <button className="link-control" type="button" onClick={() => setCdn(null)}>{WORDS.cacheCleared}</button>
      </section>}
    </>
  );
  const panelOutlet = useMemo<BasisGroupPanelOutlet>(() => ({ referencePatch: async () => null }), []);
  const panel: ReactNode = <Outlet context={panelOutlet} />;

  if (search.get("group") === PENDING_GROUP) return <PendingScreen submissions={pending} onReviewed={onReviewed} />;

  if (group === null || playing === null) {
    return (
      <GroupWall groups={groups} names={names} status={null} lead={<>{ownerLine}<CanvasReview /></>} markOf={(each) => <GroupMark group={each} total={groupTotals.get(each.group) ?? 0} />}>
        {panel}
      </GroupWall>
    );
  }
  const { automaton } = playing;
  const visitor = view === "visitor";
  return (
    <GroupScreen group={group} name={nameOf(names, group.group)} neighbours={neighboursOf(groups, group.group)} playing={playing} onChoose={choose}
      nameField={visitor ? undefined : <NameField key={group.group} block={group.group} name={nameOf(names, group.group) ?? ""} />}
      paneHead={<>
        {ownerLine}
        {!visitor && automaton.state === "shown" && automaton.entry && (
          <AutomatonLabel key={automaton.id} entry={automaton.entry} busy={busy}
            setBusy={setBusy} onSaved={(entry) => onChange({ shown: [entry] })} />
        )}
      </>}
      cellCaption={visitor ? undefined : cellCaption}
      stage={(
        <OwnerStage key={automaton.id} automaton={automaton}
          notice={asking === automaton.id ? WORDS.purgeWarning : result?.id === automaton.id ? result.text : null}
          actions={visitor ? null : (
            <OwnerBlock automaton={automaton} manifest={read.manifest} busy={busy} asking={asking === automaton.id}
              onAsk={(on) => setAsking(on ? automaton.id : null)} onAction={(action) => void act(action, automaton)} />
          )} />
      )}>
      {panel}
    </GroupScreen>
  );
}

/** Per-group published vs total count displayed on each owner wall card. */
function GroupMark({ group, total }: { group: GalleryGroup<OwnerAutomaton>; total: number }) {
  return <span>{fill(WORDS.shownOf, { shown: shownCount(group.automata), all: total })}</span>;
}

/** Under a cell's picture in the owner's grid: how many of its automata a visitor sees. */
function cellCaption(cell: GalleryCell<OwnerAutomaton>): string {
  const shown = shownCount(cell.tries);
  const all = cell.tries.length;
  return shown === 0 ? fill(WORDS.noneShown, { all }) : fill(WORDS.shownOf, { shown, all });
}

/** The field that names the basis group, in the head. Enter or leaving the field stores the name; an empty one clears it. */
function NameField({ block, name }: { block: number; name: string }) {
  const [text, setText] = useState(name);
  const [note, setNote] = useState("");
  // What the Worker holds, as far as this field knows: the name the page read, then each name it stored.
  const [stored, setStored] = useState(name);
  // The page's names arrive after the first render; the field follows them until the owner types.
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    if (typed) return;
    setText(name);
    setStored(name);
  }, [name, typed]);
  const store = () => {
    const next = text.trim();
    if (next === stored) return;
    sendGroupName(block, next).then(
      () => { setStored(next); setNote(WORDS.nameSaved); refreshBasisGroupNames(); },
      (error: unknown) => setNote(fill(WORDS.nameFailed, { message: error instanceof Error ? error.message : String(error) })),
    );
  };
  return (
    <span className="owner-name-field">
      {/* Two lines, as the name stands for a visitor; Enter stores it and does not break the line. */}
      <textarea className="heading" rows={2} value={text} maxLength={NAME_CHARACTERS} aria-label={WORDS.nameLabel} placeholder={WORDS.namePlaceholder}
        onChange={(event) => { setText(event.target.value.replace(/\n/g, " ")); setTyped(true); setNote(""); }}
        onBlur={store}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.currentTarget.blur();
        }} />
      <span className="owner-name-note" role="status">{note}</span>
    </span>
  );
}

/**
 * The stage for one of the owner's automata. A shown or hidden one plays from its public file, as a
 * visitor's does. A run that was never shown plays from the private store: its file is read first,
 * since the stage needs the entry that only the file gives; its still holds the frame meanwhile.
 */
function OwnerStage({ automaton, actions, notice }: { automaton: OwnerAutomaton; actions: ReactNode; notice: string | null }) {
  const { entry, run } = automaton;
  const privateFile = useLoaded(entry === null && run !== null ? run.id : null, () => (entry === null && run !== null ? fetchResearchMaterial(run) : null));
  const source = useMemo<MaterialSource>(() => ({
    load: (played) => (privateFile.status === "ready" ? Promise.resolve(privateFile.value.material) : fetchPublishedMaterial(played)),
    poster: () => automaton.pictureUrl,
    keepable: () => false,
  }), [privateFile, automaton.pictureUrl]);
  const played: MaterialEntry | null = entry ?? (privateFile.status === "ready" ? privateFile.value.entry : null);
  if (played === null) {
    return (
      <section className="material-stage owner-stage-waiting">
        <div className="stage-fit">
          <MaterialFrame>
            <img className="owner-stage-still" src={automaton.pictureUrl} alt="" />
          </MaterialFrame>
        </div>
        {privateFile.status === "failed" && <p className="stage-message" role="alert">{privateFile.message}</p>}
      </section>
    );
  }
  return <MaterialStage entry={played} source={source} gridNote={gridNoteOf(automaton)} ownerActions={actions} notice={notice} />;
}

/**
 * The owner's block under the stage's line: where the automaton stands and the marks it carries, the
 * actions as quiet words, then the run's own facts. Purge asks once more in place.
 */
function OwnerBlock({ automaton, manifest, busy, asking, onAsk, onAction }: {
  automaton: OwnerAutomaton;
  manifest: ResearchManifest | null;
  busy: boolean;
  asking: boolean;
  onAsk: (on: boolean) => void;
  onAction: (action: OwnerAutomatonAction) => void;
}) {
  const { run } = automaton;
  const study = run === null ? undefined : manifest?.studies.find((each) => each.id === run.study);
  const marks = [automaton.cellPicture && WORDS.markCell, automaton.groupPicture && WORDS.markGroup, automaton.siteFeatured && WORDS.markSite].filter(Boolean);
  return (
    <div className="owner-automata-block">
      <p className="owner-automata-state" data-state={automaton.state}>{[WORDS.states[automaton.state], ...marks].join(" ")}</p>
      <p className="stage-words" role="group" aria-label={WORDS.actionsName}>
        {asking ? (
          <>
            <button type="button" className="stage-word owner-automata-danger" disabled={busy} onClick={() => onAction("purge")}>{WORDS.purgeForGood}</button>
            <span aria-hidden="true">·</span>
            <button type="button" className="stage-word" onClick={() => onAsk(false)}>{WORDS.keepIt}</button>
          </>
        ) : actionsFor(automaton).map((action, index) => (
          <span key={action} className="owner-automata-action">
            {index > 0 && <span aria-hidden="true">·</span>}
            <button type="button" className="stage-word" disabled={busy}
              onClick={() => (requiresConfirmation(action) ? onAsk(true) : onAction(action))}>{WORDS.actions[action]}</button>
          </span>
        ))}
      </p>
      {run !== null && (
        <p className="owner-automata-facts">
          <span>{fill(WORDS.runId, { id: run.id })}</span>
          {study && <span>{fill(WORDS.study, { date: study.date, title: study.title })}</span>}
          <span>
            {[
              run.role === null ? "" : WORDS.roles[run.role],
              run.gallery?.target === "other" ? WORDS.otherTarget : "",
              run.outcome.firesAtUpdate === null ? WORDS.neverFired : fill(WORDS.firedAt, { update: run.outcome.firesAtUpdate }),
              run.outcome.holds4000 === null ? "" : run.outcome.holds4000 ? WORDS.holds : WORDS.dissolves,
            ].filter(Boolean).join(" ")}
          </span>
          {run.reading.line && <span>{run.reading.line}</span>}
        </p>
      )}
    </div>
  );
}
