// The owner API's research routes for the research page (gallery/src/admin.ts): the run index, a
// run's file and stills, and Promote. The Worker owns the storage and the rules; this module reads
// its answers and checks them once, with the same readers the Worker uses.

import { readFigureMaterial, type FigureMaterial } from "../../materials/material-file";
import { materialEntry, type MaterialEntry } from "../gallery/material-index";
import { fetchOwnerMaterials } from "../owner/owner-materials";
import { readResearchManifest, stillName, type ResearchManifest, type ResearchRun } from "./research-runs";

const API = "/admin/api/research";

/** The run index, or null when nothing is published yet (the Worker answers 404). */
export async function fetchResearchManifest(fetcher: typeof fetch = fetch): Promise<ResearchManifest | null> {
  const response = await fetcher(`${API}/manifest.json`, { headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await answerError(response));
  return readResearchManifest(await response.json());
}

export function stillUrl(run: ResearchRun, tick: number): string {
  return `${API}/runs/${encodeURIComponent(run.id)}/${stillName(tick)}`;
}

/** The still a card and a row show: the last one, where the reading is. Null when the run has none. */
export function lastStillUrl(run: ResearchRun): string | null {
  const tick = run.stills.at(-1);
  return tick === undefined ? null : stillUrl(run, tick);
}

/**
 * A run's file, checked, with the index entry a player needs (its side, seed and kind). The entry
 * is never published: Promote stores the file, and Approve makes the entry.
 */
export async function fetchResearchMaterial(run: ResearchRun, fetcher: typeof fetch = fetch): Promise<{ entry: MaterialEntry; material: FigureMaterial }> {
  const response = await fetcher(`${API}/runs/${encodeURIComponent(run.id)}/material.json`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(await answerError(response));
  const material = readFigureMaterial(await response.json());
  const entry = materialEntry(run.id, material.file, { title: material.file.name, credit: "" }, "");
  return { entry, material };
}

/** Where a run is on the site: pending review, published, hidden, or nowhere (absent from the map). */
export type SitePlace = "pending" | "shown" | "hidden";

/** Each research run's place on the site, by its file id, which is the run's id (gallery/src/research.ts). */
export async function fetchSitePlaces(fetcher: typeof fetch = fetch): Promise<Map<string, SitePlace>> {
  const { pending, shown, hidden } = await fetchOwnerMaterials(fetcher);
  return new Map<string, SitePlace>([
    ...hidden.map((entry) => [entry.materialId, "hidden"] as const),
    ...shown.map((entry) => [entry.materialId, "shown"] as const),
    ...pending.map((submission) => [submission.materialId, "pending"] as const),
  ]);
}

/** Promote a run under a public title; the answer is the pending submission's id. */
export async function promoteRun(run: ResearchRun, title: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(`${API}/promote`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: run.id, title }),
  });
  if (!response.ok) throw new Error(await answerError(response));
  const answer = (await response.json()) as { pending?: { id?: unknown } };
  if (typeof answer.pending?.id !== "string") throw new Error("the Worker's answer names no pending automaton");
  return answer.pending.id;
}

async function answerError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : `the owner API answered ${response.status}`;
}
