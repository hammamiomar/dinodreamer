import { useEffect, useState, type ReactNode } from "react";
import { fillNodes } from "../../app/fill-nodes";
import { fill, SITE_WORDS } from "../../app/site-words";
import { fetchOwnerCanvases, reviewCanvases, type CanvasCachePurge, type CanvasLists, type CanvasReviewAction, type PublishedCanvas } from "./owner-canvases";

const OWNER = SITE_WORDS.automataOwner;
const WORDS = OWNER.canvasReview;

interface CanvasConfirmation {
  target: string;
  question: string;
  confirmLabel: string;
  command: CanvasReviewAction;
  success: string;
}

const description = (error: unknown) => error instanceof Error ? error.message : String(error);
const thumbnail = (id: string) => `/admin/api/gallery/${encodeURIComponent(id)}/thumbnail.webp`;

function CanvasCard({ entry, image, detail, children }: {
  entry: { title: string; credit: string; id: string };
  image: string;
  detail: string;
  children: ReactNode;
}) {
  return <li className="owner-canvas-card">
    <img src={image} loading="lazy" alt="" width={96} height={96} />
    <div>
      <strong>{entry.title || WORDS.untitled}</strong>
      {entry.credit && <p>{entry.credit}</p>}
      <p>{detail}</p>
      <small>{entry.id}</small>
      <div className="owner-canvas-actions">{children}</div>
    </div>
  </li>;
}

/** Canvas review has its own queue. A failed or empty queue leaves the automata usable. */
export function CanvasReview() {
  const [lists, setLists] = useState<CanvasLists | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [purges, setPurges] = useState<CanvasCachePurge[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    fetchOwnerCanvases().then(
      (next) => { if (current) { setLists(next); setLoadError(""); } },
      (error: unknown) => { if (current) setLoadError(description(error)); },
    ).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [revision]);

  async function act(command: CanvasReviewAction, success: string) {
    if (busy) return;
    setAsking(null);
    setBusy(true);
    try {
      const purge = await reviewCanvases(command);
      if (purge) setPurges((previous) => [...previous, purge]);
      setNotice(success);
    } catch (error) {
      setNotice(description(error));
    } finally {
      // An approval can publish a canvas before its pending files are cleared.
      setRevision((previous) => previous + 1);
    }
  }

  if (loadError) return <p role="alert">{fill(WORDS.loadFailed, { message: loadError })}{" "}
    <button className="link-control" type="button" disabled={busy} onClick={() => {
      setBusy(true);
      setRevision((previous) => previous + 1);
    }}>{WORDS.retry}</button>
  </p>;
  if (!lists || (!notice && !lists.pending.length && !lists.published.length && !lists.hidden.length)) return null;
  const awaiting = lists.pending.filter((entry) => entry.state === "pending");

  function confirmBefore(label: string, request: CanvasConfirmation) {
    if (asking !== request.target) {
      return <button className="link-control" type="button" disabled={busy} onClick={() => setAsking(request.target)}>{label}</button>;
    }
    return <div className="owner-canvas-confirmation">
      <p role="status">{request.question}</p>
      <div className="owner-canvas-actions">
        <button className="link-control" type="button" disabled={busy}
          onClick={() => void act(request.command, request.success)}>{request.confirmLabel}</button>
        <button className="link-control" type="button" onClick={() => setAsking(null)}>{SITE_WORDS.publish.cancel}</button>
      </div>
    </div>;
  }

  const purgeButton = (entry: PublishedCanvas) => confirmBefore(OWNER.actions.purge, {
    target: entry.id,
    question: fill(WORDS.purgeWarning, { title: entry.title || WORDS.untitled }),
    confirmLabel: OWNER.purgeForGood,
    command: { action: "purge", id: entry.id },
    success: WORDS.purged,
  });

  return <details className="owner-canvas-review">
    <summary>{fill(WORDS.summary, { pending: lists.pending.length, shown: lists.published.length, hidden: lists.hidden.length })}</summary>
    {notice && <p role="status">{notice}</p>}
    {purges.map(({ place, prefix }) => <p key={prefix}>{fillNodes(WORDS.clearCache, { place, prefix: <code>{prefix}</code> })}</p>)}
    <section aria-label={WORDS.pending}>
      <h3>{WORDS.pending}</h3>
      {awaiting.length > 1 && confirmBefore(WORDS.approveAll, {
        target: "approve-all",
        question: fill(WORDS.approveAllWarning, { count: awaiting.length }),
        confirmLabel: WORDS.publishAll,
        command: { action: "approve", ids: awaiting.map((entry) => entry.id) },
        success: WORDS.approvedAll,
      })}
      <ul>{lists.pending.map((entry) => {
        const unfinished = entry.state === "cleanup unfinished";
        const groups = entry.blocks === null ? WORDS.recipeMissing : fill(WORDS.basisGroups, { groups: entry.blocks.join(", ") });
        const detail = unfinished ? WORDS.unfinished : [entry.release, entry.submittedAt, groups].join(" · ");
        return <CanvasCard key={entry.id} entry={entry} detail={detail}
          image={unfinished ? thumbnail(entry.id) : `/admin/api/pending/${encodeURIComponent(entry.id)}/image.png`}>
          <button className="link-control" type="button" disabled={busy}
            onClick={() => void act({ action: "approve", ids: [entry.id] }, unfinished ? WORDS.cleanupFinished : WORDS.approved)}>
            {unfinished ? WORDS.finishCleanup : OWNER.approve}
          </button>
          {!unfinished && confirmBefore(OWNER.reject, {
            target: entry.id,
            question: fill(WORDS.rejectWarning, { title: entry.title || WORDS.untitled }),
            confirmLabel: OWNER.rejectForGood,
            command: { action: "reject", id: entry.id },
            success: WORDS.rejected,
          })}
        </CanvasCard>;
      })}</ul>
    </section>
    <section aria-label={WORDS.shown}>
      <h3>{WORDS.shown}</h3>
      <ul>{lists.published.map((entry) => <CanvasCard key={entry.id} entry={entry} image={thumbnail(entry.id)} detail={fill(WORDS.publishedAt, { date: entry.publishedAt })}>
        <button className="link-control" type="button" disabled={busy}
          onClick={() => void act({ action: "hide", id: entry.id }, WORDS.canvasHidden)}>{OWNER.actions.hide}</button>
        {purgeButton(entry)}
      </CanvasCard>)}</ul>
    </section>
    <section aria-label={WORDS.hidden}>
      <h3>{WORDS.hidden}</h3>
      <ul>{lists.hidden.map((entry) => <CanvasCard key={entry.id} entry={entry} image={thumbnail(entry.id)} detail={fill(WORDS.hiddenAt, { date: entry.hiddenAt })}>
        <button className="link-control" type="button" disabled={busy}
          onClick={() => void act({ action: "restore", id: entry.id }, WORDS.restored)}>{WORDS.restore}</button>
        {purgeButton(entry)}
      </CanvasCard>)}</ul>
    </section>
  </details>;
}
