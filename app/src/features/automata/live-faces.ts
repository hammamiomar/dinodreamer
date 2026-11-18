// The wall's living faces. A deck's face is its automaton, grown in the browser when the deck comes into
// view: it shows the seed, quickly forms the image, then slowly reaches the tick its published
// picture was read at, and there it rests. A face at rest costs nothing. The pointer moving across a
// face stamps the brush on its cells, and the face runs again until the rule has had time to heal them.
//
// Every face shares one GPU device, and only a few emerge at once: a window shows fifteen decks, and
// the growth is the part worth watching, so they take their turns.

import { figurePlayback, type FigureMaterial } from "../../materials/material-file";
import { createFigureReplay, type FigureReplay } from "../../replay/figure-replay";
import { FIGURE_SHADERS } from "../../replay/figure-shaders";
import { startReplayLoop, type ReplayLoop } from "../../replay/replay-loop";

/** Only the seed and fast growth occupy an emergence turn. The slower finish can overlap the next turn. */
const MOST_EMERGING = 6;
const SEED_SECONDS = 0.16;
const EMERGENCE_STEPS_PER_SECOND = 600;
const MAX_EMERGENCE_TICKS = 160;
const EMERGENCE_FRACTION = 0.6;
const SETTLING_SECONDS = 4.5;
const HEAL_STEPS_PER_SECOND = 60;
/** A face is drawn at whole device pixels per cell, at most the replay's eight. */
const MOST_PIXELS_PER_CELL = 8;
/** The brush radius in cells of a 128-cell grid. */
const WAKE_RADIUS = 5;
/** After the pointer's last stamp a face runs for four seconds so the reader can see it heal. */
const HEAL_MS = 4000;

/** Reserve part of even a short reading for the slower motion, while early form emerges quickly. */
function emergedTick(readingTick: number): number {
  return Math.min(MAX_EMERGENCE_TICKS, Math.ceil(readingTick * EMERGENCE_FRACTION));
}

/** Absolute simulation tick after this much visible playback. Every face lands on its published reading. */
export function faceTickAtTime(seconds: number, readingTick: number): number {
  const growing = seconds - SEED_SECONDS;
  if (growing <= 0) return 0;
  const emerged = emergedTick(readingTick);
  const settling = growing - emerged / EMERGENCE_STEPS_PER_SECOND;
  if (settling < 0) return Math.floor(growing * EMERGENCE_STEPS_PER_SECOND);
  const fractionSettled = Math.min(1, settling / SETTLING_SECONDS);
  return emerged + Math.floor((readingTick - emerged) * fractionSettled);
}

let sharedDevice: Promise<GPUDevice> | null = null;

/** One device for every face. A lost device is asked for again by the next face that starts. */
function deviceForFaces(): Promise<GPUDevice> {
  if (sharedDevice) return sharedDevice;
  const request = (async () => {
    if (!navigator.gpu) throw new Error("This browser does not offer WebGPU.");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter is available.");
    const device = await adapter.requestDevice();
    void device.lost.then(() => { if (sharedDevice === request) sharedDevice = null; });
    return device;
  })();
  sharedDevice = request;
  void request.catch(() => { if (sharedDevice === request) sharedDevice = null; });
  return request;
}

let emerging = 0;
const waiting: (() => void)[] = [];

/**
 * A turn to emerge: `turn` resolves when fewer than MOST_EMERGING faces are emerging, first come first
 * served. `hurry` takes the turn at once, past the others: the face the reader is on does not wait.
 */
function turnToEmerge(signal: AbortSignal): { turn: Promise<void>; hurry: () => void } {
  let hurry = () => {};
  const turn = new Promise<void>((resolve, reject) => {
    const cancel = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal.reason);
    };
    const start = () => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) { reject(signal.reason); return; }
      emerging += 1;
      resolve();
    };
    if (emerging < MOST_EMERGING) { start(); return; }
    waiting.push(start);
    signal.addEventListener("abort", cancel, { once: true });
    hurry = () => {
      const place = waiting.indexOf(start);
      if (place < 0) return;
      waiting.splice(place, 1);
      start();
    };
  });
  return { turn, hurry: () => hurry() };
}

function endOfTurn(): void {
  emerging -= 1;
  // A face that gave up while it waited takes no turn: the next in line is asked instead.
  while (emerging < MOST_EMERGING && waiting.length > 0) waiting.shift()!();
}

