import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useMaterialRequest } from "../app/material-request";
import { SITE_WORDS, fill, fillNodes } from "../app/site-words";
import { PublishMaterial } from "../features/gallery/publish-material";
import type { MaterialRequest } from "../recipe";
import { downloadBlob } from "../ui/files";
import { MaterialFrame } from "../ui/material-frame";
import { Segmented } from "../ui/segmented";
import {
  drawCells, sameTarget, SIDE, trainRun, useLiveCells, useTrainRun, useTrainTick,
  type GrowSettings, type KeepFailure, type TrainRunState,
} from "./train-run";
import { CoSelectedPictures } from "./co-selected-pictures";
import { TrainLoading } from "./train-loading";
import { GrowStatus } from "./grow-status";
import { durationText, timeBefore, timeLeft, timeTaken, type GrowTime } from "./grow-time";
import {
  choicesOpen, growState, hasFired, isHeld, NO_RECORD, primaryAction, resultOutcome, resumeUpdates, shownCoSelection, stopAction,
  type GrowRecord,
} from "./grow-view";
import { BRUSH, strokeStamps } from "./live-brush";
import { continuedKind, type ContinuationSource } from "./continuation";
import { RULE_CHOICES, START_CHOICES, kindFromSearch, kindLabel, readingRegion, type MaterialKind } from "./material-kind";
import { startStill } from "./start-still";

// The page shows the site's persistent run only when its target matches. grow-view.ts maps
// worker events to the controls and status shown in this layout.

const WORDS = SITE_WORDS.grow;
/** What the page shows while the site's run is another target's, or there is none: the start. */
const NO_RUN: TrainRunState = { record: NO_RECORD, settings: null, files: new Map(), sampled: null, keepFailure: null, shownOnPage: false };

/** The primary as a button: inverted for the actions that start training, outlined for Stop. */
const PRIMARY_BUTTON = {
  grow: { className: "button primary", words: WORDS.grow },
  resume: { className: "button primary", words: WORDS.resume },
  restart: { className: "button primary", words: WORDS.restart },
  stop: { className: "button grow-stop", words: WORDS.stop },
  // Without a kept file, Stop closes the worker.
  open: { className: "button grow-stop", words: WORDS.stop },
} as const;

/** Capitalize the hint phrase and add its sentence-ending period. */
function hintSentence(hint: string): string {
  return `${hint[0]!.toUpperCase()}${hint.slice(1)}.`;
}

/**
 * The two choices of a material's kind, each with the chosen option's hint; fixed while a run trains or
 * waits. A continuation keeps its definition's cellular model (`ruleFixed`), so only the start is open.
 */
function KindChoices({ kind, open, ruleFixed, onChange }: {
  kind: MaterialKind; open: boolean; ruleFixed: boolean; onChange: (kind: MaterialKind) => void;
}) {
  const fixed = { unavailable: !open, reason: open ? undefined : WORDS.stop };
  const ruleChoice = ruleFixed ? { unavailable: true, reason: WORDS.continuedRule } : fixed;
  const rule = RULE_CHOICES.find((choice) => choice.value === kind.rule)!;
  const start = START_CHOICES.find((choice) => choice.value === kind.start)!;
  return <div className="grow-choices">
    <div className="grow-field grow-rule">
      <span className="label">{WORDS.rule}</span>
      <Segmented label={WORDS.rule} value={kind.rule} onChange={(value) => onChange({ ...kind, rule: value })}
        segments={RULE_CHOICES.map((choice) => ({ value: choice.value, label: choice.label, ...ruleChoice }))} />
      <p className="grow-hint">{hintSentence(rule.hint)}</p>
    </div>
    <div className="grow-field grow-start">
      <span className="label">{WORDS.start}</span>
      <Segmented label={WORDS.start} value={kind.start} onChange={(value) => onChange({ ...kind, start: value })}
        segments={START_CHOICES.map((choice) => ({ value: choice.value, label: choice.label, ...fixed }))} />
      <p className="grow-hint">{hintSentence(start.hint)}</p>
    </div>
  </div>;
}

/** The time line: before a run the estimate, during it the time left, after it the time it took. */
function TimeLine({ time, template }: { time: GrowTime; template: string }) {
  const where = time.measured ? WORDS.onThisDevice : WORDS.onReference;
  return <p className="grow-time">{fillNodes(template, {
    updates: <b>{time.updates.toLocaleString("en-US")}</b>,
    duration: <span className="grow-time-duration">{durationText(time.seconds)} {where}</span>,
  })}</p>;
}

