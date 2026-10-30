import { useState } from "react";
import { Link } from "react-router";
import { fill, fillNodes, SITE_WORDS } from "../app/site-words";
import { keepMaterial } from "../storage/materials";
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

/** Keep the file on this device and tell an open Playground, which reads Yours again. */
function useKeep(file: FigureMaterialFile): { state: KeepState; keep: () => void } {
  const [state, setState] = useState<KeepState>({ status: "idle" });
  const keep = () => {
    keepMaterial(file).then(
      () => {
        setState({ status: "kept" });
        announceKept("stage");
      },
      (error: unknown) => setState({ status: "failed", message: String(error instanceof Error ? error.message : error) }),
    );
  };
  return { state, keep };
}

/** "Save on this device": a published automaton joins the visitor's own, under Saved automata in Automata. */
export function KeepMaterial({ material }: { material: FigureMaterial }) {
  const { state, keep } = useKeep(material.file);
  if (state.status === "kept") {
    return <span role="status">{fillNodes(SITE_WORDS.stage.kept, { yours: <Link to={YOURS_PATH}>{SITE_WORDS.stage.yoursLink}</Link> })}</span>;
  }
  return <>
    <button type="button" className="button" onClick={keep}>{SITE_WORDS.stage.keep}</button>
    {state.status === "failed" && <span role="alert">{fill(SITE_WORDS.stage.keepFailed, { message: state.message })}</span>}
  </>;
}

/** Automata's quiet "Save": one word, then "Saved"; the tile appears under Saved automata on the same page. */
export function KeepWord({ material, className }: { material: FigureMaterial; className: string }) {
  const { state, keep } = useKeep(material.file);
  const words = SITE_WORDS.playground;
  if (state.status === "kept") return <span className={className} role="status">{words.kept}</span>;
  return <>
    <button type="button" className={className} onClick={keep}>{words.keep}</button>
    {state.status === "failed" && <span role="alert">{fill(words.keepFailed, { message: state.message })}</span>}
  </>;
}
