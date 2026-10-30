// Run controls share one row, wrapping on narrow screens. Model loading and WebGPU
// availability gate Play and Step; failures offer Retry. Image and video downloads
// use the stage pixels and recorded stills. A reserved note line prevents preparation
// messages from moving the settings below the transport.

import { fill, fillNodes } from "../../app/site-words";
import { NumberInput } from "./cards/number-input";
import { CREATE_TEXT } from "./create-text";
import { ImageGlyph, VideoGlyph } from "./glyphs";
import { ResetMark } from "../../ui/reset-mark";
import { MODEL_LINE, type ModelGate } from "./run/model-download";
import { latestShown, stepsPerSecond, type RunState } from "./run/session";

const WORDS = CREATE_TEXT.transport;

/** Save image: the stage has a picture to save. */
export interface ImageControl {
  ready: boolean;
  onSave(): void;
}

export interface ClipControl {
  /** Two stills are kept: a clip can be saved. */
  ready: boolean;
  /** The clip is being encoded; the control waits. */
  saving: boolean;
  /** Why the last save failed, until the next one. */
  failure: string | null;
  onSave(): void;
}

export function Transport({
  session,
  seed,
  storedStep,
  clip,
  image,
  gate,
  onRun,
  onPause,
  onStep,
  onSeed,
  onReset,
}: {
  session: RunState;
  seed: number;
  /** The step of a reopened creation's saved picture, shown until the run restores it. */
  storedStep?: number;
  clip: ClipControl;
  image: ImageControl;
  /** What stands before a run: asking to load the model, or a browser without WebGPU. */
  gate: ModelGate;
  /** Play (or Retry); while the gate asks, this is "Load the model", which loads it and runs. */
  onRun(): void;
  onPause(): void;
  onStep(): void;
  onSeed(seed: number): void;
  /** Reset: back to the starting image of `seed`, with the same requests. */
  onReset(seed: number): void;
}) {
  const failed = session.phase === "failed" || session.error?.fatal === true;
  const playWord = failed ? WORDS.retry : WORDS.play;
  const rate = stepsPerSecond(session);
  const note = runNote(session, gate, clip.failure);
  const step = shownStep(session, storedStep);
  const rateText = rate !== undefined && session.wantsRunning ? fill(WORDS.rate, { rate: rate.toFixed(rate < 1 ? 2 : 1) }) : undefined;
  return (
    <div className="transport" data-gate={gate ?? undefined}>
      <div className="transport-run">
        {gate === "ask" ? (
          <button type="button" className="button primary" onClick={onRun}>
            {WORDS.loadModel}
          </button>
        ) : session.wantsRunning ? (
          <button type="button" className="button primary transport-play" onClick={onPause}>
            {WORDS.pause}
          </button>
        ) : (
          <button type="button" className="button primary transport-play" onClick={onRun} disabled={gate === "unsupported"}>
            {playWord}
          </button>
        )}
        <button type="button" className="button" onClick={onStep} disabled={gate !== null || failed || session.wantsRunning}>
          {WORDS.step}
        </button>
        <button type="button" className="button reset-control" aria-label={WORDS.reset} title={WORDS.reset} onClick={() => onReset(seed)}>
          <ResetMark />
        </button>
      </div>
      <label className="transport-seed label">
        {WORDS.seedWord}
        <NumberInput value={seed} label={WORDS.seedName} integer width={SEED_FIELD_WIDTH} onCommit={onSeed} />
      </label>
      <span className="transport-save label">
        {WORDS.saveWord}
        <button type="button" className="button transport-glyph" title={WORDS.saveImageTitle} onClick={image.onSave} disabled={!image.ready}>
          <ImageGlyph />
          <span className="glyph-name">{WORDS.saveImage}</span>
        </button>
        <button type="button" className="button transport-glyph" title={WORDS.saveVideoTitle} onClick={clip.onSave} disabled={!clip.ready || clip.saving} aria-busy={clip.saving || undefined}>
          {clip.saving ? <span aria-hidden="true">…</span> : <VideoGlyph />}
          <span className="glyph-name">{clip.saving ? WORDS.savingVideo : WORDS.saveVideo}</span>
        </button>
      </span>
      {step !== undefined && (
        <span className="transport-step label mono" title={rateText}>
          {fillNodes(WORDS.stepCount, { step: <b>{step}</b> })}
        </span>
      )}
      {gate === "ask" && <p className="transport-model label">{MODEL_LINE}</p>}
      <p className="transport-note label" data-passing={note?.passing || undefined} title={note?.passing ? note.text : undefined}>
        {note?.text}
      </p>
    </div>
  );
}

/** The count once there is a step: a stored picture's, or the run's from its start; none before. */
function shownStep(session: RunState, storedStep: number | undefined): number | undefined {
  if (storedStep !== undefined) return storedStep;
  if (session.applied === undefined) return undefined;
  return latestShown(session)?.step ?? 0;
}

/** The seed field's width with a mouse: four digits and the field's spin buttons. */
const SEED_FIELD_WIDTH = 48;

/** Without WebGPU: which browsers paint, and what still works here. */
export const NO_WEBGPU = WORDS.noWebGpu;

/** A note under the transport: what blocks, or a passing state, which keeps to its one line. */
interface RunNote {
  text: string;
  /** The worker prepares or reports its phase: it passes by itself, so it does not take a second line. */
  passing: boolean;
}

function runNote(session: RunState, gate: ModelGate, clipFailure: string | null): RunNote | null {
  if (clipFailure) return { text: fill(WORDS.notSaved, { message: clipFailure }), passing: false };
  if (gate === "unsupported") return { text: NO_WEBGPU, passing: false };
  return transportNote(session);
}

/** What blocks the run, or what the worker is preparing; nothing when nothing blocks. */
export function transportNote(session: RunState): RunNote | null {
  if (session.capabilities && !session.capabilities.webgpu) return { text: NO_WEBGPU, passing: false };
  if (session.error) return { text: session.error.message, passing: false };
  if (session.rejected) return { text: fill(WORDS.revisionRejected, { revision: session.rejected.revision, message: session.rejected.message }), passing: false };
  if (session.refused) {
    const command = session.refused.command === "run" ? WORDS.play : WORDS.step;
    return { text: fill(WORDS.refused, { command, message: session.refused.message }), passing: false };
  }
  if (session.phase === "paused" && session.phaseMessage) return { text: session.phaseMessage, passing: true };
  if (session.phase === "loading") return { text: session.progress?.message ?? WORDS.preparingDevice, passing: true };
  if (session.phase === "preparing") return { text: session.phaseMessage ?? WORDS.preparingRequest, passing: true };
  return null;
}

/** Shown over the canvas until the first objective is installed. */
export function PrepareOverlay({ session }: { session: RunState }) {
  const preparingFirst = session.phase === "loading" || (session.phase === "preparing" && !session.applied);
  if (!preparingFirst) return null;
  const progress = session.progress;
  const fraction = progress && progress.bytesTotal > 0 ? progress.bytesDone / progress.bytesTotal : 0;
  return (
    <div className="prepare-overlay">
      <div className="prepare-card">
        <b>{WORDS.preparingDevice}</b>
        <p className="label">{session.phase === "loading" ? WORDS.downloading : WORDS.encoding}</p>
        {progress && (
          <>
            <div className="prepare-bar">
              <i style={{ width: `${fraction * 100}%` }} />
            </div>
            <div className="prepare-numbers label mono">
              <span>{fill(WORDS.megabytes, { done: megabytes(progress.bytesDone), total: megabytes(progress.bytesTotal) })}</span>
              <span>{session.capabilities?.adapter ?? progress.message}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(0);
}
