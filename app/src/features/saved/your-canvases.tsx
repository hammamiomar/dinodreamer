// Saved images on this device: reopen, rename, export, delete and import through storage/creations.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useEditorDispatch } from "../../app/editor-session";
import { useLibrary } from "../../app/library-session";
import { validateRecipe } from "../../recipe";
import { RELEASE_NAME } from "../../app/config";
import { deleteCreation, listAllCreations, renameCreation, saveCreation, UPGRADED_IMAGE_REASON } from "../../storage/creations";
import type { SavedCreation, UnreadableCreation } from "../../storage/creations";
import { decodeCreationFile, encodeCreationFile } from "../../storage/recipe-file";
import { beginOpen, openSavedAction } from "../editor/open-creation";
import { downloadBlob, fileStem, useObjectUrl } from "../../ui/files";
import { SAVED_TEXT } from "./saved-text";
import "./saved.css";

type Listing =
  | { status: "loading" }
  /** The readable records, and the ones the current parser refuses, which can still be exported as stored. */
  | { status: "ready"; creations: SavedCreation[]; unreadable: UnreadableCreation[] }
  | { status: "failed"; message: string };

export function YourCanvases() {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  /** The creation still loading after its Open, if any, with its ticket (the open rule, features/editor/state.ts). */
  const [opening, setOpening] = useState<{ id: string; ticket: number } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dispatch = useEditorDispatch();
  const library = useLibrary();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      // One read of the store feeds both lists.
      const { readable: creations, unreadable } = await listAllCreations();
      setListing({ status: "ready", creations, unreadable });
    } catch (error) {
      setListing({ status: "failed", message: messageOf(error) });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs one store operation, then shows the new list or the failure. An operation may return its own notice. */
  const act = async (operation: () => Promise<unknown>, done?: string) => {
    try {
      const result = await operation();
      setNotice(typeof result === "string" ? result : (done ?? null));
    } catch (error) {
      setNotice(messageOf(error));
    }
    await refresh();
  };

  // Leaving the page cancels an open still loading: its late recipe must not replace the canvas.
  useEffect(() => {
    if (!opening) return;
    return () => dispatch({ type: "cancelOpen", ticket: opening.ticket });
  }, [opening, dispatch]);

  const open = async (creation: SavedCreation) => {
    const ticket = beginOpen(dispatch);
    setOpening({ id: creation.id, ticket });
    try {
      // The creation continues from its saved picture (features/editor/open-creation.ts).
      dispatch(await openSavedAction(creation, ticket));
      navigate("/create");
    } catch (error) {
      dispatch({ type: "cancelOpen", ticket });
      setOpening(null);
      setNotice(messageOf(error));
    }
  };

  const exportCreation = async (creation: SavedCreation) => {
    const text = await encodeCreationFile(creation);
    downloadBlob(new Blob([text], { type: "application/json" }), `${fileStem(creation.title)}.dinodreamer.json`);
  };
  /** An unreadable record exports with its recipe exactly as stored, so a later parser or the owner can read it. */
  const exportUnreadable = async (record: UnreadableCreation) => {
    const text = await encodeCreationFile({ ...record, recipe: record.stored });
    downloadBlob(new Blob([text], { type: "application/json" }), `${fileStem(record.title)}.dinodreamer.json`);
  };

  /** Imports a draft as it is; returns what it still needs before it can run. */
  const importFile = async (file: File): Promise<string> => {
    const { title, recipe, previewPng, upgradedFrom, engine, step, placeholder } = decodeCreationFile(await file.text());
    await saveCreation({ title, recipe, previewPng, upgradedFrom, engine, step, placeholder });
    const problems = validateRecipe(recipe, { blocks: library.release.blocks });
    if (problems.length === 0) return SAVED_TEXT.imported(file.name);
    return SAVED_TEXT.importedNeeds(file.name, `${problems.slice(0, 2).join("; ")}${problems.length > 2 ? "; …" : "."}`);
  };

  return (
    <section className="saved" aria-label={SAVED_TEXT.title}>
      <header className="saved-header">
        <h2>{SAVED_TEXT.title}</h2>
        <p className="muted">{SAVED_TEXT.lead}</p>
        <div className="saved-actions">
          <button className="button" onClick={() => importRef.current?.click()}>
            {SAVED_TEXT.importButton}
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void act(() => importFile(file));
            }}
          />
          {notice && (
            <span className="saved-notice" role="status">
              {notice}
            </span>
          )}
        </div>
      </header>

      {listing.status === "loading" && <p className="muted">{SAVED_TEXT.reading}</p>}
      {listing.status === "failed" && <p className="saved-notice">{SAVED_TEXT.failed(listing.message)}</p>}
      {listing.status === "ready" && listing.creations.length === 0 && listing.unreadable.length === 0 && (
        <p className="muted">{SAVED_TEXT.none}</p>
      )}
      {listing.status === "ready" && (
        <div className="saved-list">
          {listing.creations.map((creation) => (
            <CreationCard
              key={creation.id}
              creation={creation}
              opening={opening?.id === creation.id}
              onOpen={() => void open(creation)}
              onRename={(title) => act(() => renameCreation(creation.id, title))}
              onExport={() => act(() => exportCreation(creation))}
              onSaveImage={() => downloadBlob(creation.previewPng, `${fileStem(creation.title)}.png`)}
              onDelete={() => act(() => deleteCreation(creation.id), SAVED_TEXT.deleted(creation.title))}
            />
          ))}
        </div>
      )}
      {listing.status === "ready" && listing.unreadable.length > 0 && (
        <section className="saved-unreadable" aria-label={SAVED_TEXT.unreadable.name}>
          <h2 className="label">{SAVED_TEXT.unreadable.title}</h2>
          <p className="muted">{SAVED_TEXT.unreadable.lead}</p>
          <div className="saved-list">
            {listing.unreadable.map((record) => (
              <UnreadableCard
                key={record.id}
                record={record}
                onExport={() => act(() => exportUnreadable(record))}
                onDelete={() => act(() => deleteCreation(record.id), SAVED_TEXT.deleted(record.title))}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

function CreationCard({
  creation,
  opening,
  onOpen,
  onRename,
  onExport,
  onSaveImage,
  onDelete,
}: {
  creation: SavedCreation;
  /** Its Open is loading: both of its Open controls wait. */
  opening: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onExport: () => void;
  onSaveImage: () => void;
  onDelete: () => void;
}) {
  const imageUrl = useObjectUrl(creation.previewPng);
  return (
    <article className="saved-card">
      <button className="saved-image" onClick={onOpen} disabled={opening} aria-label={SAVED_TEXT.openName(creation.title)}>
        {imageUrl && <img src={imageUrl} alt="" width={256} height={256} />}
      </button>
      <div className="saved-text">
        <TitleField title={creation.title} onRename={onRename} />
        <p className="label saved-meta">
          {new Date(creation.updatedAt).toLocaleString()}
          {creation.engine && SAVED_TEXT.engine(creation.engine)}
        </p>
        {creation.recipe.release !== RELEASE_NAME && (
          <p className="saved-notice">{SAVED_TEXT.otherRelease(creation.recipe.release, RELEASE_NAME)}</p>
        )}
        {creation.upgradedFrom !== undefined && (
          <p className="saved-notice">{SAVED_TEXT.upgraded(UPGRADED_IMAGE_REASON[creation.upgradedFrom])}</p>
        )}
        <div className="saved-card-actions">
          <button className="button primary" onClick={onOpen} disabled={opening}>
            {opening ? SAVED_TEXT.opening : SAVED_TEXT.open}
          </button>
          <button className="link-control" onClick={onExport}>
            {SAVED_TEXT.exportButton}
          </button>
          <button className="link-control" onClick={onSaveImage}>
            {SAVED_TEXT.png}
          </button>
          <DeleteControl onDelete={onDelete} />
        </div>
      </div>
    </article>
  );
}

/** A record the parser refuses: its picture, title and date, why, and Export and Delete alone. */
function UnreadableCard({ record, onExport, onDelete }: { record: UnreadableCreation; onExport: () => void; onDelete: () => void }) {
  const imageUrl = useObjectUrl(record.previewPng);
  return (
    <article className="saved-card">
      <div className="saved-image saved-image-still">{imageUrl && <img src={imageUrl} alt="" width={256} height={256} />}</div>
      <div className="saved-text">
        <h2 className="saved-title">{record.title}</h2>
        <p className="label saved-meta">
          {new Date(record.updatedAt).toLocaleString()}
          {record.engine && SAVED_TEXT.engine(record.engine)}
        </p>
        <p className="saved-notice">{SAVED_TEXT.unreadable.problem(record.problem)}</p>
        <div className="saved-card-actions">
          <button className="button" onClick={onExport}>
            {SAVED_TEXT.exportButton}
          </button>
          <DeleteControl onDelete={onDelete} />
        </div>
      </div>
    </article>
  );
}

/** Keep the confirmation in place for both readable and unreadable saves. */
function DeleteControl({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <button className="link-control" onClick={() => setConfirming(true)}>{SAVED_TEXT.deleteAsk}</button>;
  }
  return <>
    <button className="button danger" onClick={onDelete}>{SAVED_TEXT.deleteConfirm}</button>
    <button className="link-control" onClick={() => setConfirming(false)}>{SAVED_TEXT.keep}</button>
  </>;
}

/** The title as text; click to edit. Enter or leaving the field renames, Escape cancels. */
function TitleField({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <h2 className="saved-title">
        <button onClick={() => setDraft(title)} aria-label={SAVED_TEXT.renameName(title)}>
          {title}
        </button>
      </h2>
    );
  }
  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (next && next !== title) onRename(next);
  };
  return (
    <input
      className="input saved-title-input"
      autoFocus
      value={draft}
      maxLength={80}
      aria-label={SAVED_TEXT.titleField}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
