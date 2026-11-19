import { ownerError } from "./owner-materials";

interface CanvasRecord {
  id: string;
  title: string;
  credit: string;
}

export interface PendingCanvas extends CanvasRecord {
  submittedAt: string;
  release: string;
  blocks: number[] | null;
  state: "pending" | "cleanup unfinished";
}

export interface PublishedCanvas extends CanvasRecord {
  publishedAt: string;
}

export interface CanvasLists {
  pending: PendingCanvas[];
  published: PublishedCanvas[];
  hidden: (PublishedCanvas & { hiddenAt: string })[];
}

export type CanvasReviewAction =
  | { action: "approve"; ids: string[] }
  | { action: "reject" | "hide" | "restore" | "purge"; id: string };

export interface CanvasCachePurge { place: string; prefix: string }

export async function fetchOwnerCanvases(): Promise<CanvasLists> {
  const response = await fetch("/admin/api/entries", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(await ownerError(response));
  const { pending, published, hidden } = await response.json();
  const lists = [pending, published, hidden];
  if (!lists.every((list) => Array.isArray(list) && list.every((row) =>
    row && typeof row.id === "string" && typeof row.title === "string" && typeof row.credit === "string"))) {
    throw new Error("Invalid canvas review lists.");
  }
  if (!pending.every((row: PendingCanvas) =>
    (row.state === "pending" || row.state === "cleanup unfinished") &&
    (row.blocks === null || (Array.isArray(row.blocks) && row.blocks.every(Number.isInteger))))) {
    throw new Error("Invalid pending canvas.");
  }
  return { pending, published, hidden };
}

export async function reviewCanvases(command: CanvasReviewAction): Promise<CanvasCachePurge | null> {
  const { action, ...body } = command;
  const response = await fetch(`/admin/api/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await ownerError(response));
  if (action !== "purge") return null;
  const { cdnPurge } = await response.json();
  return cdnPurge;
}
