// The owner view shares the Automata stage and shelf, adding pending and hidden entries and
// review actions. Actions update entries in place. The gallery Worker serves this page only
// after checking owner access.

import { Fragment, useEffect, useMemo, useState } from "react";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { MaterialSource } from "../../replay/material-stage";
import type { FigureMaterial } from "../../materials/material-file";
import { fetchPublishedMaterial, materialFileUrl } from "../gallery/material-gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { featuredMaterials } from "../playground/playground";
import { PlaygroundLayout, type LeadingGroup } from "../playground/playground-page";
import { fetchOwnerMaterials, fetchPendingMaterial, sendOwnerAction, type OwnerAction } from "./owner-materials";
import {
  actionsFor, afterAction, requiresConfirmation, featuredGroup, findItem, marksOf, ownerCounts, readShelf,
  type OwnerItem, type OwnerShelf,
} from "./owner-mode";
import "./owner-mode.css";

const WORDS = SITE_WORDS.owner;

/** An action's word at the stage head, its word when it asks once more, and the line beside the bar after it. */
const ACTION_WORDS: Record<OwnerAction, string> = {
  hide: WORDS.hide, restore: WORDS.restore, feature: WORDS.feature, unfeature: WORDS.unfeature,
  purge: WORDS.purge, approve: WORDS.approve, reject: WORDS.reject,
};
const CONFIRM_WORDS: Partial<Record<OwnerAction, { act: string; warning: string }>> = {
  purge: { act: WORDS.purgeForGood, warning: WORDS.purgeWarning },
  reject: { act: WORDS.rejectForGood, warning: WORDS.rejectWarning },
};
const RESULT_WORDS: Record<OwnerAction, string> = {
  hide: WORDS.hidden, restore: WORDS.restored, feature: WORDS.featured, unfeature: WORDS.unfeatured,
  purge: WORDS.purged, approve: WORDS.approved, reject: WORDS.rejected,
};

type OwnerRead =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
    status: "ready";
    shelf: OwnerShelf;
    /** The automata featured when the page was read: the Featured group keeps exactly these. */
    featuredIds: readonly string[];
    /** The pending submissions' files, read with the list: the stage plays them from here. */
    pendingFiles: ReadonlyMap<string, FigureMaterial>;
    /** Why some pending files could not be read, or null. */
    pendingProblem: string | null;
  };

/** The owner API's lists and the pending files, read once per page load. */
async function readOwnerPage(): Promise<Extract<OwnerRead, { status: "ready" }>> {
  const read = await fetchOwnerMaterials();
  const files = await Promise.allSettled(read.pending.map((submission) => fetchPendingMaterial(submission)));
  const pending = files.flatMap((file) => (file.status === "fulfilled" ? [file.value] : []));
  const refused = files.flatMap((file) => (file.status === "rejected" ? [String(file.reason instanceof Error ? file.reason.message : file.reason)] : []));
  return {
    status: "ready",
    shelf: readShelf({ pending: pending.map((file) => file.entry), shown: read.shown, hidden: read.hidden }),
    featuredIds: featuredMaterials(read.shown).map((entry) => entry.id),
    pendingFiles: new Map(pending.map((file) => [file.entry.id, file.material])),
    pendingProblem: refused.length === 0 ? null : fill(WORDS.pendingUnread, { count: refused.length, message: refused[0]! }),
  };
}

/** The stage's source here: a pending automaton from its file, read with the list; the others from the gallery. Nothing is kept from here. */
function ownerSource(pendingFiles: ReadonlyMap<string, FigureMaterial>): MaterialSource {
  return {
    load: (entry) => {
      const file = pendingFiles.get(entry.id);
      return file === undefined ? fetchPublishedMaterial(entry.id) : Promise.resolve(file);
    },
    poster: (entry) => (pendingFiles.has(entry.id) ? `/admin/api/materials/pending/${encodeURIComponent(entry.id)}/poster.png` : materialFileUrl(entry.id, "poster.png")),
    keepable: () => false,
  };
}

