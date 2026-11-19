// This browser's own records of what it did with a kept automaton: the submission it sent for it, and
// the gallery automaton it saved it from. They decide whether a kept file reads as published. A file's
// own id is chosen by whoever wrote the file, so another visitor's automaton that claims the same id
// says nothing about this one. A per-browser convenience: the published index stays the record of what
// is shown, and private mode keeps nothing.

import type { FigureMaterialFile } from "../../materials/material-file";

const SENT_KEY = "dinodreamer.material-submissions";
const SAVED_FROM_KEY = "dinodreamer.material-saved-from";

/** Sent submissions by file id: the submission id the Worker answered, and when. */
export type Sent = Record<string, { id: string; at: string }>;
/** Automata saved from the gallery by file id: the gallery entry they came from, and when. */
export type SavedFrom = Record<string, { entry: string; at: string }>;

export interface PublishRecords {
  sent: Sent;
  savedFrom: SavedFrom;
}

export type PublishState = "published" | "awaiting" | "idle";

/** A stored record map, keeping only entries whose two fields are text; anything else reads as empty. */
function readRecords<Field extends string>(key: string, field: Field): Record<string, Record<Field | "at", string>> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, Record<Field | "at", string>] => {
      const value = entry[1] as Record<string, unknown> | null;
      return value !== null && typeof value === "object" && typeof value[field] === "string" && typeof value.at === "string";
    }));
  } catch { return {}; }
}

function remember(key: string, records: Record<string, unknown>): void {
  try { localStorage.setItem(key, JSON.stringify(records)); } catch { /* Private mode keeps nothing. */ }
}

export function readSubmittedMaterials(): Sent {
  return readRecords(SENT_KEY, "id");
}

export function rememberSent(materialId: string, submissionId: string): void {
  remember(SENT_KEY, { ...readSubmittedMaterials(), [materialId]: { id: submissionId, at: new Date().toISOString() } });
}

export function readSavedFromGallery(): SavedFrom {
  return readRecords(SAVED_FROM_KEY, "entry");
}

export function rememberSavedFrom(materialId: string, entryId: string): void {
  remember(SAVED_FROM_KEY, { ...readSavedFromGallery(), [materialId]: { entry: entryId, at: new Date().toISOString() } });
}

export function readPublishRecords(): PublishRecords {
  return { sent: readSubmittedMaterials(), savedFrom: readSavedFromGallery() };
}

/**
 * Where a kept file stands, from this browser's own records and the published entry ids: published when
 * the gallery automaton it was saved from, or the submission this browser sent for it, is in the index;
 * awaiting when it was sent and is not shown; idle otherwise.
 */
export function publishState(file: FigureMaterialFile, publishedEntryIds: ReadonlySet<string>, records: PublishRecords): PublishState {
  if (Object.hasOwn(records.savedFrom, file.id) && publishedEntryIds.has(records.savedFrom[file.id]!.entry)) return "published";
  if (!Object.hasOwn(records.sent, file.id)) return "idle";
  return publishedEntryIds.has(records.sent[file.id]!.id) ? "published" : "awaiting";
}
