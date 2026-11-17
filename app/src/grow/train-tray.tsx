// The corner tray shows the site's Train run when the page does not. It mounts inside a basis
// group panel's dialog so it remains usable above the modal. Closing a held or failed run ends
// its worker; a training run must first be stopped.

import { useCallback, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { useDockSlots } from "../app/library-dock";
import { useMaterialRequest } from "../app/material-request";
import { SITE_WORDS, fill } from "../app/site-words";
import { useMediaMatch } from "../ui/media-match";
import { readingRegion } from "./material-kind";
import { SelectionMap } from "./selection-map";
import { statusFirstLine } from "./grow-status";
import { growState, hasFired, isHeld, resultOutcome, stopAction, type GrowState } from "./grow-view";
import { SIDE, trainRun, trayShown, useLiveCells, useTrainRun, type GrowSettings } from "./train-run";
import { DEFAULT_METHOD } from "./train-method";
import "./train-tray.css";

const WORDS = SITE_WORDS.grow;
/** Phone width: the tray is a sheet across the window and starts folded, as the editor's dock. */
const NARROW_WINDOW = "(max-width: 700px)";

/**
 * The Train page of the run: its definition's address for a continuation, else its basis group's, with
 * its method when it is not the default, so the page names the run's target from the start.
 */
export function trainPath(settings: GrowSettings): string {
  if (settings.continuation) return `/train?continue=${encodeURIComponent(settings.continuation.id)}`;
  const method = settings.method === DEFAULT_METHOD ? "" : `&method=${settings.method}`;
  return `/train?block=${settings.request.block}${method}`;
}

/**
 * The run's one action in the tray, as on the page: Stop while it trains, Resume after Stop, Restart
 * after a run that did not meet the target (Keep waits on the Train page), Open when done.
 */
function TrayAction({ state, onOpen }: { state: GrowState; onOpen: string | null }): ReactNode {
  if (state === "loading" || state === "training" || state === "fired") {
    const stop = () => (stopAction(state) === "stop" ? trainRun.stop() : trainRun.end());
    return <button type="button" className="button" onClick={stop}>{WORDS.stop}</button>;
  }
  if (state === "retry") return <button type="button" className="button" onClick={trainRun.restart}>{WORDS.restart}</button>;
  if (state === "stopped") return <button type="button" className="button" onClick={trainRun.resumeTraining}>{WORDS.resume}</button>;
  if (state === "done" && onOpen !== null) return <Link className="button" to={onOpen}>{WORDS.open}</Link>;
  return null;
}

export function TrainTray() {
  const run = useTrainRun();
  const { pathname } = useLocation();
  const slots = useDockSlots();
  const { setRequest } = useMaterialRequest();
  const narrow = useMediaMatch(NARROW_WINDOW);
  // The visitor's last fold or open holds for the session; before any, open, and folded on a phone.
  const [choice, setChoice] = useState<"open" | "folded" | null>(null);
  const bodyId = useId();
  const shown = trayShown(run, pathname, slots.float !== null);
  const folded = (choice ?? (narrow ? "folded" : "open")) === "folded";
  // Folding moves the controls below the window. Apply inert again when a panel remounts the body.
  const setBody = useCallback((element: HTMLDivElement | null) => {
    if (element) element.inert = folded;
  }, [folded]);
  const settings = run.settings;
  if (!shown || settings === null) return null;

  const state = growState(run.record);
  const result = state === "done" ? resultOutcome(run.record) : undefined;
  const fired = hasFired(state, run.record);
  const sampled = fired && run.sampled ? ({ "--sampled": run.sampled } as CSSProperties) : undefined;
  const back = trainPath(settings);
  // The way back aims Train at the run's target again: the page shows the run only for its own target.
  const restore = () => setRequest(settings.request, settings.picture);
  const element = (
    <aside className="train-tray" data-folded={folded || undefined} data-sheet={narrow || undefined} aria-label={WORDS.trayName}>
      <button type="button" className="train-tray-tab" aria-expanded={!folded} aria-controls={bodyId} onClick={() => setChoice(folded ? "open" : "folded")}>
        <TrayCells className="train-tray-thumbnail" drawing={run.record.active} />
        <span>{fill(WORDS.trayTab, { block: settings.request.block })}</span>
        <svg className="glyph train-tray-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d={folded ? "M4 10 L8 6 L12 10" : "M4 6 L8 10 L12 6"} fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <div ref={setBody} id={bodyId} className="train-tray-body" style={sampled}>
        {/* The window onto the run: a press goes back to Train, as the words under it do. */}
        <Link className="train-tray-window" to={back} onClick={restore} tabIndex={-1} aria-hidden="true">
          <TrayCells className="train-tray-cells" drawing={run.record.active} />
        </Link>
        <div className="train-tray-status">
          <SelectionMap selected={run.record.reading?.selectedPatches ?? null} region={readingRegion(settings.kind)} fired={fired} />
          <p className="grow-status-first">{statusFirstLine(state, run.record)}</p>
        </div>
        <div className="train-tray-actions">
          <TrayAction state={state} onOpen={result ? `/automata?material=${encodeURIComponent(result.id)}` : null} />
          <Link className="link-control" to={back} onClick={restore}>{WORDS.trayBack}</Link>
          {(isHeld(state) || state === "retry" || state === "failed") && <button type="button" className="link-control" onClick={trainRun.end}>{WORDS.trayClose}</button>}
        </div>
      </div>
    </aside>
  );
  return slots.float ? createPortal(element, slots.float) : element;
}

/** A panel remounts each canvas. Its own subscription restores the held grid before any new frame. */
function TrayCells({ className, drawing }: { className: string; drawing: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLiveCells(canvas, drawing);
  return <canvas ref={canvas} className={className} width={SIDE} height={SIDE} aria-hidden="true" />;
}
