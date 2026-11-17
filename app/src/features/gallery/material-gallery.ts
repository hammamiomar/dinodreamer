// The app's side of the material gallery (gallery/src/worker.ts):
//   GET  /api/materials                         the published index, checked by readMaterialIndex
//   GET  /api/materials/<id>/material.json      a published material file, checked by readFigureMaterial
//   GET  /api/materials/<id>/poster.png         its poster, one pixel per cell
//   POST /api/submissions  kind=material         the format-4 file, title, credit and the human check
// The file is the only thing sent: the site makes shaders from weights, never from uploads.

import { useEffect, useState } from "react";
import { readFigureMaterial, type FigureMaterial, type FigureMaterialFile } from "../../materials/material-file";
import { useLoaded, type Loaded } from "../../ui/use-loaded";
import { refusal } from "./gallery-api";
import { EMPTY_MATERIAL_INDEX, readMaterialIndex, type MaterialFileName, type MaterialIndex } from "./material-index";

type Fetch = typeof fetch;
export { MATERIAL_SUBMISSION_LIMITS } from "./submission-label";

/**
 * The address of a published automaton's file or poster. `step` is the entry's reading step, when the
 * caller has the entry: these objects are served as immutable, and a research automaton read again at
 * another step keeps its id (gallery/src/research.ts), so the step in the address makes its new file a
 * new address for a browser that holds the old one. The server ignores it.
 */
export function materialFileUrl(id: string, file: MaterialFileName, step?: number): string {
  const address = `/api/materials/${encodeURIComponent(id)}/${file}`;
  return step === undefined ? address : `${address}?step=${step}`;
}

export async function fetchMaterialIndex(fetcher: Fetch = fetch): Promise<MaterialIndex> {
  const response = await fetcher("/api/materials");
  if (!response.ok) throw new Error(`The automata gallery answered ${response.status}.`);
  if (!response.headers.get("content-type")?.includes("json")) throw new Error("The automata gallery is not reachable from this server.");
  return readMaterialIndex(await response.json());
}

const publishedFiles = new Map<string, Promise<FigureMaterial>>();

/**
 * A published definition by its entry id; `step` as materialFileUrl takes it. A load is shared between
 * playback and older index labels.
 */
export function fetchPublishedMaterial(id: string, fetcher: Fetch = fetch, step?: number): Promise<FigureMaterial> {
  const cached = fetcher === fetch ? publishedFiles.get(id) : undefined;
  if (cached) return cached;
  const loading = (async () => {
    const response = await fetcher(materialFileUrl(id, "material.json", step));
    if (!response.ok) throw new Error(`Automaton ${id} answered ${response.status}.`);
    return readFigureMaterial(await response.json());
  })();
  if (fetcher === fetch) {
    publishedFiles.set(id, loading);
    void loading.catch(() => publishedFiles.delete(id));
  }
  return loading;
}

/** A published material's file, loaded once per id; null asks for none (a still shows the poster alone). */
export function usePublishedMaterial(id: string | null): Loaded<FigureMaterial> {
  return useLoaded(id, () => (id === null ? null : fetchPublishedMaterial(id)));
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

// One read per page load, shared by every reader; a reload after an approval shows the change.
let shared: Promise<MaterialIndex> | undefined;
const listeners = new Set<() => void>();

/** Read the index again, as after a submission or an approval in another tab. */
export function refreshMaterialIndex(): void {
  shared = undefined;
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
    shared ??= fetchMaterialIndex().catch((error: unknown) => { shared = undefined; throw error; });
    shared.then(
      (index) => { if (current) setState({ status: "ready", index }); },
      (error: unknown) => { if (current) setState({ status: "failed", index: EMPTY_MATERIAL_INDEX, message: String(error instanceof Error ? error.message : error) }); },
    );
    return () => { current = false; };
  }, [revision]);
  return state;
}
