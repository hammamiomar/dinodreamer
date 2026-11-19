import { useId, useState } from "react";
import { TURNSTILE_SITE_KEY } from "../../app/config";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { FigureMaterialFile } from "../../materials/material-file";
import { MATERIAL_SUBMISSION_LIMITS, refreshMaterialIndex, submitMaterial, useMaterialIndex } from "./material-gallery";
import { fileMetadataRows, MaterialMetadata } from "../../replay/material-metadata";
import { publishState, readPublishRecords, rememberSent } from "./publish-records";
import { submissionLabelProblem } from "./submission-label";
import { TurnstileCheck } from "./turnstile";
import "./publish-material.css";

const WORDS = SITE_WORDS.publish;

/**
 * Publish control for a locally saved figure material, shared by Saved automata and Train.
 * Uploads the format-4 definition for owner review.
 */
export function PublishMaterial({ file }: { file: FigureMaterialFile }) {
  const index = useMaterialIndex();
  const titleHelp = useId();
  const titleError = useId();
  const creditError = useId();
  const [records, setRecords] = useState(readPublishRecords);
  const [form, setForm] = useState<{ title: string; credit: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const state = publishState(file, new Set(index.index.entries.map((entry) => entry.id)), records);

  if (state === "published") return <span className="publish-material" role="status">{WORDS.published}</span>;
  if (state === "awaiting") return <span className="publish-material" role="status">{WORDS.awaiting}</span>;
  if (form === null) {
    return <button type="button" className="button" onClick={() => setForm({ title: "", credit: "" })}>{WORDS.open}</button>;
  }
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
      setRecords(readPublishRecords());
      setForm(null);
      refreshMaterialIndex();
    } catch (error) {
      setFailure(String(error instanceof Error ? error.message : error));
      setToken(null);
      setAttempt((value) => value + 1);
    } finally {
      setSending(false);
    }
  };
  return <form className="publish-material-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <div className="publish-material-recipe"><span className="label">{WORDS.recipe}</span><MaterialMetadata rows={fileMetadataRows(file)} /></div>
    <label>{WORDS.title}<input value={form.title} placeholder={WORDS.titleHint} aria-describedby={`${titleHelp} ${titleError}`} aria-invalid={titleProblem !== null}
      onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
    <p id={titleHelp} className="muted">{fill(WORDS.titleHelp, { limit: MATERIAL_SUBMISSION_LIMITS.titleCharacters })}</p>
    <p id={titleError} role={titleProblem ? "alert" : undefined}>{titleProblem && problemText(titleProblem, MATERIAL_SUBMISSION_LIMITS.titleCharacters)}</p>
    <label>{WORDS.credit}<input value={form.credit} placeholder={WORDS.creditHint} aria-describedby={creditError} aria-invalid={creditProblem !== null}
      onChange={(event) => setForm({ ...form, credit: event.target.value })} /></label>
    <p id={creditError} role={creditProblem ? "alert" : undefined}>{creditProblem && problemText(creditProblem, MATERIAL_SUBMISSION_LIMITS.creditCharacters)}</p>
    <p className="muted">{WORDS.whatIsSent}</p>
    {TURNSTILE_SITE_KEY && <TurnstileCheck key={attempt} siteKey={TURNSTILE_SITE_KEY} onToken={setToken} />}
    <div className="publish-material-actions">
      <button type="submit" className="button primary" disabled={sending || checkPending || titleProblem !== null || creditProblem !== null}>{sending ? WORDS.sending : WORDS.send}</button>
      <button type="button" className="link-control" onClick={() => setForm(null)} disabled={sending}>{WORDS.cancel}</button>
    </div>
    {failure && <p role="alert">{failure}</p>}
  </form>;
}
