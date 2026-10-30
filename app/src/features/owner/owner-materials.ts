// The owner API's client for the owner mode of the Playground (/admin/materials): the pending,
// shown and hidden automata from GET /admin/api/materials, a pending submission's file, and one
// action at a time (gallery/src/admin.ts). The Worker owns the operations and their rules; this
// module reads its answers and checks them once. The owner mode's own rules are owner-mode.ts.

import { readFigureMaterial, type FigureMaterial } from "../../materials/material-file";
import { materialEntry, readMaterialIndex, type MaterialEntry } from "../gallery/material-index";
import { fill, SITE_WORDS } from "../../app/site-words";

const WORDS = SITE_WORDS.owner;

/** The owner's operations on one automaton (POST /admin/api/materials/<action> { id }). */
export type OwnerAction = "hide" | "restore" | "feature" | "unfeature" | "purge" | "approve" | "reject";

/** A submission awaiting review, as GET /admin/api/materials lists it. */
export interface PendingSubmission {
  id: string;
  title: string;
  credit: string;
  submittedAt: string;
  block: number;
  materialId: string;
}

/** GET /admin/api/materials, checked: the shown entries in the index's order, the hidden ones with their hiding time. */
export interface OwnerMaterials {
  pending: PendingSubmission[];
  shown: MaterialEntry[];
  hidden: (MaterialEntry & { hiddenAt: string })[];
}

export function readOwnerMaterials(answer: unknown): OwnerMaterials {
  const { pending, published, hidden } = answer as { pending: unknown; published: unknown; hidden: unknown };
  const shown = readMaterialIndex({ entries: published }).entries;
  const away = readMaterialIndex({ entries: hidden }).entries as (MaterialEntry & { hiddenAt?: unknown })[];
  if (!away.every((entry) => typeof entry.hiddenAt === "string")) throw new Error(WORDS.noHidingTime);
  if (!Array.isArray(pending) || !pending.every(isPendingSubmission)) throw new Error(WORDS.badPending);
  return { pending, shown, hidden: away as (MaterialEntry & { hiddenAt: string })[] };
}

function isPendingSubmission(value: unknown): value is PendingSubmission {
  const row = value as Partial<PendingSubmission> | null;
  return typeof row === "object" && row !== null
    && ["id", "title", "credit", "submittedAt", "materialId"].every((key) => typeof row[key as keyof PendingSubmission] === "string")
    && Number.isInteger(row.block);
}

export async function fetchOwnerMaterials(fetcher: typeof fetch = fetch): Promise<OwnerMaterials> {
  const response = await fetcher("/admin/api/materials", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(await ownerError(response));
  return readOwnerMaterials(await response.json());
}

/**
 * A pending submission's file (GET /admin/api/materials/pending/<id>/material.json), checked, with
 * the index entry it will have once approved, so its tile and the stage show it like a published one.
 */
export async function fetchPendingMaterial(submission: PendingSubmission, fetcher: typeof fetch = fetch):
  Promise<{ entry: MaterialEntry; material: FigureMaterial }> {
  const response = await fetcher(`/admin/api/materials/pending/${encodeURIComponent(submission.id)}/material.json`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(await ownerError(response));
  const material = readFigureMaterial(await response.json());
  const entry = materialEntry(submission.id, material.file, { title: submission.title, credit: submission.credit }, submission.submittedAt);
  return { entry, material };
}

/**
 * One owner operation on one automaton. The answer is the entry as the Worker now holds it (the
 * hidden record without its time for Hide); Reject and Purge answer only the id, so null. The
 * Worker answers 409 with its own message when it cannot act.
 */
export async function sendOwnerAction(action: OwnerAction, id: string, fetcher: typeof fetch = fetch): Promise<MaterialEntry | null> {
  const response = await fetcher(`/admin/api/materials/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error(await ownerError(response));
  const answer = (await response.json()) as ActionAnswer;
  if (action === "reject" || action === "purge") return null;
  return readMaterialIndex({ entries: [answeredEntry(action, answer)] }).entries[0]!;
}

type ActionAnswer = { entry?: unknown; hidden?: unknown; restored?: unknown };

/** Where an action's answer holds the entry: Hide in `hidden`, Restore in `restored`, the others in `entry`. */
function answeredEntry(action: OwnerAction, answer: ActionAnswer): unknown {
  if (action === "hide") return answer.hidden;
  if (action === "restore") return answer.restored;
  return answer.entry;
}

async function ownerError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    return (JSON.parse(text) as { error?: string }).error ?? fill(WORDS.apiAnswered, { status: response.status });
  } catch {
    return fill(WORDS.apiAnswered, { status: response.status });
  }
}
