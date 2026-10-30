import { useEffect, useRef } from "react";
import { SITE_WORDS } from "../app/site-words";
import { onPhone } from "./training-device";

const WORDS = SITE_WORDS.grow.phoneNotice;
/** The session's answer, so a page that reloads during a run does not ask again. */
const ANSWERED_KEY = "dinodreamer.train.phone-notice";
/** Whether to ask before a run: on a phone, until the person trains anyway in this tab. */
export function asksBeforeTraining(): boolean {
  if (!onPhone()) return false;
  try {
    return sessionStorage.getItem(ANSWERED_KEY) === null;
  } catch {
    return true;
  }
}

function rememberAnswer() {
  try {
    sessionStorage.setItem(ANSWERED_KEY, "train");
  } catch {
    // Without storage the dialog asks again next time; the run still starts.
  }
}

/** Before the first run of a session on a phone: the run may not finish there. */
export function PhoneNotice({ onTrain, onCancel }: { onTrain: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="train-notice" aria-labelledby="train-phone-notice-title"
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="train-phone-notice-title">{WORDS.title}</h2>
    <p>{WORDS.body}</p>
    <div className="train-notice-actions">
      <button type="button" className="button primary" onClick={() => { rememberAnswer(); onTrain(); }}>{WORDS.train}</button>
      <button type="button" className="button" onClick={onCancel}>{WORDS.cancel}</button>
    </div>
  </dialog>;
}
