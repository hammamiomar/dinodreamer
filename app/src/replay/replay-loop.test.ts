import { describe, expect, it } from "vitest";
import type { FigureReplay } from "./figure-replay";
import { REPLAY_DEFAULT_SPEED, REPLAY_SPEEDS, speedLabel, startReplayLoop } from "./replay-loop";

/** A replay double that records the order of calls; the loop never needs a GPU. */
function replayStub() {
  const calls: string[] = [];
  let tick = 0;
  const replay = {
    side: 128, seed: 1, damages: 0,
    get tick() { return tick; },
    reseed(seed: number) { calls.push(`reseed ${seed}`); tick = 0; },
    async advance(count: number) { calls.push(`advance ${count}`); tick += count; },
    async present() { calls.push("present"); },
    async damage(x: number, y: number, radius: number) { calls.push(`damage ${x},${y},${radius}`); },
    async stamp(discs: { x: number; y: number; radius: number }[]) { calls.push(`stamp ${discs.map((disc) => `${disc.x},${disc.y},${disc.radius}`).join(" ")}`); },
  } as unknown as FigureReplay;
  return { replay, calls };
}

/** Frames run only when the test asks, one scheduled callback at a time. */
function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    get pending() { return queue.length; },
    schedule: (callback: () => void) => { queue.push(callback); },
    async frame() {
      queue.shift()?.();
      for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    },
  };
}

