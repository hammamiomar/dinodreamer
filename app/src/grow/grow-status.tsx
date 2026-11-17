import type { ReactNode } from "react";
import { SITE_WORDS, fill } from "../app/site-words";
import { SelectionMap } from "./selection-map";
import type { KeepFailure } from "./train-run";
import { firstFireOfRun, hasFired, keptMark, resultOutcome, setMethodRun, type GrowRecord, type GrowState } from "./grow-view";
import { readoutText } from "./live-readout";
import type { MaterialKind } from "./material-kind";
import { readingRegion } from "./material-kind";
import "./grow-status.css";

const WORDS = SITE_WORDS.grow;
/** The reader's parts: the dictionary loads one between updates, and readings start when all are in. */
const READER_PARTS = 32;
const number = (value: number) => value.toLocaleString("en-US");

/** The first line: the update counter is the clock; the fire, when it comes, in the Strongest tone. The corner tray shows it too. */
export function statusFirstLine(state: GrowState, record: GrowRecord): ReactNode {
  const fired = (words: string) => <span className="grow-fired">{words}</span>;
  // Before a run the line is empty: the frame shows the start itself.
  if (state === "idle") return "";
  if (state === "failed") return <span className="grow-failure">{record.failure}</span>;
  if (state === "loading") return record.phaseMessage || WORDS.loading;
  if (state === "retry") return WORDS.retry;
  if (state === "done") {
    const result = resultOutcome(record);
    if (result?.fired) return fired(fill(WORDS.fired, { update: number(result.updates) }));
    // A set method keeps its one run's final rule: the selection is a reading, not the result's test.
    if (setMethodRun(record)) return fill(WORDS.finalSaved, { update: number(result?.updates ?? 0) });
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
  if (state === "idle" || state === "loading" || state === "failed") return "";
  if (record.reading && block !== null) {
    const reading = readoutText(record.reading, block, readingRegion(kind));
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
