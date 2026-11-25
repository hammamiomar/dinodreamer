import type { FigureReplay } from "./figure-replay";

/** The players' speeds in ticks per drawn frame; at 60 frames a second, 1 is 60 ticks a second. */
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
/** Every player starts at one tick per frame, or 60 ticks per second at 60 fps. */
export const REPLAY_DEFAULT_SPEED = 1;
const SPEED_FRACTIONS: Record<number, string> = { 0.25: "¼", 0.5: "½" };

/** "¼x", "½x", "1x", "8x". */
export function speedLabel(speed: number): string {
  return `${SPEED_FRACTIONS[speed] ?? speed}x`;
}

export interface ReplayLoopOptions {
  /** Ticks per drawn frame: 1 to 64, or 1/2 and 1/4, which hold each tick for 2 and 4 frames. */
  speed: number;
  /**
   * Ticks per second instead of per frame: each frame steps by the time that has passed since the last,
   * so every screen shows the same pace, whatever its frame rate. A frame counts for at most 100 ms, so a
   * hitch or a hidden tab is not made up in one jump; a frame steps at most 64 ticks. Absent: `speed`.
   */
  stepsPerSecond?: number;
  /** For a changing pace, use this function instead of stepsPerSecond. It gives the absolute tick
   * after the specified playback time. A pause holds the clock and a reseed starts it at zero. */
  tickAtTime?: (seconds: number) => number;
  playing: boolean;
  /** Called after every drawn frame with the replay's tick. */
  onFrame?: (tick: number) => void;
  onError?: (error: unknown) => void;
  /** requestAnimationFrame in a page; tests step frames by hand. */
  schedule?: (callback: () => void) => void;
}
export interface ReplayLoop {
  readonly playing: boolean;
  readonly speed: number;
  play(): void;
  pause(): void;
  /** Present the current cells again, including while paused. */
  redraw(): void;
  setSpeed(speed: number): void;
  /** A new pace for a loop started with stepsPerSecond; a loop that counts steps per frame throws. */
  setStepsPerSecond(stepsPerSecond: number): void;
  /** Grow again from this seed's noise at tick 0. */
  reseed(seed: number): void;
  /** Queue a damage disc; the next frame applies it before stepping. */
  damage(x: number, y: number, radius: number): void;
  /**
   * Queue the stamps of one pointer movement from (x0, y0) to (x1, y1): soft discs every quarter
   * radius along the segment, the start excluded, so holding still stamps nothing.
   */
  stroke(x0: number, y0: number, x1: number, y1: number, radius: number): void;
  /** Run `work` with the loop held between frames: a recording owns the replay meanwhile. */
  hold<T>(work: () => Promise<T>): Promise<T>;
  stop(): void;
}

/**
 * One frame at a time: queued edits, then a step or a redraw. GPU work is awaited
 * before the next frame starts, so edits and steps never interleave. Like the
 * replay itself, this has no runtime imports: an exported page embeds its source.
 */
