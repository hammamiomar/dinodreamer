import { useEffect, useRef } from "react";
import { LoadingIndicator } from "../ui/loading-indicator";

/** Startup remains visible even when a phone has scrolled past the canvas to Train. */
export function TrainLoading({ message, failure, onStop }: { message: string; failure: string; onStop: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="train-loading" aria-labelledby="train-loading-title"
    onCancel={(event) => { event.preventDefault(); onStop(); }}>
    <h2 id="train-loading-title">{failure ? "Training could not start" : "Preparing training"}</h2>
    {failure ? <p role="alert">{failure}</p> : <>
      <LoadingIndicator>{message || "Starting the training worker…"}</LoadingIndicator>
      <p>The first start downloads the model and prepares it on this device. This can take a while. Keep this page open.</p>
    </>}
    <button type="button" className="button" onClick={onStop}>{failure ? "Back to Train" : "Stop"}</button>
  </dialog>;
}
