import { useEffect, useState, type ReactNode } from "react";
import { fetchOwnerCanvases, reviewCanvases, type CanvasCachePurge, type CanvasLists, type CanvasReviewAction, type PublishedCanvas } from "./owner-canvases";

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
      <strong>{entry.title || "Untitled canvas"}</strong>
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
  useEffect(() => {
    let current = true;
    fetchOwnerCanvases().then(
      (next) => { if (current) { setLists(next); setLoadError(""); } },
      (error: unknown) => { if (current) setLoadError(description(error)); },
    ).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [revision]);

  async function act(command: CanvasReviewAction, success: string, confirmation?: string) {
    if (busy || (confirmation && !window.confirm(confirmation))) return;
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

  if (loadError) return <p role="alert">Canvas review could not load. {loadError}{" "}
    <button className="link-control" type="button" disabled={busy} onClick={() => {
      setBusy(true);
      setRevision((previous) => previous + 1);
    }}>Retry</button>
  </p>;
  if (!lists || (!notice && !lists.pending.length && !lists.published.length && !lists.hidden.length)) return null;
  const awaiting = lists.pending.filter((entry) => entry.state === "pending");
  const purgeButton = (entry: PublishedCanvas) => <button className="link-control" type="button" disabled={busy}
    onClick={() => void act({ action: "purge", id: entry.id }, "Canvas purged.", `Permanently delete “${entry.title}”, its picture and its recipe?`)}>Purge</button>;

  return <details className="owner-canvas-review">
    <summary>Canvas review · {lists.pending.length} pending · {lists.published.length} shown · {lists.hidden.length} hidden</summary>
    {notice && <p role="status">{notice}</p>}
    {purges.map(({ place, prefix }) => <p key={prefix}>Clear the cached files at {place} for <code>{prefix}</code>.</p>)}
    <section aria-label="Pending canvases">
      <h3>Pending canvases</h3>
      {awaiting.length > 1 && <button className="link-control" type="button" disabled={busy}
        onClick={() => void act({ action: "approve", ids: awaiting.map((entry) => entry.id) }, "Canvases approved.",
          `Publish all ${awaiting.length} pending canvases?`)}>Approve all</button>}
      <ul>{lists.pending.map((entry) => {
        const unfinished = entry.state === "cleanup unfinished";
        const detail = unfinished ? "Approval cleanup unfinished" :
          [entry.release, entry.submittedAt, entry.blocks === null ? "Recipe missing" : `Basis groups ${entry.blocks.join(", ")}`].join(" · ");
        return <CanvasCard key={entry.id} entry={entry} detail={detail}
          image={unfinished ? thumbnail(entry.id) : `/admin/api/pending/${encodeURIComponent(entry.id)}/image.png`}>
          <button className="link-control" type="button" disabled={busy}
            onClick={() => void act({ action: "approve", ids: [entry.id] }, unfinished ? "Cleanup finished." : "Canvas approved.")}>
            {unfinished ? "Finish cleanup" : "Approve"}
          </button>
          {!unfinished && <button className="link-control" type="button" disabled={busy}
            onClick={() => void act({ action: "reject", id: entry.id }, "Canvas rejected.", `Permanently reject “${entry.title}”?`)}>Reject</button>}
        </CanvasCard>;
      })}</ul>
    </section>
    <section aria-label="Shown canvases">
      <h3>Shown canvases</h3>
      <ul>{lists.published.map((entry) => <CanvasCard key={entry.id} entry={entry} image={thumbnail(entry.id)} detail={`Published ${entry.publishedAt}`}>
        <button className="link-control" type="button" disabled={busy}
          onClick={() => void act({ action: "hide", id: entry.id }, "Canvas hidden.")}>Hide</button>
        {purgeButton(entry)}
      </CanvasCard>)}</ul>
    </section>
    <section aria-label="Hidden canvases">
      <h3>Hidden canvases</h3>
      <ul>{lists.hidden.map((entry) => <CanvasCard key={entry.id} entry={entry} image={thumbnail(entry.id)} detail={`Hidden ${entry.hiddenAt}`}>
        <button className="link-control" type="button" disabled={busy}
          onClick={() => void act({ action: "restore", id: entry.id }, "Canvas restored.")}>Restore</button>
        {purgeButton(entry)}
      </CanvasCard>)}</ul>
    </section>
  </details>;
}
