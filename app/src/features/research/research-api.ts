// The owner API's research routes for the owner's Automata page (gallery/src/admin.ts): the run
// index, and a run's file and stills. The Worker owns the storage and the rules; this module reads
// its answers and checks them once, with the same readers the Worker uses.

import { readFigureMaterial, type FigureMaterial } from "../../materials/material-file";
import { materialFileUrl } from "../gallery/material-gallery";
import { materialEntry, type MaterialEntry } from "../gallery/material-index";
import {
  definitionRule, promotedRunEntries, readResearchManifest, stillName, type DefinitionRule, type ResearchManifest, type ResearchRun,
} from "./research-runs";

const API = "/admin/api/research";

/** The run index, or null when nothing is published yet (the Worker answers 404). */
export async function fetchResearchManifest(fetcher: typeof fetch = fetch): Promise<ResearchManifest | null> {
  const response = await fetcher(`${API}/manifest.json`, { headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await answerError(response));
  return readResearchManifest(await response.json());
}

function stillUrl(run: ResearchRun, tick: number): string {
  return `${API}/runs/${encodeURIComponent(run.id)}/${stillName(tick)}`;
}

/** The still a card and a row show: the last one, where the reading is. Null when the run has none. */
export function lastStillUrl(run: ResearchRun): string | null {
  const tick = run.stills.at(-1);
  return tick === undefined ? null : stillUrl(run, tick);
}

/**
 * A run's file, checked, with the index entry a player needs (its side, seed and kind). The entry
 * is never published: showing the run on the Automata page publishes its own.
 */
export async function fetchResearchMaterial(run: ResearchRun, fetcher: typeof fetch = fetch): Promise<{ entry: MaterialEntry; material: FigureMaterial }> {
  const response = await fetcher(`${API}/runs/${encodeURIComponent(run.id)}/material.json`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(await answerError(response));
  const material = readFigureMaterial(await response.json());
  const entry = materialEntry(run.id, material.file, { title: material.file.name, credit: "" }, "");
  return { entry, material };
}

/**
 * The runs an earlier promotion published under a submission's id (research-runs.ts
 * promotedRunEntries), with their rules read from a run's file in the owner API and an automaton's
 * published file. It reads files only for an entry whose own id claims a run that has no entry.
 */
export function fetchPromotedRunEntries(
  runs: readonly ResearchRun[],
  entries: readonly Pick<MaterialEntry, "id" | "materialId" | "tick" | "fileRevision">[],
  fetcher: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const ruleAt = async (url: string): Promise<DefinitionRule | null> => {
    const response = await fetcher(url, { headers: { accept: "application/json" } });
    return response.ok ? definitionRule(await response.json()) : null;
  };
  return promotedRunEntries(
    runs, entries,
    (id) => ruleAt(`${API}/runs/${encodeURIComponent(id)}/material.json`),
    (id) => ruleAt(materialFileUrl(entries.find((entry) => entry.id === id) ?? id, "material.json")),
  );
}

async function answerError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : `the owner API answered ${response.status}`;
}
