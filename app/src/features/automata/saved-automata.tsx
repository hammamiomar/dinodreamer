// The visitor's saved automata, on this device (/automata?group=yours): what Train kept, what Save took
// from a group's stage, and imported files. The same stage plays them and offers Publish beside Export;
// beside it, their pictures, with Import for a file from the device, and Remove for the one that plays. They are read from
// this browser's own store (storage/materials.ts) and never leave it unless the visitor publishes one.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { readFigureMaterial, type FigureMaterial } from "../../materials/material-file";
import { MATERIALS_KEPT_EVENT } from "../../replay/keep-material";
import { MaterialStage, PUBLISHED_SOURCE } from "../../replay/material-stage";
import { deleteMaterial, keepMaterial, keptMaterials } from "../../storage/materials";
import { placeOf, type MaterialEntry } from "../gallery/material-index";
import { keptEntry, withKept } from "./yours";
import { addressSearch, SAVED_GROUP } from "./gallery";

const WORDS = SITE_WORDS.automata;
const SHELF_WORDS = SITE_WORDS.playground;

export interface SavedAutomaton {
  entry: MaterialEntry;
  material: FigureMaterial;
}

export type SavedAutomata =
  | { status: "loading"; automata: SavedAutomaton[] }
  | { status: "ready"; automata: SavedAutomaton[] }
  | { status: "failed"; automata: SavedAutomaton[]; message: string };

/** The saved automata of this device, read again when Save, Import, Remove or Train change them. */
export function useSavedAutomata(): SavedAutomata & { refresh: () => void } {
  const [state, setState] = useState<SavedAutomata>({ status: "loading", automata: [] });
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    let current = true;
    keptMaterials().then(
      (kept) => { if (current) setState({ status: "ready", automata: kept.map((material) => ({ entry: keptEntry(material), material })) }); },
      (error: unknown) => { if (current) setState({ status: "failed", automata: [], message: String(error instanceof Error ? error.message : error) }); },
    );
    return () => { current = false; };
  }, [revision]);
  useEffect(() => {
    window.addEventListener(MATERIALS_KEPT_EVENT, refresh);
    return () => window.removeEventListener(MATERIALS_KEPT_EVENT, refresh);
  }, []);
  return { ...state, refresh };
}

/** The saved automaton the address names, else the first; null when nothing is saved. */
export function savedToPlay(saved: readonly SavedAutomaton[], id: string | null): SavedAutomaton | null {
  return saved.find((each) => each.entry.id === id) ?? saved[0] ?? null;
}

/** A saved automaton's line under its picture: its basis group, then where it starts. */
function savedLine(entry: MaterialEntry): string {
  return `${entry.block} · ${WORDS.startsInLine[placeOf(entry).start]}`;
}

/** Remove asks once more in place; a saved automaton is the visitor's own, so nothing else is touched. */
function Remove({ id, onRemoved }: { id: string; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const remove = () => {
    deleteMaterial(id).then(onRemoved, (error: unknown) => setMessage(String(error instanceof Error ? error.message : error)));
  };
  if (!confirming) return <button type="button" className="link-control" onClick={() => setConfirming(true)}>{SHELF_WORDS.remove}</button>;
  return (
    <>
      <button type="button" className="link-control automata-danger" onClick={remove}>{SHELF_WORDS.removeConfirm}</button>
      <button type="button" className="link-control" onClick={() => setConfirming(false)}>{SHELF_WORDS.removeCancel}</button>
      {message && <span role="alert">{message}</span>}
    </>
  );
}

export function SavedScreen({ saved }: { saved: SavedAutomata & { refresh: () => void } }) {
  const [search, setSearch] = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const playing = savedToPlay(saved.automata, search.get("material"));
  const source = useMemo(() => withKept(saved.automata, PUBLISHED_SOURCE), [saved.automata]);
  const play = (id: string | null) => setSearch(addressSearch({ group: SAVED_GROUP, automaton: id }), { replace: true, preventScrollReset: true });
  const importFile = async (file: File) => {
    try {
      const { file: read } = readFigureMaterial(JSON.parse(await file.text()));
      await keepMaterial(read);
      setMessage("");
      saved.refresh();
      play(read.id);
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error));
    }
  };
  return (
    <main className="automata-group" data-saved>
      <section className="automata-stage" aria-label={WORDS.savedTitle}>
        <header className="automata-head">
          <p className="automata-ways"><Link className="link-control" to="/automata">{WORDS.allGroups}</Link></p>
          <h1 className="automata-title"><span className="display">{WORDS.savedTitle}</span></h1>
        </header>
        {playing && <MaterialStage entry={playing.entry} source={source} publishable />}
      </section>
      <div className="automata-pane automata-saved">
        <p className="automata-saved-line">
          <span className="label">{SHELF_WORDS.yours}</span>
          <span className="automata-saved-count">{saved.automata.length === 0 ? SHELF_WORDS.yoursEmpty : saved.automata.length}</span>
          <button type="button" className="link-control" onClick={() => input.current?.click()}>{SHELF_WORDS.import}</button>
          <input ref={input} type="file" accept=".json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = "";
          }} />
        </p>
        {saved.status === "failed" && <p role="alert">{fill(SHELF_WORDS.yoursFailed, { message: saved.message })}</p>}
        {message && <p role="alert">{message}</p>}
        <ul className="automata-saved-tiles">
          {saved.automata.map(({ entry, material }) => (
            <li key={entry.id}>
              <button type="button" className="automata-cell" aria-pressed={entry.id === playing?.entry.id} onClick={() => play(entry.id)}>
                <img src={material.file.preview} alt="" width={128} height={128} />
                <span className="automata-cell-count">{savedLine(entry)}</span>
              </button>
            </li>
          ))}
        </ul>
        {playing && (
          <div key={playing.entry.id} className="automata-saved-actions" role="group" aria-label={savedLine(playing.entry)}>
            <span>{savedLine(playing.entry)}</span>
            <Remove id={playing.entry.id} onRemoved={() => { saved.refresh(); play(null); }} />
          </div>
        )}
      </div>
    </main>
  );
}