export interface LiveFace {
  /** Run or hold the face: a face out of the window holds, and goes on from where it was when it returns. */
  setInView(inView: boolean): void;
  /** The pointer moved across the face between two places, given in cells from its top-left corner. */
  stroke(from: { x: number; y: number }, to: { x: number; y: number }): void;
  /** The reader is on this face: if it still waits for its turn to grow, it grows now. */
  hurry(): void;
  /** Draw the current cells again: a canvas that was hidden comes back empty. */
  redraw(): void;
  close(): void;
}

/**
 * Grow `material` on `canvas`, which must be laid out: its size on the screen sets the pixels per cell.
 * `onShown` is called at the first drawn frame and `onFailed` when the browser cannot grow it; after
 * `close` neither is called.
 */
export function openLiveFace(canvas: HTMLCanvasElement, material: FigureMaterial, grid: { side: number; seed: number; tick: number },
  events: { onShown: () => void; onFailed: (error: unknown) => void }): LiveFace {
  const closing = new AbortController();
  let replay: FigureReplay | null = null;
  let loop: ReplayLoop | null = null;
  let inView = true;
  let hasTurn = false;
  let shown = false;
  /** The time a face woken by the pointer runs until; 0 while it has not been touched since it came to rest. */
  let healUntil = 0;
  // The playback clock stops at rest. Its next interval starts when the reader brushes the face.
  let healingStartedAt: number | undefined;
  const giveTurnBack = () => {
    if (!hasTurn) return;
    hasTurn = false;
    endOfTurn();
  };
  const growing = () => replay !== null && replay.tick < grid.tick;
  const run = () => {
    if (!loop) return;
    if (shown && inView && (growing() || performance.now() < healUntil)) loop.play();
    else loop.pause();
  };
  const onFrame = (tick: number) => {
    if (!shown) { shown = true; events.onShown(); }
    if (tick >= emergedTick(grid.tick)) giveTurnBack();
    run();
  };

  let opening = false;
  let queued: ReturnType<typeof turnToEmerge> | undefined;
  async function emerge() {
    if (opening || loop || !inView || closing.signal.aborted) return;
    opening = true;
    queued = turnToEmerge(closing.signal);
    try {
      await queued.turn;
      hasTurn = true;
      // Visibility can change while waiting. An offscreen face tries again when it returns.
      if (!inView || closing.signal.aborted) { giveTurnBack(); return; }
      const device = await deviceForFaces();
      if (!inView || closing.signal.aborted) { giveTurnBack(); return; }
      const box = canvas.getBoundingClientRect();
      const scale = Math.min(MOST_PIXELS_PER_CELL, Math.max(1, Math.round((box.width * (window.devicePixelRatio || 1)) / grid.side)));
      const created = await createFigureReplay(
        { canvas, device, side: grid.side, seed: grid.seed, scale, ...figurePlayback(material.file), signal: closing.signal },
        { values: material.values, fireRate: material.file.rule.fireRate },
        FIGURE_SHADERS,
      );
      if (closing.signal.aborted) { created.dispose(); return; }
      replay = created;
      loop = startReplayLoop(created, {
        speed: 1, playing: false, onFrame,
        // The first paused draw presents the actual seed. Its visible time starts in onFrame.
        tickAtTime(seconds) {
          if (created.tick < grid.tick) return faceTickAtTime(seconds, grid.tick);
          healingStartedAt ??= seconds;
          return grid.tick + (seconds - healingStartedAt) * HEAL_STEPS_PER_SECOND;
        },
        onError: error => { giveTurnBack(); if (!closing.signal.aborted) events.onFailed(error); },
      });
    } catch (error) {
      giveTurnBack();
      if (!closing.signal.aborted) events.onFailed(error);
    } finally {
      queued = undefined;
      opening = false;
    }
  }
  void emerge();

  return {
    setInView(next) {
      inView = next;
      // A face that left the window while it emerged lets the next one start; it keeps what it has grown.
      if (next) void emerge();
      else giveTurnBack();
      run();
    },
    stroke(from, to) {
      if (!loop || !replay || replay.tick < emergedTick(grid.tick)) return;
      loop.stroke(from.x, from.y, to.x, to.y, (WAKE_RADIUS * grid.side) / 128);
      healUntil = performance.now() + HEAL_MS;
      run();
    },
    hurry() { queued?.hurry(); },
    redraw() {
      loop?.redraw();
    },
    close() {
      closing.abort(new DOMException("The face was closed.", "AbortError"));
      giveTurnBack();
      loop?.stop();
      replay?.dispose();
      loop = null;
      replay = null;
    },
  };
}
