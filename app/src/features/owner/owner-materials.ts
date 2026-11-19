// The owner API's client, for the owner's Automata page (/admin/automata): the pending, shown and
// hidden automata from GET /admin/api/materials, a pending submission's file, and one action at a
// time (gallery/src/admin.ts). The Worker owns the operations and their rules; this module reads
// its answers and checks them once.

import { readFigureMaterial, type FigureMaterial } from "../../materials/material-file";
import { materialEntry, readMaterialIndex, type MaterialEntry } from "../gallery/material-index";
import { fill, SITE_WORDS } from "../../app/site-words";

const WORDS = SITE_WORDS.owner;

/** The owner's operations on one automaton (POST /admin/api/materials/<action> { id }). */
export type OwnerAction = "hide" | "restore" | "feature" | "unfeature" | "approve" | "reject";

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
 * hidden record without its time for Hide); Reject answers only the id, so null. The
 * Worker answers 409 with its own message when it cannot act.
 */
export async function sendOwnerAction(action: OwnerAction, id: string, fetcher: typeof fetch = fetch): Promise<MaterialEntry | null> {
  const answer = await postMaterialAction(action, id, fetcher);
  if (action === "reject") return null;
  return readMaterialIndex({ entries: [answeredEntry(action, answer)] }).entries[0]!;
}

export async function renameOwnerMaterial(id: string, title: string, credit: string): Promise<MaterialEntry> {
  const response = await fetch("/admin/api/materials/rename", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, title, credit }),
  });
  if (!response.ok) throw new Error(await ownerError(response));
  const { entry } = await response.json();
  return readMaterialIndex({ entries: [entry] }).entries[0]!;
}

export interface MaterialCdnPurge { place: string; prefixes: string[] }

/** Production removal also returns the library prefixes the owner must clear from Cloudflare. */
export async function purgeOwnerMaterial(id: string, fetcher: typeof fetch = fetch): Promise<MaterialCdnPurge | null> {
  return (await postMaterialAction("purge", id, fetcher)).cdnPurge ?? null;
}

async function postMaterialAction(action: OwnerAction | "purge", id: string, fetcher: typeof fetch): Promise<ActionAnswer> {
  const response = await fetcher(`/admin/api/materials/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error(await ownerError(response));
  return response.json();
}

type ActionAnswer = { entry?: unknown; hidden?: unknown; restored?: unknown; cdnPurge?: MaterialCdnPurge | null };

/** Where an action's answer holds the entry: Hide in `hidden`, Restore in `restored`, the others in `entry`. */
function answeredEntry(action: OwnerAction, answer: ActionAnswer): unknown {
  if (action === "hide") return answer.hidden;
  if (action === "restore") return answer.restored;
  return answer.entry;
}

export async function ownerError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    return (JSON.parse(text) as { error?: string }).error ?? fill(WORDS.apiAnswered, { status: response.status });
  } catch {
    return fill(WORDS.apiAnswered, { status: response.status });
  }
}

/**
 * Show research runs on the Automata page (POST /admin/api/research/show): each becomes a published
 * automaton with its place in its basis group's grid. The answer is their entries as the index now lists them.
 */
export async function showResearchRuns(runIds: readonly string[], fetcher: typeof fetch = fetch): Promise<MaterialEntry[]> {
  const response = await fetcher("/admin/api/research/show", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: runIds }),
  });
  if (!response.ok) throw new Error(await ownerError(response));
  const answer = (await response.json()) as { entries?: unknown };
  return readMaterialIndex({ entries: answer.entries }).entries;
}

/**
 * Make a shown automaton the picture of its cell or of its basis group (POST /admin/api/materials/cell-picture
 * or group-picture). The answer is every entry whose mark changed, the chosen one first.
 */
export async function sendPictureMark(mark: "cell-picture" | "group-picture", id: string, fetcher: typeof fetch = fetch): Promise<MaterialEntry[]> {
  const response = await fetcher(`/admin/api/materials/${mark}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error(await ownerError(response));
  const answer = (await response.json()) as { entries?: unknown };
  return readMaterialIndex({ entries: answer.entries }).entries;
}

/** Name a basis group, or clear its name with an empty one (POST /admin/api/basis-groups/name). */
export async function sendGroupName(block: number, name: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/admin/api/basis-groups/name", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ block, name }),
  });
  if (!response.ok) throw new Error(await ownerError(response));
}
