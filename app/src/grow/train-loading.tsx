import { useEffect, useRef } from "react";
import { SITE_WORDS } from "../app/site-words";
import { LoadingIndicator } from "../ui/loading-indicator";
import { runWentDownInThisTab } from "./batch-size";
import { adapterUnavailable } from "./protocol";

/** Startup remains visible even when a phone has scrolled past the canvas to Train. */
export function TrainLoading({ message, failure, onStop }: { message: string; failure: string; onStop: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Right after a run took the page down, the browser can have no GPU for the page; a reload has one again.
  // Without such a run, no adapter means a browser or device without WebGPU, and the message says so as it is.
  const noAdapter = adapterUnavailable(failure) && runWentDownInThisTab();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="train-loading" aria-labelledby="train-loading-title"
    onCancel={(event) => { event.preventDefault(); onStop(); }}>
    <h2 id="train-loading-title">{failure ? "Training could not start" : "Preparing training"}</h2>
    {failure ? <p role="alert">{noAdapter ? SITE_WORDS.grow.noAdapter : failure}</p> : <>
      <LoadingIndicator>{message || "Starting the training worker…"}</LoadingIndicator>
      <p>The first start downloads the model and prepares it on this device. This can take a while. Keep this page open.</p>
    </>}
    {noAdapter
      ? <button type="button" className="button primary" onClick={() => location.reload()}>{SITE_WORDS.grow.reload}</button>
      : <button type="button" className="button" onClick={onStop}>{failure ? "Back to Train" : "Stop"}</button>}
  </dialog>;
}
