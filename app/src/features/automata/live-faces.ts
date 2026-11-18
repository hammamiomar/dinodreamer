// Each visible face runs its own published rule from the seed to the reading step.
// Faces share a device. Opening a replay takes a turn. Growth follows one rate regardless
// of the reading step or display refresh rate, and a face at rest schedules no frames.

import { figurePlayback, type FigureMaterial } from "../../materials/material-file";
import { createFigureReplay, type FigureReplay } from "../../replay/figure-replay";
import { FIGURE_SHADERS } from "../../replay/figure-shaders";
import { startReplayLoop, type ReplayLoop } from "../../replay/replay-loop";

/** Limit concurrent shader and buffer setup. Release the turn as soon as the seed is on the canvas. */
const MAX_OPENING_FACES = 2;
/** One simulation tick per 60 Hz frame, including while a face heals after a stroke. */
const STEPS_PER_SECOND = 60;
const MOST_PIXELS_PER_CELL = 8;
const WAKE_RADIUS = 5;
const HEAL_MS = 4000;

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

let openingFaces = 0;
const waiting: (() => void)[] = [];

/**
 * A turn to open: `turn` resolves when a setup slot is free, first come first
 * served. `hurry` takes the turn at once, past the others: the face the reader is on does not wait.
 */
function turnToOpen(signal: AbortSignal): { turn: Promise<void>; hurry: () => void } {
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
      openingFaces += 1;
      resolve();
    };
    if (openingFaces < MAX_OPENING_FACES) { start(); return; }
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
  openingFaces -= 1;
  // A face that gave up while it waited takes no turn: the next in line is asked instead.
  while (openingFaces < MAX_OPENING_FACES && waiting.length > 0) waiting.shift()!();
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
  const onFrame = () => {
    if (!shown) { shown = true; events.onShown(); }
    giveTurnBack();
    run();
  };

  let opening = false;
  let queued: ReturnType<typeof turnToOpen> | undefined;
  async function openReplay() {
    if (opening || loop || !inView || closing.signal.aborted) return;
    opening = true;
    queued = turnToOpen(closing.signal);
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
        // Draw the seed first, then advance on the same clock through growth and brush recovery.
        tickAtTime(seconds) {
          const tick = seconds * STEPS_PER_SECOND;
          return created.tick < grid.tick ? Math.min(tick, grid.tick) : tick;
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
  void openReplay();

  return {
    setInView(next) {
      inView = next;
      // An offscreen face releases its setup slot and keeps its current cells.
      if (next) void openReplay();
      else giveTurnBack();
      run();
    },
    stroke(from, to) {
      if (!loop || !replay || replay.tick === 0) return;
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
