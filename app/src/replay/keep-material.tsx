import { useState } from "react";
import { Link } from "react-router";
import { fillNodes } from "../app/fill-nodes";
import { fill, SITE_WORDS } from "../app/site-words";
import { rememberSavedFrom } from "../features/gallery/publish-records";
import { keepPublishedMaterial } from "../storage/materials";
import type { FigureMaterial, FigureMaterialFile } from "../materials/material-file";

/** Where the kept materials show: the Playground's first group. The event tells an open Playground to read them again. */
export const YOURS_PATH = "/automata?group=yours";
export const MATERIALS_KEPT_EVENT = "dinodreamer:materials-kept";

/** Who kept a material: the Playground's stage, or Train's run, which keeps its automata whatever page is open. */
export type KeptOrigin = "stage" | "train";

/** Tells an open Playground that Yours has a new material, and who kept it. */
export function announceKept(origin: KeptOrigin): void {
  window.dispatchEvent(new CustomEvent<KeptOrigin>(MATERIALS_KEPT_EVENT, { detail: origin }));
}

/** Who kept the material a MATERIALS_KEPT_EVENT announces; an event without a name is the stage's. */
export function keptOrigin(event: Event): KeptOrigin {
  return event instanceof CustomEvent && event.detail === "train" ? "train" : "stage";
}

type KeepState = { status: "idle" } | { status: "kept" } | { status: "failed"; message: string };

/**
 * Keep a gallery automaton's file on this device, remember which entry it came from (publish-records.ts),
 * and tell an open Playground, which reads Yours again. A different automaton kept under the same id stays.
 */
function useKeep(file: FigureMaterialFile, entryId: string): { state: KeepState; keep: () => void } {
  const [state, setState] = useState<KeepState>({ status: "idle" });
  const keep = () => {
    keepPublishedMaterial(file).then(
      () => {
        rememberSavedFrom(file.id, entryId);
        setState({ status: "kept" });
        announceKept("stage");
      },
      (error: unknown) => setState({ status: "failed", message: String(error instanceof Error ? error.message : error) }),
    );
  };
  return { state, keep };
}

/** "Save on this device": a published automaton joins the visitor's own, under Saved automata in Automata. */
export function KeepMaterial({ material, entryId }: { material: FigureMaterial; entryId: string }) {
  const { state, keep } = useKeep(material.file, entryId);
  if (state.status === "kept") {
    return <span role="status">{fillNodes(SITE_WORDS.stage.kept, { yours: <Link to={YOURS_PATH}>{SITE_WORDS.stage.yoursLink}</Link> })}</span>;
  }
  return <>
    <button type="button" className="button" onClick={keep}>{SITE_WORDS.stage.keep}</button>
    {state.status === "failed" && <span role="alert">{fill(SITE_WORDS.stage.keepFailed, { message: state.message })}</span>}
  </>;
}

/** Automata's quiet "Save": one word, then "Saved"; the tile appears under Saved automata on the same page. */
export function KeepWord({ material, entryId, className }: { material: FigureMaterial; entryId: string; className: string }) {
  const { state, keep } = useKeep(material.file, entryId);
  const words = SITE_WORDS.playground;
  if (state.status === "kept") return <span className={className} role="status">{words.kept}</span>;
  return <>
    <button type="button" className={className} onClick={keep}>{words.keep}</button>
    {state.status === "failed" && <span role="alert">{fill(words.keepFailed, { message: state.message })}</span>}
  </>;
}
