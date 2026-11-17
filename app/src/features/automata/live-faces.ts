// The wall's living faces. A deck's face is its automaton, grown in the browser when the deck comes into
// view: from noise, quickly until its image has emerged, then slowly until the tick its published
// picture was read at, and there it rests. A face at rest costs nothing. The pointer moving across a
// face stamps the brush on its cells, and the face runs again until the rule has had time to heal them.
//
// Every face shares one GPU device, and only a few emerge at once: a window shows fifteen decks, and
// the growth is the part worth watching, so they take their turns.

import { figurePlayback, type FigureMaterial } from "../../materials/material-file";
import { createFigureReplay, type FigureReplay } from "../../replay/figure-replay";
import { FIGURE_SHADERS } from "../../replay/figure-shaders";
import { startReplayLoop, type ReplayLoop } from "../../replay/replay-loop";

/** Faces that emerge from noise at the same time. Each steps EMERGE_SPEED ticks a frame while it does. */
const MOST_EMERGING = 6;
/** Ticks per frame from noise until EMERGED_TICK, about a third of a second: the image is there. */
const EMERGE_SPEED = 8;
const EMERGED_TICK = 160;
/**
 * Then ticks per frame until the face rests at the automaton's reading step, where its picture was read:
 * 600 for basis-group mean matching, the step of the lowest own loss for a set method (100 to 2,000).
 * At least SETTLE_SPEED; faster for a late step, so the way there takes about SETTLE_FRAMES frames, as
 * the way to step 600 does at SETTLE_SPEED.
 */
const SETTLE_SPEED = 2;
const SETTLE_FRAMES = 220;

/**
 * The ticks the face steps in its next frame on its way to rest at `restingTick`: fast while the image
 * emerges, then slower, and never past the step it rests at. 0 once it is there.
 */
export function faceSpeed(tick: number, restingTick: number): number {
  if (tick >= restingTick) return 0;
  const settle = Math.max(SETTLE_SPEED, Math.ceil((restingTick - EMERGED_TICK) / SETTLE_FRAMES));
  return Math.min(tick < EMERGED_TICK ? EMERGE_SPEED : settle, restingTick - tick);
}
/** After the pointer's last stamp a face runs this long, at one tick a frame, so the rule heals it in sight. */
const HEAL_MS = 4000;
/** The brush the pointer carries across a face, in cells of a 128-cell grid: under half the stage's brush. */
const WAKE_RADIUS = 5;
/** A face is drawn at whole device pixels per cell, at most the replay's eight. */
const MOST_PIXELS_PER_CELL = 8;

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
    const start = () => {
      if (signal.aborted) { reject(signal.reason); return; }
      emerging += 1;
      resolve();
    };
    if (emerging < MOST_EMERGING) { start(); return; }
    waiting.push(start);
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
  const giveTurnBack = () => {
    if (!hasTurn) return;
    hasTurn = false;
    endOfTurn();
  };
  const growing = () => replay !== null && replay.tick < grid.tick;
  const run = () => {
    if (!loop) return;
    if (inView && (growing() || performance.now() < healUntil)) loop.play();
    else loop.pause();
  };
  const onFrame = (tick: number) => {
    if (!shown) { shown = true; events.onShown(); }
    // The image is there at EMERGED_TICK, or earlier for an automaton read before it.
    if (tick >= Math.min(EMERGED_TICK, grid.tick)) giveTurnBack();
    if (!loop) return;
    const speed = faceSpeed(tick, grid.tick);
    if (speed > 0) loop.setSpeed(speed);
    else {
      loop.setSpeed(1);
      if (performance.now() >= healUntil) loop.pause();
    }
  };

  const queued = turnToEmerge(closing.signal);
  (async () => {
    await queued.turn;
    hasTurn = true;
    const device = await deviceForFaces();
    const box = canvas.getBoundingClientRect();
    const scale = Math.min(MOST_PIXELS_PER_CELL, Math.max(1, Math.round((box.width * (window.devicePixelRatio || 1)) / grid.side)));
    const created = await createFigureReplay(
      { canvas, device, side: grid.side, seed: grid.seed, scale, ...figurePlayback(material.file), signal: closing.signal },
      { values: material.values, fireRate: material.file.rule.fireRate },
      FIGURE_SHADERS,
    );
    if (closing.signal.aborted) { created.dispose(); return; }
    replay = created;
    loop = startReplayLoop(created, { speed: EMERGE_SPEED, playing: inView, onFrame, onError: (error) => { giveTurnBack(); if (!closing.signal.aborted) events.onFailed(error); } });
  })().catch((error: unknown) => {
    giveTurnBack();
    if (!closing.signal.aborted) events.onFailed(error);
  });

  return {
    setInView(next) {
      inView = next;
      // A face that left the window while it emerged lets the next one start; it keeps what it has grown.
      if (!next) giveTurnBack();
      run();
    },
    stroke(from, to) {
      if (!loop || !replay || replay.tick < EMERGED_TICK) return;
      loop.stroke(from.x, from.y, to.x, to.y, (WAKE_RADIUS * grid.side) / 128);
      healUntil = performance.now() + HEAL_MS;
      run();
    },
    hurry: queued.hurry,
    redraw() {
      if (loop && replay) void loop.hold(async () => {}).catch(() => {});
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
