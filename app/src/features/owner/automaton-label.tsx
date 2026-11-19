import { useState, type FormEvent } from "react";
import type { MaterialEntry } from "../gallery/material-index";
import { renameOwnerMaterial } from "./owner-materials";

export function AutomatonLabel({ entry, busy, setBusy, onSaved }: {
  entry: MaterialEntry;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSaved: (entry: MaterialEntry) => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [credit, setCredit] = useState(entry.credit);
  const [message, setMessage] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const saved = await renameOwnerMaterial(entry.id, title, credit);
      setTitle(saved.title);
      setCredit(saved.credit);
      setMessage("Saved");
      onSaved(saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return <details className="owner-automaton-label">
    <summary>Edit title and credit</summary>
    <form onSubmit={(event) => void save(event)}>
      <label>Automaton title<input value={title} disabled={busy} onChange={(event) => { setTitle(event.target.value); setMessage(""); }} /></label>
      <label>Credit<input value={credit} disabled={busy} onChange={(event) => { setCredit(event.target.value); setMessage(""); }} /></label>
      <button type="submit" className="button" disabled={busy || (title === entry.title && credit === entry.credit)}>Save label</button>
      <span role="status">{message}</span>
    </form>
  </details>;
}