/** Which time the line shows, by state: the run's own while it runs or after, the chosen kind's before. */
function growTime(record: GrowRecord, settings: GrowSettings | null,
  chosen: Pick<GrowSettings, "kind" | "stopAtFirstFire" | "continuation">, primary: ReturnType<typeof primaryAction>): { time: GrowTime; template: string } {
  if ((primary === "open" || primary === "restart") && record.progress) return { time: timeTaken(record.progress, settings?.continuation?.fromUpdate ?? 0), template: WORDS.timeTaken };
  if ((primary === "stop" || primary === "resume") && settings && record.progress) {
    return { time: timeLeft(settings.kind, settings.stopAtFirstFire, record.progress, settings.continuation?.fromUpdate ?? 0), template: WORDS.timeLeft };
  }
  const before = settings && primary === "stop" ? settings : chosen;
  return { time: timeBefore(before.kind, before.stopAtFirstFire, before.continuation?.fromUpdate ?? 0), template: WORDS.timeBefore };
}

export function GrowPanel({ block, request, continuation, heading }: {
  /** The block the page is about, before its request has loaded. */
  block: number | null;
  request: MaterialRequest | null;
  /** The saved definition the page continues (/train?continue=), or null for a new automaton. */
  continuation: ContinuationSource | null;
  /** The display and the occurrence, from the page. */
  heading: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { picture } = useMaterialRequest();
  const site = useTrainRun();
  // The site's run is this page's when it trains toward this page's target; another target starts idle here.
  const ours = site.settings !== null && sameTarget(site.settings, request, continuation);
  const run = ours ? site : NO_RUN;
  const tick = useTrainTick();
  // "Grow another variation" on a material names its kind in the address; otherwise the fine rule from noise.
  const [kind, setKind] = useState<MaterialKind>(() => kindFromSearch(new URLSearchParams(globalThis.location?.search)));
  // Off by default: Grow trains on after the first fire and keeps both materials.
  const [stopAtFirstFire, setStopAtFirstFire] = useState(false);
  const { record, settings } = run;
  const state = growState(record);
  // A continuation starts from its definition's start; its cellular model is the definition's.
  useEffect(() => {
    if (continuation) setKind({ rule: continuation.rule, start: continuation.start });
  }, [continuation]);
  // Back on Train with its run, the choices are the run's, so Stop, Resume and Open read as they did.
  const adopted = useRef<GrowSettings | null>(null);
  useEffect(() => {
    if (!settings || adopted.current === settings) return;
    adopted.current = settings;
    setKind(settings.kind);
    setStopAtFirstFire(settings.stopAtFirstFire);
  }, [settings]);
  // While the page shows the run, the corner tray need not.
  useEffect(() => {
    if (!ours) return;
    trainRun.showOnPage(true);
    return () => trainRun.showOnPage(false);
  }, [ours]);
  const runKind = continuation ? continuedKind(continuation, kind) : kind;
  const chosen = { kind: runKind, stopAtFirstFire, continuation };
  const changed = settings !== null
    && (settings.kind.rule !== runKind.rule || settings.kind.start !== runKind.start || settings.stopAtFirstFire !== stopAtFirstFire
      || settings.continuation?.id !== continuation?.id);
  const primary = primaryAction(state, changed);
  const open = choicesOpen(state);
  const coSelection = shownCoSelection(state, record);
  const result = isHeld(state) ? resultOutcome(record) : undefined;
  const resultFile = result ? run.files.get(result.id) : undefined;
  // The frame and the status name what the frame shows: the run's kind while its worker plays it.
  const shownKind = settings && record.active ? settings.kind : runKind;
  const ready = request?.anchor !== undefined && request.mode !== "plant";
  const time = growTime(record, settings, chosen, primary);

  // The live grid while the run is this page's; without one, the start of the chosen kind as a still.
  useLiveCells(canvas, record.active);
  useEffect(() => {
    if (!record.active) drawCells(canvas.current, startStill(runKind));
  }, [record.active, runKind.rule, runKind.start]);

  // The live canvas is the brush: a drag stamps soft discs along its path, in cells.
  const last = useRef<{ x: number; y: number } | null>(null);
  const cellAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width * SIDE, y: (event.clientY - box.top) / box.height * SIDE };
  };
  const damage = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.buttons === 0 || !last.current) return;
    const next = cellAt(event);
    const stamps = strokeStamps(last.current.x, last.current.y, next.x, next.y, BRUSH.radius);
    if (stamps.length) trainRun.brush(stamps);
    last.current = next;
  };

  const onPrimary = () => {
    if (primary === "grow") {
      if (request && ready) trainRun.start(request, { ...chosen, picture });
    } else if (primary === "resume") {
      trainRun.resumeTraining();
    } else if (primary === "restart") {
      trainRun.restart();
    } else if (stopAction(state) === "stop") {
      trainRun.stop();
    } else {
      trainRun.end();
    }
  };
  const download = ({ file }: KeepFailure) => downloadBlob(new Blob([JSON.stringify(file)], { type: "application/json" }), `${file.id}.material.json`);

  // The one primary. With no block named, the step to take is finding one in Explore.
  let goControl: ReactNode;
  if (primary === "open" && result) {
    goControl = <Link className="button primary" to={`/automata?material=${encodeURIComponent(result.id)}`}>{WORDS.open}</Link>;
  } else if (block === null && !request) {
    goControl = <Link className="button primary" to="/index">{WORDS.exploreLink}</Link>;
  } else {
    const button = PRIMARY_BUTTON[primary];
    goControl = <button type="button" className={button.className} disabled={primary === "grow" && !ready} onClick={onPrimary}>{button.words}</button>;
  }

  // The run's line under the time: the check before and while a run trains; after a run, Publish and
  // Train more; after a run that did not meet the target, Keep beside the primary Restart.
  let runLine: ReactNode;
  if (primary === "open" || primary === "resume") {
    runLine = <div className="grow-publish">
      {resultFile && result?.fired && <PublishMaterial key={resultFile.id} file={resultFile} />}
      {/* After Stop, Resume is the primary; after a run's end, a word here, since opening the result is the likelier step. */}
      {primary === "open" && record.progress && <button type="button" className="button" onClick={trainRun.resumeTraining}>
        {fill(WORDS.trainFurther, { updates: resumeUpdates(record.progress).toLocaleString("en-US") })}
      </button>}
    </div>;
  } else if (primary === "restart") {
    runLine = <div className="grow-publish">
      <button type="button" className="button" onClick={trainRun.keep}>{WORDS.keepRun}</button>
    </div>;
  } else {
    runLine = <label className="grow-stop-check">
      <input type="checkbox" checked={stopAtFirstFire} disabled={!open} onChange={(event) => setStopAtFirstFire(event.target.checked)} />
      {WORDS.stopAtFirstFire}
    </label>;
  }

  // The one coloured line: once the material has fired, the frame and selection map take its colour.
  const sampled = hasFired(state, record) && run.sampled ? ({ "--sampled": run.sampled } as CSSProperties) : undefined;
  const label = block === null ? undefined : `${block} · ${kindLabel(shownKind)}`;
  const shownTick = ours ? tick ?? 0 : 0;
  return <div className="grow-panel" data-state={state}>
    <section className="grow-stage" style={sampled} aria-label={label}>
      <MaterialFrame label={label} note={fill(WORDS.tick, { tick: shownTick.toLocaleString("en-US") })}>
        <canvas ref={canvas} className="grow-cells" width={SIDE} height={SIDE} data-live={record.active || undefined}
          aria-label={record.active && block !== null ? fill(WORDS.canvasLabel, { block }) : WORDS.stillLabel}
          onPointerDown={(event) => {
            if (!record.active) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            last.current = cellAt(event);
          }}
          onPointerMove={damage} onPointerUp={() => { last.current = null; }} onPointerCancel={() => { last.current = null; }} />
      </MaterialFrame>
      <GrowStatus state={state} record={record} kind={shownKind} block={settings?.request.block ?? block} keepFailure={run.keepFailure} onDownload={download} />
    </section>
    <aside className="grow-side" aria-label={WORDS.title}>
      {heading}
      {coSelection ? <CoSelectedPictures coSelection={coSelection} region={readingRegion(shownKind)} />
        : <KindChoices kind={runKind} open={open} ruleFixed={continuation !== null} onChange={setKind} />}
      <TimeLine time={time.time} template={time.template} />
      {runLine}
    </aside>
    {/* The primary: in the foot row beside the status, or at the bottom of a phone's screen. */}
    <div className="grow-go">{goControl}</div>
    {(state === "loading" || (state === "failed" && record.progress === null))
      && <TrainLoading message={record.phaseMessage} failure={record.failure} onStop={trainRun.end} />}
    {/* Expose save completion for browser checks. */}
    {record.outcomes.map((outcome) => <span key={outcome.id} hidden className="grow-panel-outcome"
      data-fired={outcome.fired} data-stage={outcome.stage} data-saved={outcome.saved} />)}
  </div>;
}