export function OwnerMaterialsPage() {
  const [read, setRead] = useState<OwnerRead>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  // The result of the last action, under the stage's bar while that automaton is on the stage.
  const [result, setResult] = useState<{ id: string; text: string } | null>(null);
  // Purge or Reject asking once more: its warning takes the result's line, so asking moves nothing.
  const [asking, setAsking] = useState<{ id: string; action: OwnerAction } | null>(null);

  useEffect(() => {
    let current = true;
    readOwnerPage().then(
      (ready) => { if (current) setRead(ready); },
      (error: unknown) => { if (current) setRead({ status: "failed", message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { current = false; };
  }, []);

  const pendingFiles = read.status === "ready" ? read.pendingFiles : null;
  const source = useMemo(() => ownerSource(pendingFiles ?? new Map()), [pendingFiles]);

  const act = async (action: OwnerAction, item: OwnerItem) => {
    if (busy) return;
    setBusy(true);
    setAsking(null);
    const id = item.entry.id;
    try {
      const answered = await sendOwnerAction(action, id);
      setRead((current) => (current.status === "ready" ? { ...current, shelf: afterAction(current.shelf, id, action, answered) } : current));
      setResult({ id, text: RESULT_WORDS[action] });
    } catch (error) {
      setResult({ id, text: fill(WORDS.actionFailed, { action: ACTION_WORDS[action], message: error instanceof Error ? error.message : String(error) }) });
    } finally {
      setBusy(false);
    }
  };

  if (read.status !== "ready") {
    return (
      <main className="page owner-status">
        {read.status === "loading" ? <p>{WORDS.loading}</p> : <p role="alert">{fill(WORDS.failed, { message: read.message })}</p>}
      </main>
    );
  }
  return (
    <OwnerPlayground read={read} source={source} busy={busy}
      askingFor={(id) => (asking?.id === id ? asking.action : null)}
      onAsk={(id, action) => setAsking(action === null ? null : { id, action })}
      noticeFor={(id) => (asking?.id === id ? CONFIRM_WORDS[asking.action]?.warning ?? null : result?.id === id ? result.text : null)}
      onAction={(action, item) => void act(action, item)} />
  );
}

/** The Playground with the owner's automata: Pending review, the frozen Featured group, every published one with its marks. */
function OwnerPlayground({ read, source, busy, askingFor, onAsk, noticeFor, onAction }: {
  read: Extract<OwnerRead, { status: "ready" }>;
  source: MaterialSource;
  busy: boolean;
  /** The action that asks once more for this automaton, or null. */
  askingFor: (id: string) => OwnerAction | null;
  onAsk: (id: string, action: OwnerAction | null) => void;
  /** The line under the stage's bar: the warning while asking, else the last action's result. */
  noticeFor: (id: string) => string | null;
  onAction: (action: OwnerAction, item: OwnerItem) => void;
}) {
  const { shelf } = read;
  const leadingGroups: LeadingGroup[] = shelf.pending.length === 0
    ? []
    : [{ key: "pending", title: WORDS.pendingGroup, entries: shelf.pending.map((item) => item.entry) }];
  const itemOf = (entry: MaterialEntry) => findItem(shelf, entry.id);
  return (
    <PlaygroundLayout
      entries={shelf.published.map((item) => item.entry)}
      status="ready"
      baseSource={source}
      featured={featuredGroup(shelf, read.featuredIds)}
      leadingGroups={leadingGroups}
      marksOf={(entry) => {
        const item = itemOf(entry);
        return item === undefined ? [] : marksOf(item);
      }}
      stageActions={(entry) => {
        const item = itemOf(entry);
        return (
          <>
            <OwnerSummary read={read} />
            {item && (
              <OwnerActions item={item} busy={busy} asking={askingFor(entry.id)}
                onAsk={(action) => onAsk(entry.id, action)} onAction={(action) => onAction(action, item)} />
            )}
          </>
        );
      }}
      stageNotice={(entry) => noticeFor(entry.id)}
    />
  );
}

/**
 * The owner block's first lines: the mode's name with the link to the owner page, and the counts on
 * two lines of their own that never wrap, so a count's change keeps the block's height.
 */
function OwnerSummary({ read }: { read: Extract<OwnerRead, { status: "ready" }> }) {
  const counts = ownerCounts(read.shelf);
  return (
    <div className="owner-summary">
      <p className="owner-name">
        <span className="label">{WORDS.heading}</span>
        <a className="link-control" href="/admin">{WORDS.ownerPage}</a>
      </p>
      <p className="owner-counts">
        <span>{fill(WORDS.countsShown, counts)}</span>
        <span>{fill(WORDS.countsPending, counts)}</span>
      </p>
      {read.pendingProblem && <p className="owner-problem" role="status">{read.pendingProblem}</p>}
    </div>
  );
}

/**
 * The owner's actions on the automaton on the stage, as the stage's quiet words. Purge and Reject ask
 * once more in place; their warning shows on the line under the stage's bar. A featured automaton
 * says whether the home can show it. Every line keeps its height, filled or blank, so no action and
 * no question changes the block's height (on a phone the shelf follows the stage).
 */
function OwnerActions({ item, busy, asking, onAsk, onAction }: {
  item: OwnerItem;
  busy: boolean;
  asking: OwnerAction | null;
  onAsk: (action: OwnerAction | null) => void;
  onAction: (action: OwnerAction) => void;
}) {
  const confirm = asking === null ? undefined : CONFIRM_WORDS[asking];
  const featuredHere = item.entry.featured === true && (item.state === "shown" || item.state === "approved");
  const choose = (action: OwnerAction) => {
    if (requiresConfirmation(action)) onAsk(action);
    else onAction(action);
  };
  return (
    <div className="owner-actions" role="group" aria-label={WORDS.actionsName}>
      <p className="stage-words">
        {asking === null || confirm === undefined
          ? actionsFor(item).map((action, index) => (
            <Fragment key={action}>
              {index > 0 && <span aria-hidden="true">·</span>}
              <button type="button" className="stage-word" disabled={busy} onClick={() => choose(action)}>{ACTION_WORDS[action]}</button>
            </Fragment>
          ))
          : (
            <>
              <button type="button" className="stage-word owner-danger" disabled={busy} onClick={() => onAction(asking!)}>{confirm.act}</button>
              <span aria-hidden="true">·</span>
              <button type="button" className="stage-word" onClick={() => onAsk(null)}>{WORDS.keepIt}</button>
            </>
          )}
      </p>
      <p className="owner-place">{featuredHere ? WORDS.featuredPlace : ""}</p>
    </div>
  );
}
