// The Painter's gallery, a section of its page (features/landing/canvas-page.tsx): approved
// creations, a detail view that opens a recipe in the Painter, and the form that submits one of
// the visitor's saved creations. Materials have their own page, the Playground.
// The selected entry lives in the URL (?entry=<id>), so Back closes it.

import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ASSET_BASE_URL, TURNSTILE_SITE_KEY } from "../../app/config";
import { useEditorDispatch } from "../../app/editor-session";
import { useLibrary } from "../../app/library-session";
import { listCreations } from "../../storage/creations";
import type { SavedCreation } from "../../storage/creations";
import { useObjectUrl } from "../../ui/files";
import { LibraryImage } from "../../ui/library-image";
import { beginOpen, openGalleryAction } from "../editor/open-creation";
import { creationProblems, fetchGallery, SUBMISSION_LIMITS, submissionProblems, submitCreation } from "./gallery-api";
import type { GalleryEntry } from "./gallery-api";
import { GALLERY_TEXT } from "./gallery-text";
import { TurnstileCheck } from "./turnstile";
import "./gallery.css";

type Loaded<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "failed"; message: string };

export function GallerySection() {
  const [gallery, setGallery] = useState<Loaded<GalleryEntry[]>>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useSearchParams();

  useEffect(() => {
    const assetBase = new URL(`${ASSET_BASE_URL}/`, window.location.href);
    fetchGallery(assetBase).then(
      (value) => setGallery({ status: "ready", value }),
      (error: unknown) => setGallery({ status: "failed", message: messageOf(error) }),
    );
  }, []);

  const selectedId = search.get("entry");
  const selected = gallery.status === "ready" ? gallery.value.find((entry) => entry.id === selectedId) : undefined;

  return (
    <section className="gallery" aria-label={GALLERY_TEXT.title}>
      <header className="gallery-header">
        <h2 className="heading">{GALLERY_TEXT.title}</h2>
        <p className="muted">{GALLERY_TEXT.lead}</p>
        <button className="button" onClick={() => setSubmitting(!submitting)} aria-expanded={submitting}>
          {GALLERY_TEXT.submit}
        </button>
      </header>

      {submitting && <SubmitPanel onClose={() => setSubmitting(false)} />}

      {gallery.status === "loading" && <p className="muted">{GALLERY_TEXT.loading}</p>}
      {gallery.status === "failed" && <p className="gallery-problem">{GALLERY_TEXT.failed(gallery.message)}</p>}
      {gallery.status === "ready" && gallery.value.length === 0 && <p className="muted">{GALLERY_TEXT.empty}</p>}
      {gallery.status === "ready" && (
        <div className="gallery-grid">
          {gallery.value.map((entry) => (
            <button key={entry.id} className="gallery-card" onClick={() => setSearch({ entry: entry.id }, { preventScrollReset: true })}>
              <GalleryPicture entry={entry} />
              <span className="gallery-card-title">{entry.title}</span>
              {entry.credit && <span className="muted">{entry.credit}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Opening and closing an entry is a navigation (Back closes it), but the page behind keeps its place. */}
      {selected && <EntryDetail entry={selected} onClose={() => setSearch({}, { replace: true, preventScrollReset: true })} />}
    </section>
  );
}

/** The tile's picture: the thumbnail, or the PNG when the index has none or the thumbnail fails to load. */
function GalleryPicture({ entry }: { entry: GalleryEntry }) {
  const [failed, setFailed] = useState<string | null>(null);
  const thumbnail = entry.thumbnailUrl !== null && failed !== entry.thumbnailUrl ? entry.thumbnailUrl : null;
  const shown = thumbnail ?? entry.imageUrl;
  return <LibraryImage src={shown} alt="" loading="lazy" width={256} height={256} onError={() => shown === thumbnail && setFailed(thumbnail)} />;
}

/**
 * An entry's detail as a native modal dialog (the WAI-ARIA modal pattern): showModal keeps
 * focus inside and makes the page behind inert. Focus starts on the title, not on "Open
 * recipe", which replaces the visitor's canvas. Escape cancels through the same close as
 * the button and Back (the route), and closing gives focus back to what opened it.
 */
function EntryDetail({ entry, onClose }: { entry: GalleryEntry; onClose: () => void }) {
  const dispatch = useEditorDispatch();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  /** The open still loading, if any: its ticket (open-creation.ts) and the abort of its fetches. */
  const [opening, setOpening] = useState<{ ticket: number; abort: AbortController } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    title.current?.focus();
    return () => {
      element.close();
      opener?.focus();
    };
  }, []);

  // Closing the dialog, or showing another entry, cancels an open still loading: its late
  // recipe must not replace the canvas (the open rule, features/editor/state.ts).
  useEffect(() => {
    if (!opening) return;
    return () => {
      opening.abort.abort();
      dispatch({ type: "cancelOpen", ticket: opening.ticket });
    };
  }, [opening, entry.id, dispatch]);

  const openRecipe = async () => {
    const abort = new AbortController();
    const ticket = beginOpen(dispatch);
    setOpening({ ticket, abort });
    setProblem(null);
    const fetcher: typeof fetch = (input, init) => fetch(input, { ...init, signal: abort.signal });
    try {
      // The entry opens on its published picture, so Run continues from it (open-creation.ts).
      const action = await openGalleryAction(entry, ticket, fetcher);
      if (abort.signal.aborted) return;
      dispatch(action);
      navigate("/create");
    } catch (error) {
      if (abort.signal.aborted) return;
      dispatch({ type: "cancelOpen", ticket });
      setOpening(null);
      setProblem(messageOf(error));
    }
  };

  return (
    <dialog
      ref={dialog}
      className="gallery-detail"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: the route closes the dialog, so the URL and Back stay in step.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // The dialog has no padding of its own: a click on the dialog element is a click on the backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="gallery-detail-body">
        <LibraryImage src={entry.imageUrl} alt={entry.title} width={512} height={512} />
        <div className="gallery-detail-text">
          <h2 id={titleId} ref={title} tabIndex={-1}>
            {entry.title}
          </h2>
          {entry.credit && <p>{GALLERY_TEXT.detail.by(entry.credit)}</p>}
          <p className="muted">{GALLERY_TEXT.detail.published(new Date(entry.publishedAt).toLocaleDateString())}</p>
          <div className="gallery-detail-actions">
            <button className="button primary" disabled={opening !== null} onClick={() => void openRecipe()}>
              {opening ? GALLERY_TEXT.detail.opening : GALLERY_TEXT.detail.open}
            </button>
            <button className="button" onClick={onClose}>
              {GALLERY_TEXT.detail.close}
            </button>
          </div>
          {problem && <p className="gallery-problem">{problem}</p>}
          <p className="muted gallery-note">{GALLERY_TEXT.detail.note}</p>
        </div>
      </div>
    </dialog>
  );
}

type SubmitState = { status: "editing" } | { status: "sending" } | { status: "sent"; id: string } | { status: "failed"; message: string };

/**
 * Choose one saved creation, give it a title and an optional credit, and send it
 * for review. With a Turnstile site key, the visitor must also pass the check.
 */
function SubmitPanel({ onClose }: { onClose: () => void }) {
  const [creations, setCreations] = useState<Loaded<SavedCreation[]>>({ status: "loading" });
  const [chosen, setChosen] = useState<SavedCreation | null>(null);
  const [title, setTitle] = useState("");
  const [credit, setCredit] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "editing" });
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // The Worker spends a token on one post, so each attempt gets a new check.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    listCreations().then(
      (value) => setCreations({ status: "ready", value }),
      (error: unknown) => setCreations({ status: "failed", message: messageOf(error) }),
    );
  }, []);

  const library = useLibrary();
  const submission = chosen ? { image: chosen.previewPng, recipe: chosen.recipe, title, credit, engine: chosen.engine } : null;
  const problems = chosen && submission ? [...creationProblems(chosen), ...submissionProblems(submission, { blocks: library.release.blocks })] : [];
  const checkPending = TURNSTILE_SITE_KEY !== "" && turnstileToken === null;

  const send = async () => {
    if (!submission || problems.length > 0 || checkPending) return;
    setState({ status: "sending" });
    try {
      setState({ status: "sent", ...(await submitCreation(submission, turnstileToken)) });
    } catch (error) {
      setState({ status: "failed", message: messageOf(error) });
      setTurnstileToken(null);
      setAttempt(attempt + 1);
    }
  };

  if (state.status === "sent") {
    return (
      <section className="submit-panel">
        <p>{GALLERY_TEXT.form.sent} <span className="mono">{state.id}</span></p>
        <button className="button" onClick={onClose}>
          {GALLERY_TEXT.form.close}
        </button>
      </section>
    );
  }

  return (
    <section className="submit-panel" aria-label={GALLERY_TEXT.form.title}>
      <h2>{GALLERY_TEXT.form.title}</h2>
      {creations.status === "loading" && <p className="muted">{GALLERY_TEXT.form.reading}</p>}
      {creations.status === "failed" && <p className="gallery-problem">{creations.message}</p>}
      {creations.status === "ready" && creations.value.length === 0 && (
        <p className="muted">{GALLERY_TEXT.form.none}</p>
      )}
      {creations.status === "ready" && creations.value.length > 0 && (
        <>
          <div className="submit-choices" role="radiogroup" aria-label={GALLERY_TEXT.form.choices}>
            {creations.value.map((creation) => (
              <SubmitChoice
                key={creation.id}
                creation={creation}
                chosen={creation.id === chosen?.id}
                onChoose={() => {
                  setChosen(creation);
                  setTitle(creation.title.slice(0, SUBMISSION_LIMITS.titleCharacters));
                }}
              />
            ))}
          </div>
          {chosen && (
            <form
              className="submit-form"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label>
                {GALLERY_TEXT.form.titleField}
                <input className="input" value={title} maxLength={SUBMISSION_LIMITS.titleCharacters} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label>
                {GALLERY_TEXT.form.credit} <span className="muted">{GALLERY_TEXT.form.creditNote}</span>
                <input className="input" value={credit} maxLength={SUBMISSION_LIMITS.creditCharacters} onChange={(event) => setCredit(event.target.value)} />
              </label>
              {problems.length > 0 && (
                <ul className="gallery-problem">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
              <p className="muted gallery-note">{GALLERY_TEXT.form.public}</p>
              {TURNSTILE_SITE_KEY && <TurnstileCheck key={attempt} siteKey={TURNSTILE_SITE_KEY} onToken={setTurnstileToken} />}
              <div className="gallery-detail-actions">
                <button className="button primary" disabled={problems.length > 0 || checkPending || state.status === "sending"}>
                  {state.status === "sending" ? GALLERY_TEXT.form.sending : GALLERY_TEXT.form.send}
                </button>
                <button type="button" className="button" onClick={onClose}>
                  {GALLERY_TEXT.form.cancel}
                </button>
              </div>
              {state.status === "failed" && <p className="gallery-problem">{state.message}</p>}
            </form>
          )}
        </>
      )}
    </section>
  );
}

function SubmitChoice({ creation, chosen, onChoose }: { creation: SavedCreation; chosen: boolean; onChoose: () => void }) {
  const imageUrl = useObjectUrl(creation.previewPng);
  return (
    <button type="button" className="submit-choice" role="radio" aria-checked={chosen} onClick={onChoose}>
      {imageUrl && <img src={imageUrl} alt="" width={96} height={96} />}
      <span>{creation.title}</span>
    </button>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
