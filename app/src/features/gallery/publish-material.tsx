import { useId, useState } from "react";
import { TURNSTILE_SITE_KEY } from "../../app/config";
import { fill, SITE_WORDS } from "../../app/site-words";
import { FIGURE_PYRAMID_LAYOUT, type FigureMaterialFile } from "../../materials/material-file";
import { MATERIAL_SUBMISSION_LIMITS, refreshMaterialIndex, submitMaterial, useMaterialIndex } from "./material-gallery";
import { MakerCard } from "../../replay/maker-card";
import { fileMetadataRows, MaterialMetadata } from "../../replay/material-metadata";
import { publishState, readPublishRecords, rememberSent, type PublishState } from "./publish-records";
import { submissionLabelProblem } from "./submission-label";
import { TurnstileCheck } from "./turnstile";
import "./publish-material.css";

const WORDS = SITE_WORDS.publish;

/** Where a saved definition stands in the gallery: the published index and this device's records, read at each render. */
function usePublishState(file: FigureMaterialFile) {
  const index = useMaterialIndex();
  const [, setRevision] = useState(0);
  const state = publishState(file, new Set(index.index.entries.map((entry) => entry.id)), readPublishRecords());
  return { state, reread: () => setRevision((revision) => revision + 1) };
}

/** "Published" or "waiting for approval", or nothing while the definition is not yet sent. */
function PublishStatus({ state }: { state: PublishState }) {
  if (state === "published") return <span className="publish-material" role="status">{WORDS.published}</span>;
  if (state === "awaiting") return <span className="publish-material" role="status">{WORDS.awaiting}</span>;
  return null;
}

/** Train's Publish: a button that opens the form, for a definition kept on this device. */
export function PublishMaterial({ file }: { file: FigureMaterialFile }) {
  const { state, reread } = usePublishState(file);
  const [open, setOpen] = useState(false);
  if (state !== "idle") return <PublishStatus state={state} />;
  if (!open) return <button type="button" className="button" onClick={() => setOpen(true)}>{WORDS.open}</button>;
  return <PublishForm file={file} onSent={() => { reread(); setOpen(false); }} onCancel={() => setOpen(false)} />;
}

/**
 * The Automata stage's quiet word: "Publish", which opens the stage's Publish panel, or, once the
 * definition is sent, where it stands.
 */
export function PublishWord({ file, expanded, onToggle, className }: { file: FigureMaterialFile; expanded: boolean; onToggle: () => void; className: string }) {
  const { state } = usePublishState(file);
  if (state === "published") return <span className={className} role="status">{WORDS.publishedWord}</span>;
  if (state === "awaiting") return <span className={className} role="status">{WORDS.awaitingWord}</span>;
  return <button type="button" className={className} aria-expanded={expanded} onClick={onToggle}>{WORDS.word}</button>;
}

/** The stage's Publish panel: the form. Sent or cancelled, it closes, and the word says where the definition stands. */
export function PublishPanel({ file, onClose }: { file: FigureMaterialFile; onClose: () => void }) {
  return <PublishForm file={file} onSent={onClose} onCancel={onClose} />;
}

/** The title and the name to publish under, then the check and Send. Uploads the format-4 definition for owner review. */
function PublishForm({ file, onSent, onCancel }: { file: FigureMaterialFile; onSent: () => void; onCancel: () => void }) {
  const titleHelp = useId();
  const titleError = useId();
  const creditError = useId();
  const [form, setForm] = useState({ title: "", credit: "" });
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const checkPending = TURNSTILE_SITE_KEY !== "" && token === null;
  const titleProblem = submissionLabelProblem(form.title, MATERIAL_SUBMISSION_LIMITS.titleCharacters);
  const creditProblem = submissionLabelProblem(form.credit, MATERIAL_SUBMISSION_LIMITS.creditCharacters);
  const problemText = (problem: "too-long" | "control-characters", limit: number) => problem === "too-long"
    ? fill(WORDS.labelTooLong, { limit }) : WORDS.labelControlCharacters;
  const send = async () => {
    if (titleProblem || creditProblem || sending || checkPending) return;
    setSending(true);
    setFailure("");
    try {
      const { id } = await submitMaterial(file, form, token);
      rememberSent(file.id, id);
      refreshMaterialIndex();
      onSent();
    } catch (error) {
      setFailure(String(error instanceof Error ? error.message : error));
      setToken(null);
      setAttempt((value) => value + 1);
    } finally {
      setSending(false);
    }
  };
  return <form className="publish-material-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <MakerCard
      block={file.block}
      title={form.title}
      definitionName={file.name}
      credit={form.credit}
      detail={file.rule.layout === FIGURE_PYRAMID_LAYOUT ? "coarse + fine" : "fine"}
      updates={file.training.updates}
      preview
      label="Gallery plaque"
    />
    <div className="publish-material-recipe"><span className="label">{WORDS.recipe}</span><MaterialMetadata rows={fileMetadataRows(file)} /></div>
    <label>{WORDS.title}<input value={form.title} placeholder={WORDS.titleHint} aria-describedby={`${titleHelp} ${titleError}`} aria-invalid={titleProblem !== null}
      onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
    <p id={titleHelp} className="muted">{fill(WORDS.titleHelp, { limit: MATERIAL_SUBMISSION_LIMITS.titleCharacters })}</p>
    <p id={titleError} role={titleProblem ? "alert" : undefined}>{titleProblem && problemText(titleProblem, MATERIAL_SUBMISSION_LIMITS.titleCharacters)}</p>
    <label>{WORDS.credit}<input value={form.credit} placeholder={WORDS.creditHint} aria-describedby={creditError} aria-invalid={creditProblem !== null}
      onChange={(event) => setForm({ ...form, credit: event.target.value })} /></label>
    <p id={creditError} role={creditProblem ? "alert" : undefined}>{creditProblem && problemText(creditProblem, MATERIAL_SUBMISSION_LIMITS.creditCharacters)}</p>
    <p className="muted">{WORDS.whatIsSent}</p>
    <p className="muted">{WORDS.terms}</p>
    {TURNSTILE_SITE_KEY && <TurnstileCheck key={attempt} siteKey={TURNSTILE_SITE_KEY} onToken={setToken} />}
    <div className="publish-material-actions">
      <button type="submit" className="button primary" disabled={sending || checkPending || titleProblem !== null || creditProblem !== null}>{sending ? WORDS.sending : WORDS.send}</button>
      <button type="button" className="link-control" onClick={onCancel} disabled={sending}>{WORDS.cancel}</button>
    </div>
    {failure && <p role="alert">{failure}</p>}
  </form>;
}