describe("replay loop", () => {
  it("steps by the speed while playing and redraws once while paused", async () => {
    const { replay, calls } = replayStub();
    const frames = manualFrames();
    const ticks: number[] = [];
    const loop = startReplayLoop(replay, { speed: 2, playing: true, schedule: frames.schedule, onFrame: (tick) => ticks.push(tick) });
    await frames.frame(); await frames.frame();
    loop.pause();
    await frames.frame(); await frames.frame();
    expect(calls).toEqual(["advance 2", "advance 2"]);
    expect(ticks).toEqual([2, 4]);
    loop.reseed(9);
    await frames.frame(); await frames.frame();
    expect(calls.slice(2)).toEqual(["reseed 9", "present"]);
  });

  it("sleeps when clean and coalesces edits that arrive during a paused draw", async () => {
    const { replay, calls } = replayStub();
    const frames = manualFrames();
    const loop = startReplayLoop(replay, { speed: 1, playing: false, schedule: frames.schedule });
    await frames.frame();
    expect(frames.pending).toBe(0);
    let finish!: () => void;
    const present = replay.present;
    replay.present = () => new Promise<void>(resolve => { finish = resolve; });
    loop.redraw();
    await frames.frame();
    loop.redraw();
    loop.damage(1, 2, 3);
    expect(frames.pending).toBe(0);
    replay.present = present;
    finish();
    await frames.frame();
    expect(frames.pending).toBe(1);
    await frames.frame();
    expect(calls).toEqual(["present", "stamp 1,2,3", "present"]);
    expect(frames.pending).toBe(0);
    for (const change of [() => loop.reseed(2), () => loop.setSpeed(2), () => loop.redraw()]) {
      change();
      expect(frames.pending).toBe(1);
      await frames.frame();
      expect(frames.pending).toBe(0);
    }
    loop.play();
    await frames.frame();
    expect(calls.at(-1)).toBe("advance 2");
  });

  it("holds each tick for 2 or 4 frames below one tick per frame, and still draws a stamp at once", async () => {
    const { replay, calls } = replayStub();
    const frames = manualFrames();
    const ticks: number[] = [];
    const loop = startReplayLoop(replay, { speed: 0.25, playing: true, schedule: frames.schedule, onFrame: (tick) => ticks.push(tick) });
    // The first frame draws the start; then one tick every fourth frame.
    for (let frame = 0; frame < 8; frame++) await frames.frame();
    expect(calls).toEqual(["present", "advance 1", "advance 1"]);
    expect(ticks).toEqual([0, 1, 2]);
    loop.damage(1, 2, 3);
    await frames.frame();
    expect(calls.slice(3)).toEqual(["stamp 1,2,3", "present"]);
    loop.setSpeed(0.5);
    for (let frame = 0; frame < 4; frame++) await frames.frame();
    expect(calls.slice(5)).toEqual(["advance 1", "advance 1"]);
    expect(() => loop.setSpeed(0.3)).toThrow(/1\/4, 1\/2 or 1–64/);
    expect(() => loop.setSpeed(65)).toThrow(/1\/4, 1\/2 or 1–64/);
    expect(REPLAY_SPEEDS.map(speedLabel)).toEqual(["¼x", "½x", "1x", "2x", "4x", "8x"]);
  });

  it("starts every player at 1x, the third of the speed control's six steps", () => {
    expect(speedLabel(REPLAY_DEFAULT_SPEED)).toBe("1x");
    expect(REPLAY_SPEEDS.indexOf(REPLAY_DEFAULT_SPEED)).toBe(2);
  });

  it("shows tick 0 for a full hold after a Reset in the middle of a slow hold", async () => {
    for (const [speed, expected] of [[0.25, [0, 0, 0, 1]], [0.5, [0, 1, 1, 2]]] as const) {
      const { replay, calls } = replayStub();
      const frames = manualFrames();
      const loop = startReplayLoop(replay, { speed, playing: true, schedule: frames.schedule });
      // Into the second tick's hold: at 1/4, three frames of tick 1; at 1/2, one frame of tick 1.
      for (let frame = 0; frame < (speed === 0.25 ? 7 : 3); frame++) await frames.frame();
      expect(replay.tick).toBe(1);
      loop.reseed(9);
      const ticks: number[] = [];
      for (let frame = 0; frame < 4; frame++) { await frames.frame(); ticks.push(replay.tick); }
      expect(ticks).toEqual(expected);
      expect(calls.slice(calls.indexOf("reseed 9"), calls.indexOf("reseed 9") + 2)).toEqual(["reseed 9", "present"]);
    }
  });

  it("applies queued damage before the step, and a reseed drops damage not yet applied", async () => {
    const { replay, calls } = replayStub();
    const frames = manualFrames();
    const loop = startReplayLoop(replay, { speed: 1, playing: true, schedule: frames.schedule });
    loop.damage(1, 2, 3); loop.damage(4, 5, 6);
    await frames.frame();
    loop.damage(7, 8, 9); loop.reseed(3);
    await frames.frame();
    expect(calls).toEqual(["stamp 1,2,3 4,5,6", "advance 1", "reseed 3", "advance 1"]);
  });

  it("stamps a stroke every quarter radius after its start, and nothing for a pointer that holds still", async () => {
    const { replay, calls } = replayStub();
    const frames = manualFrames();
    const loop = startReplayLoop(replay, { speed: 1, playing: false, schedule: frames.schedule });
    loop.stroke(10, 10, 10, 10, 8);
    loop.stroke(0, 0, 4, 0, 8);
    await frames.frame();
    expect(calls).toEqual(["stamp 2,0,8 4,0,8", "present"]);
  });

  it("holds frames while a recording owns the replay, then resumes", async () => {
    const { replay, calls } = replayStub();
    const frames = manualFrames();
    const loop = startReplayLoop(replay, { speed: 1, playing: true, schedule: frames.schedule });
    let finish!: () => void;
    const held = loop.hold(() => new Promise<void>((resolve) => { finish = resolve; }));
    await frames.frame(); await frames.frame();
    expect(calls).toEqual([]);
    finish(); await held;
    await frames.frame();
    expect(calls).toEqual(["advance 1"]);
  });

  it("serializes a readback and a recording, keeping playback held until both finish", async () => {
    const { replay, calls } = replayStub();
    const frames = manualFrames();
    const loop = startReplayLoop(replay, { speed: 1, playing: true, schedule: frames.schedule });
    const order: string[] = [];
    let finishRead!: () => void;
    let finishRecording!: () => void;
    const read = loop.hold(() => {
      order.push("read");
      return new Promise<void>((resolve) => { finishRead = resolve; });
    });
    const recording = loop.hold(() => {
      order.push("record");
      return new Promise<void>((resolve) => { finishRecording = resolve; });
    });
    await frames.frame();
    expect(order).toEqual(["read"]);
    finishRead();
    await read;
    await frames.frame();
    expect(order).toEqual(["read", "record"]);
    expect(calls).toEqual([]);
    finishRecording();
    await recording;
    await frames.frame();
    expect(calls).toEqual(["advance 1"]);
    loop.stop();
  });

  it("continues queued work after an earlier held operation fails", async () => {
    const { replay } = replayStub();
    const frames = manualFrames();
    const loop = startReplayLoop(replay, { speed: 1, playing: false, schedule: frames.schedule });
    const failed = loop.hold(async () => { throw new Error("read failed"); });
    const next = loop.hold(async () => 7);
    await expect(failed).rejects.toThrow("read failed");
    await expect(next).resolves.toBe(7);
    loop.stop();
  });

  it("does not report an in-flight frame after the player closes", async () => {
    const { replay } = replayStub();
    const frames = manualFrames();
    let finish!: () => void;
    replay.advance = () => new Promise<void>((resolve) => { finish = resolve; });
    const ticks: number[] = [];
    const loop = startReplayLoop(replay, { speed: 1, playing: true, schedule: frames.schedule, onFrame: (tick) => ticks.push(tick) });
    await frames.frame();
    loop.stop();
    finish();
    await frames.frame();
    expect(ticks).toEqual([]);
  });

  it("stops playing and reports a failed frame", async () => {
    const { replay } = replayStub();
    replay.advance = async () => { throw new Error("device lost"); };
    const frames = manualFrames();
    const errors: unknown[] = [];
    const loop = startReplayLoop(replay, { speed: 1, playing: true, schedule: frames.schedule, onError: (error) => errors.push(error) });
    await frames.frame();
    expect(loop.playing).toBe(false);
    expect(String(errors[0])).toContain("device lost");
    expect(() => loop.setSpeed(0)).toThrow(/Speed/);
  });
});
