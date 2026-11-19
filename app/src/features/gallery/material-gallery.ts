// The app's side of the material gallery (gallery/src/worker.ts):
//   GET  /api/materials                         the published index, checked by readMaterialIndex
//   Versioned entries select their definition and poster on the public library.
//   Older entries and unlisted ids use the gallery Worker.
//   POST /api/submissions  kind=material         the format-4 file, title, credit and the human check
// The file is the only thing sent: the site makes shaders from weights, never from uploads.

import { useEffect, useState } from "react";
import { ASSET_BASE_URL } from "../../app/config";
import { readFigureMaterial, type FigureMaterial, type FigureMaterialFile } from "../../materials/material-file";
import { useLoaded, type Loaded } from "../../ui/use-loaded";
import { refusal } from "./gallery-api";
import { EMPTY_MATERIAL_INDEX, readMaterialIndex, versionedMaterialKey, type MaterialEntry, type MaterialFileName, type MaterialIndex } from "./material-index";

type Fetch = typeof fetch;
export { MATERIAL_SUBMISSION_LIMITS } from "./submission-label";

type MaterialFileReference = Pick<MaterialEntry, "id" | "tick" | "fileRevision"> | string;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A local Worker can hold files that have never been published to the library CDN. */
export function materialFileUrl(reference: MaterialFileReference, file: MaterialFileName, libraryBase = ASSET_BASE_URL): string {
  const id = typeof reference === "string" ? reference : reference.id;
  const apiPath = `/api/materials/${encodeURIComponent(id)}/${file}`;
  if (typeof reference === "string") return apiPath;
  if (reference.fileRevision === undefined) return `${apiPath}?step=${reference.tick}`;
  if (LOOPBACK_HOSTS.has(globalThis.location?.hostname)) return `${apiPath}?revision=${reference.fileRevision}`;
  return `${libraryBase}/${versionedMaterialKey(id, reference.fileRevision, file)}`;
}

// The index and the published files are shared by the readers on a page.
let sharedIndex: Promise<MaterialIndex> | undefined;
const publishedFiles = new Map<string, Promise<FigureMaterial>>();

export async function fetchMaterialIndex(fetcher: Fetch = fetch): Promise<MaterialIndex> {
  const response = await fetcher("/api/materials");
  if (!response.ok) throw new Error(`The automata gallery answered ${response.status}.`);
  if (!response.headers.get("content-type")?.includes("json")) throw new Error("The automata gallery is not reachable from this server.");
  return readMaterialIndex(await response.json());
}

/** Open the current index once for all readers, including id-only links. */
export function loadMaterialIndex(): Promise<MaterialIndex> {
  if (sharedIndex) return sharedIndex;
  const reading = fetchMaterialIndex();
  sharedIndex = reading;
  void reading.catch(() => { if (sharedIndex === reading) sharedIndex = undefined; });
  return reading;
}

/**
 * Readers of the same URL share its load. A new revision selects a new URL, even at the same reading step.
 */
export function fetchPublishedMaterial(reference: MaterialFileReference, fetcher: Fetch = fetch): Promise<FigureMaterial> {
  const url = materialFileUrl(reference, "material.json");
  const cached = fetcher === fetch ? publishedFiles.get(url) : undefined;
  if (cached) return cached;
  const loading = (async () => {
    const response = await fetcher(url);
    if (!response.ok) {
      const id = typeof reference === "string" ? reference : reference.id;
      throw new Error(`Automaton ${id} answered ${response.status}.`);
    }
    return readFigureMaterial(await response.json());
  })();
  if (fetcher === fetch) {
    publishedFiles.set(url, loading);
    void loading.catch(() => publishedFiles.delete(url));
  }
  return loading;
}

/** A continuation or recorded replay names only the id. Reuse the page's index when available. */
export async function fetchPublishedMaterialById(id: string): Promise<FigureMaterial> {
  const index = await sharedIndex?.catch(() => null);
  const entry = index?.entries.find((candidate) => candidate.id === id);
  return fetchPublishedMaterial(entry ?? id);
}

/** Load the indexed version for playback. A still view passes null. */
export function usePublishedMaterial(entry: MaterialEntry | null): Loaded<FigureMaterial> {
  const url = entry && materialFileUrl(entry, "material.json");
  return useLoaded(url, () => entry && fetchPublishedMaterial(entry));
}

export async function submitMaterial(file: FigureMaterialFile, label: { title: string; credit: string }, turnstileToken: string | null,
  fetcher: Fetch = fetch): Promise<{ id: string }> {
  const form = new FormData();
  form.append("kind", "material");
  form.append("material", new Blob([JSON.stringify(file)], { type: "application/json" }), `${file.id}.material.json`);
  form.append("title", label.title.trim());
  form.append("credit", label.credit.trim());
  if (turnstileToken !== null) form.append("turnstileToken", turnstileToken);
  const response = await fetcher("/api/submissions", { method: "POST", body: form });
  if (!response.ok) throw new Error(await refusal(response));
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string") throw new Error("The gallery accepted the automaton but returned no id.");
  return { id: body.id };
}

export type MaterialIndexState =
  | { status: "loading"; index: MaterialIndex }
  | { status: "ready"; index: MaterialIndex }
  | { status: "failed"; index: MaterialIndex; message: string };

const listeners = new Set<() => void>();

/** Read the index again, as after a submission or an approval in another tab. */
export function refreshMaterialIndex(): void {
  sharedIndex = undefined;
  listeners.forEach((listener) => listener());
}

/** The published materials for the Atlas, the block page and the Saved page. */
export function useMaterialIndex(): MaterialIndexState {
  const [state, setState] = useState<MaterialIndexState>({ status: "loading", index: EMPTY_MATERIAL_INDEX });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener = () => setRevision((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  useEffect(() => {
    let current = true;
    loadMaterialIndex().then(
      (index) => { if (current) setState({ status: "ready", index }); },
      (error: unknown) => { if (current) setState({ status: "failed", index: EMPTY_MATERIAL_INDEX, message: String(error instanceof Error ? error.message : error) }); },
    );
    return () => { current = false; };
  }, [revision]);
  return state;
}