export function startReplayLoop(replay: FigureReplay, options: ReplayLoopOptions): ReplayLoop {
  const schedule = options.schedule ?? ((callback: () => void) => requestAnimationFrame(() => callback()));
  let playing = options.playing;
  let speed = options.speed;
  let stopped = false;
  let holds = 0;
  // Sampling and recording can request the replay in the same frame. They must run in order.
  let heldWork: Promise<void> = Promise.resolve();
  let dirty = true;
  // Below one tick per frame, the frames the current tick has been shown.
  let framesOnTick = 0;
  let pendingSeed: number | undefined;
  const pendingDamage: [number, number, number][] = [];
  // In steps per second: when the last frame ran, and the part of a tick that time has owed since.
  const MOST_FRAME_MS = 100;
  const MOST_TICKS_PER_FRAME = 64;
  const checkRate = (value: number) => {
    if (!(value > 0 && Number.isFinite(value))) throw new Error("Steps per second must be a positive number.");
    return value;
  };
  let rate = options.stepsPerSecond === undefined ? undefined : checkRate(options.stepsPerSecond);
  let lastFrameAt = performance.now();
  let secondsPlayed = 0;
  let owed = 0;
  const checkSpeed = (value: number) => {
    const held = value === 0.5 || value === 0.25;
    if (!held && !(Number.isInteger(value) && value >= 1 && value <= 64)) throw new Error("Speed is 1/4, 1/2 or 1–64 simulation steps per frame.");
    return value;
  };
  checkSpeed(speed);

  const frame = async () => {
    let redraw = dirty;
    dirty = false;
    if (pendingSeed !== undefined) {
      replay.reseed(pendingSeed);
      pendingSeed = undefined;
      if (options.tickAtTime) {
        secondsPlayed = 0;
        lastFrameAt = performance.now();
      }
      // A reset starts a new hold, so tick 0 shows for its full 1/speed frames like any other tick.
      framesOnTick = 0;
      redraw = true;
    }
    if (pendingDamage.length) {
      const discs = pendingDamage.splice(0).map(([x, y, radius]) => ({ x, y, radius }));
      await replay.stamp(discs);
      redraw = true;
    }
    if (playing && (options.tickAtTime || rate !== undefined)) {
      const now = performance.now();
      const seconds = Math.min(Math.max(now - lastFrameAt, 0), MOST_FRAME_MS) / 1000;
      lastFrameAt = now;
      let ticks: number;
      if (options.tickAtTime) {
        secondsPlayed += seconds;
        const target = Math.floor(options.tickAtTime(secondsPlayed));
        ticks = Math.min(Math.max(0, target - replay.tick), MOST_TICKS_PER_FRAME);
      } else {
        owed += seconds * rate!;
        ticks = Math.min(Math.floor(owed), MOST_TICKS_PER_FRAME);
        owed -= ticks;
      }
      if (ticks > 0) await replay.advance(ticks);
      else if (redraw) await replay.present();
      else return;
    } else if (playing && speed >= 1) await replay.advance(speed);
    else if (playing && ++framesOnTick >= 1 / speed) {
      framesOnTick = 0;
      await replay.advance(1);
    } else if (redraw) await replay.present();
    else return;
    if (!stopped) options.onFrame?.(replay.tick);
  };
  let inFlight: Promise<void> = Promise.resolve();
  let scheduled = false;
  let drawing = false;
  const needsFrame = () => playing || dirty || pendingSeed !== undefined || pendingDamage.length > 0;
  function wake() {
    if (stopped || scheduled || drawing || holds > 0 || !needsFrame()) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      if (stopped || holds > 0 || !needsFrame()) return;
      drawing = true;
      inFlight = frame().catch((error: unknown) => {
        if (stopped) return;
        playing = false;
        options.onError?.(error);
      }).finally(() => {
        drawing = false;
        wake();
      });
    });
  }
  wake();

  return {
    get playing() { return playing; },
    get speed() { return speed; },
    play() {
      // The time it was paused is not owed.
      if (!playing) { lastFrameAt = performance.now(); owed = 0; }
      playing = true;
      wake();
    },
    pause() { playing = false; },
    redraw() { dirty = true; wake(); },
    setSpeed(value) {
      if (speed === checkSpeed(value)) return;
      speed = value;
      framesOnTick = 0;
      if (!playing) dirty = true;
      wake();
    },
    setStepsPerSecond(value) {
      if (rate === undefined) throw new Error("This loop counts steps per frame: use setSpeed.");
      rate = checkRate(value);
    },
    reseed(seed) {
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be an unsigned 32-bit integer.");
      pendingSeed = seed;
      pendingDamage.length = 0;
      wake();
    },
    damage(x, y, radius) { pendingDamage.push([x, y, radius]); wake(); },
    stroke(x0, y0, x1, y1, radius) {
      const spacing = Math.max(radius / 4, 1);
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / spacing);
      for (let step = 1; step <= steps; step++) {
        pendingDamage.push([x0 + (x1 - x0) * step / steps, y0 + (y1 - y0) * step / steps, radius]);
      }
      wake();
    },
    async hold(work) {
      holds++;
      const result = heldWork.then(async () => {
        await inFlight;
        return work();
      });
      heldWork = result.then(() => {}, () => {});
      try { return await result; }
      finally { holds--; dirty = true; wake(); }
    },
    stop() { stopped = true; },
  };
}
