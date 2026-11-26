// The review of submitted automata, in the owner's view of the Automata page (/admin/automata?group=pending):
// the automata visitors sent, each played on the same stage from its stored file, with Approve and Reject.
// Approve publishes one as any other automaton, and it takes its place in its basis group's grid from
// its file's start and loss. Reject deletes the submission, so it asks once more in place.

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { FigureMaterial } from "../../materials/material-file";
import { MaterialStage, type MaterialSource } from "../../replay/material-stage";
import { addressSearch } from "../automata/gallery";
import { placeOf, type MaterialEntry } from "../gallery/material-index";
import { fetchPendingMaterial, sendOwnerAction, type PendingSubmission } from "./owner-materials";

const WORDS = SITE_WORDS.automataOwner;
/** The review's place in the address, beside a basis group's number. */
export const PENDING_GROUP = "pending";

interface PendingAutomaton {
  submission: PendingSubmission;
  entry: MaterialEntry;
  material: FigureMaterial;
}

type PendingRead =
  | { status: "loading" }
  | { status: "ready"; automata: PendingAutomaton[]; unread: string[] };

/** The submissions' files, read once with the screen: the stage plays a pending automaton from its file. */
function usePendingAutomata(submissions: readonly PendingSubmission[]): PendingRead {
  const [read, setRead] = useState<PendingRead>({ status: "loading" });
  useEffect(() => {
    let current = true;
    void Promise.allSettled(submissions.map(async (submission) => ({ submission, ...(await fetchPendingMaterial(submission)) }))).then((files) => {
      if (!current) return;
      setRead({
        status: "ready",
        automata: files.flatMap((file) => (file.status === "fulfilled" ? [file.value] : [])),
        unread: files.flatMap((file) => (file.status === "rejected" ? [String(file.reason instanceof Error ? file.reason.message : file.reason)] : [])),
      });
    });
    return () => { current = false; };
  }, [submissions]);
  return read;
}

const posterOf = (id: string) => `/admin/api/materials/pending/${encodeURIComponent(id)}/poster.png`;

export function PendingScreen({ submissions, onReviewed }: {
  submissions: readonly PendingSubmission[];
  /** A submission was approved or rejected: the page reads its lists again. */
  onReviewed: () => void;
}) {
  const [search, setSearch] = useSearchParams();
  const read = usePendingAutomata(submissions);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<{ text: string; group: number | null } | null>(null);
  const automata = read.status === "ready" ? read.automata : [];
  const playing = automata.find((each) => each.submission.id === search.get("material")) ?? automata[0] ?? null;
  const source = useMemo<MaterialSource>(() => ({
    load: (entry) => {
      const found = automata.find((each) => each.entry.id === entry.id);
      return found ? Promise.resolve(found.material) : Promise.reject(new Error(`no submission ${entry.id}`));
    },
    poster: (entry) => posterOf(entry.id),
    keepable: () => false,
  }), [automata]);
  const play = (id: string) => {
    setAsking(false);
    setSearch({ group: PENDING_GROUP, material: id }, { replace: true, preventScrollReset: true });
  };

  const review = async (action: "approve" | "reject", automaton: PendingAutomaton) => {
    if (busy) return;
    setBusy(true);
    setAsking(false);
    try {
      await sendOwnerAction(action, automaton.submission.id);
      setResult(action === "approve" ? { text: fill(WORDS.approved, { group: automaton.entry.block }), group: automaton.entry.block } : { text: WORDS.rejected, group: null });
      onReviewed();
    } catch (error) {
      setResult({ text: fill(WORDS.actionFailed, { action: action === "approve" ? WORDS.approve : WORDS.reject, message: error instanceof Error ? error.message : String(error) }), group: null });
    } finally {
      setBusy(false);
    }
  };

  const actions = playing && (
    <div className="owner-automata-block">
      <p className="owner-automata-state">
        {fill(WORDS.pendingBy, { title: playing.submission.title || WORDS.pendingUntitled, credit: playing.submission.credit || WORDS.pendingAnonymous })}
      </p>
      <p className="stage-words" role="group" aria-label={WORDS.actionsName}>
        {asking ? (
          <>
            <button type="button" className="stage-word owner-automata-danger" disabled={busy} onClick={() => void review("reject", playing)}>{WORDS.rejectForGood}</button>
            <span aria-hidden="true">·</span>
            <button type="button" className="stage-word" onClick={() => setAsking(false)}>{WORDS.keepIt}</button>
          </>
        ) : (
          <>
            <button type="button" className="stage-word" disabled={busy} onClick={() => void review("approve", playing)}>{WORDS.approve}</button>
            <span aria-hidden="true">·</span>
            <button type="button" className="stage-word" disabled={busy} onClick={() => setAsking(true)}>{WORDS.reject}</button>
          </>
        )}
      </p>
    </div>
  );

  return (
    <main className="automata-group" data-pending>
      <section className="automata-stage" aria-label={WORDS.pendingTitle}>
        <header className="automata-head">
          <p className="automata-ways"><Link className="link-control" to={{ search: "" }}>{SITE_WORDS.automata.allGroups}</Link></p>
          <h1 className="automata-title"><span className="display">{WORDS.pendingTitle}</span></h1>
        </header>
        {playing && (
          <MaterialStage key={playing.submission.id} entry={playing.entry} source={source} ownerActions={actions}
            notice={asking ? WORDS.rejectWarning : null} />
        )}
      </section>
      <div className="automata-pane automata-saved">
        <p className="automata-saved-line">
          <span className="label">{WORDS.pendingLine}</span>
          <span className="automata-saved-count">{read.status === "ready" && automata.length === 0 ? WORDS.pendingNone : automata.length}</span>
        </p>
        {result && (
          <p className="owner-pending-result" role="status">
            {result.text}{" "}
            {result.group !== null && <Link className="link-control" to={{ pathname: "/admin/automata", search: addressSearch({ group: result.group, automaton: null }) }}>{result.group}</Link>}
          </p>
        )}
        {read.status === "ready" && read.unread.length > 0 && (
          <p className="owner-pending-result" role="status">{fill(WORDS.pendingUnread, { count: read.unread.length, message: read.unread[0]! })}</p>
        )}
        <ul className="automata-saved-tiles">
          {automata.map(({ submission, entry }) => (
            <li key={submission.id}>
              <button type="button" className="automata-cell" aria-pressed={submission.id === playing?.submission.id} onClick={() => play(submission.id)}>
                <img src={posterOf(submission.id)} alt="" width={128} height={128} />
                <span className="automata-cell-count">
                  {fill(WORDS.pendingTile, { group: entry.block, start: SITE_WORDS.automata.startsInLine[placeOf(entry).start] })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
