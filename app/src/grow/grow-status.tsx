import type { ReactNode } from "react";
import { SITE_WORDS, fill } from "../app/site-words";
import { SelectionMap } from "./selection-map";
import type { KeepFailure } from "./train-run";
import { firstFireOfRun, hasFired, keptMark, resultOutcome, setMethodRun, type GrowRecord, type GrowState } from "./grow-view";
import { readoutText } from "./live-readout";
import type { MaterialKind } from "./material-kind";
import { readingRegion } from "./material-kind";
import { runWentDownInThisTab } from "./batch-size";
import { adapterUnavailable } from "./protocol";
import "./grow-status.css";

const WORDS = SITE_WORDS.grow;
/** The reader's parts: the dictionary loads one between updates, and readings start when all are in. */
const READER_PARTS = 32;
const number = (value: number) => value.toLocaleString("en-US");

/** Megabytes with one decimal, for the download line: 66.8. */
const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

/**
 * The model's download while a run starts: the file of the files and the megabytes received of the total;
 * null when nothing is downloading, before the first file and once every file is in.
 */
export function startupLine(record: GrowRecord): string | null {
  const startup = record.startup;
  if (!startup || startup.receivedBytes >= startup.totalBytes) return null;
  return fill(WORDS.startupDownload, {
    file: startup.file, files: startup.files, received: megabytes(startup.receivedBytes), total: megabytes(startup.totalBytes),
  });
}

/**
 * A failure in the site's words where it has them: no GPU just after a run took the page down is the
 * browser's state, and a reload gives it one again (protocol.ts adapterUnavailable); else the failure as it is.
 */
export function failureWords(failure: string): string {
  return reloadHelps(failure) ? WORDS.noAdapter : failure;
}

/** Whether a reload is the way out of a failure: no adapter right after a run took this tab's page down. */
export function reloadHelps(failure: string): boolean {
  return adapterUnavailable(failure) && runWentDownInThisTab();
}

/** The first line: the update counter is the clock; the fire, when it comes, in the Strongest tone. The corner tray shows it too. */
export function statusFirstLine(state: GrowState, record: GrowRecord): ReactNode {
  const fired = (words: string) => <span className="grow-fired">{words}</span>;
  // Before a run the line is empty: the frame shows the start itself.
  if (state === "idle") return "";
  if (state === "failed") return <span className="grow-failure">{failureWords(record.failure)}</span>;
  if (state === "loading") return startupLine(record) ?? (record.phaseMessage || WORDS.loading);
  if (state === "retry") return WORDS.retry;
  if (state === "done") {
    const result = resultOutcome(record);
    if (result?.fired) return fired(fill(WORDS.fired, { update: number(result.updates), tick: number(result.tick) }));
    // A set method keeps its one run's final rule: the selection is a reading, not the result's test.
    if (setMethodRun(record) && result) return fill(WORDS.finalSaved, { update: number(result.updates), tick: number(result.tick) });
    // A run the person kept, with runs still to try, or the last of the runs.
    const runs = record.run?.runs ?? 0;
    return record.run && record.run.run < runs ? WORDS.keptUnfired : fill(WORDS.noneFired, { runs });
  }
  // After Stop the counter names the held update.
  const counter = state === "stopped" ? WORDS.stopped : WORDS.update;
  const parts: ReactNode[] = [fill(counter, { update: number(record.progress?.completed ?? 0) })];
  if (record.run && record.run.run > 1) parts.push(fill(WORDS.run, { run: record.run.run, runs: record.run.runs }));
  const first = firstFireOfRun(record);
  if (state === "fired" && first) parts.push(fired(fill(WORDS.firstFire, { update: number(first.updates) })));
  // A set method's loss: its progress, where the selection may stay low (train-method.ts).
  if (setMethodRun(record) && record.progress) parts.push(fill(WORDS.methodLoss, { loss: record.progress.methodLoss.toPrecision(4) }));
  if (record.phase === "finishing") parts.push(WORDS.finishing);
  return parts.map((part, index) => <span key={index}>{index > 0 && " · "}{part}</span>);
}

/** The second line: the reading, or what it waits for. `block`: the run's basis group, named in the reading. */
function secondLine(state: GrowState, record: GrowRecord, kind: MaterialKind, block: number | null): string {
  // While the run starts, the page is free: the visitor may read other pages, and the corner tray keeps the run.
  if (state === "loading") return WORDS.startupNote;
  if (state === "idle" || state === "failed") return "";
  if (record.reading && block !== null) {
    const reading = readoutText(record.reading, block, readingRegion(kind), !setMethodRun(record));
    return state === "fired" && record.phase === "training" ? `${reading} · ${WORDS.trainingOn}` : reading;
  }
  if (record.progress && record.progress.readerChunks < READER_PARTS) {
    return fill(WORDS.readerLoading, { loaded: record.progress.readerChunks, all: READER_PARTS });
  }
  return "";
}

/**
 * The row under the frame: the selection map, two lines of words, and at the end the Kept mark,
 * or Download when Keep failed.
 */
export function GrowStatus({ state, record, kind, block, keepFailure, onDownload }: {
  state: GrowState;
  record: GrowRecord;
  /** The kind of the run, or the chosen one before a run. */
  kind: MaterialKind;
  /** The run's basis group, or the page's before a run; null while the page has none. */
  block: number | null;
  keepFailure: KeepFailure | null;
  onDownload: (failure: KeepFailure) => void;
}) {
  const reading = record.reading;
  let end: ReactNode = null;
  if (keepFailure) {
    end = <button type="button" className="button" onClick={() => onDownload(keepFailure)}>{WORDS.download}</button>;
  } else if (state !== "idle" && state !== "loading" && state !== "failed") {
    end = <span className="grow-kept" data-on={keptMark(state, record) || undefined}>{WORDS.kept}</span>;
  }
  return (
    <div className="grow-status">
      <SelectionMap selected={reading?.selectedPatches ?? null} region={readingRegion(kind)} fired={hasFired(state, record)} />
      <div className="grow-status-lines">
        <p className="grow-status-first">{statusFirstLine(state, record)}</p>
        <p className="grow-status-second">{keepFailure ? <span className="grow-failure">{WORDS.keepFailed}</span> : secondLine(state, record, kind, block)}</p>
      </div>
      {end}
    </div>
  );
}
