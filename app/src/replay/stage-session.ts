import { assertUnsigned32 } from "../decode";
import type { FigureReplay } from "./figure-replay";
import { startReplayLoop, type ReplayLoop, type ReplayLoopOptions } from "./replay-loop";

/** One material's replay and its frame loop on the stage, from opening to closing. */
export interface StageSession {
  readonly replay: FigureReplay | null;
  readonly loop: ReplayLoop | null;
  /** Controls also apply while asynchronous initialization is pending. */
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  reseed(seed: number): void;
  /** Stop the loop and release the replay; a replay that is still starting is released when it arrives. */
  close(): void;
}

/**
 * Open a replay and start its loop, so that a closed session never touches its replay or the canvas
 * again: close aborts a start that is still waiting (createFigureReplay checks the signal after each
 * await, before it configures the shared canvas), a start that resolves after close is disposed at once,
 * and errors after close are not reported. The stage closes the old session before it opens the next,
 * so switching materials quickly is safe.
 */
export function openStageSession(
  create: (signal: AbortSignal) => Promise<FigureReplay>,
  options: ReplayLoopOptions,
  start: (replay: FigureReplay, options: ReplayLoopOptions) => ReplayLoop = startReplayLoop,
): StageSession {
  let closed = false;
  const starting = new AbortController();
  let replay: FigureReplay | null = null;
  let loop: ReplayLoop | null = null;
  let playing = options.playing;
  let speed = options.speed;
  let pendingSeed: number | undefined;
  const report = (error: unknown) => { if (!closed) options.onError?.(error); };
  create(starting.signal).then((created) => {
    if (closed) { created.dispose(); return; }
    replay = created;
    if (pendingSeed !== undefined) created.reseed(pendingSeed);
    loop = start(created, { ...options, playing, speed, onError: report });
  }).catch((error: unknown) => {
    loop?.stop();
    replay?.dispose();
    loop = null;
    replay = null;
    report(error);
  });
  return {
    get replay() { return replay; },
    get loop() { return loop; },
    setPlaying(next) {
      playing = next;
      if (next) loop?.play(); else loop?.pause();
    },
    setSpeed(next) {
      speed = next;
      loop?.setSpeed(next);
    },
    reseed(next) {
      assertUnsigned32(next, "Seed");
      pendingSeed = next;
      loop?.reseed(next);
    },
    close() {
      if (closed) return;
      closed = true;
      starting.abort();
      loop?.stop();
      replay?.dispose();
      loop = null;
      replay = null;
    },
  };
}
