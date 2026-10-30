import { describe, expect, it } from "vitest";
import { RECORDING_BOUND, acceptStill, canSaveClip, emptyRecording, recordStill, type Recording, type Still } from "./recording";

const still = (step: number): Still => ({ step, blob: new Blob([String(step)]) });

function record(frames: number, from: Recording = emptyRecording()): Recording {
  let recording = from;
  for (let step = 0; step < frames; step++) recording = recordStill(recording, still(step));
  return recording;
}

describe("the recording's bound", () => {
  it("keeps every frame up to the bound", () => {
    const recording = record(RECORDING_BOUND);
    expect(recording.stills).toHaveLength(RECORDING_BOUND);
    expect(recording.stride).toBe(1);
    expect(recording.stills.map((kept) => kept.step)).toEqual(Array.from({ length: RECORDING_BOUND }, (_, step) => step));
  });

  it("past the bound drops every second still, keeps the first, and doubles the stride", () => {
    const recording = record(RECORDING_BOUND + 1);
    expect(recording.stride).toBe(2);
    expect(recording.stills).toHaveLength(RECORDING_BOUND / 2 + 1);
    expect(recording.stills.map((kept) => kept.step).slice(0, 4)).toEqual([0, 2, 4, 6]);
    expect(recording.stills.at(-1)?.step).toBe(RECORDING_BOUND);
  });

  it("then keeps every second frame, and thins again at the bound, so memory stays bounded", () => {
    const twice = record(2 * RECORDING_BOUND);
    expect(twice.stride).toBe(2);
    expect(twice.stills).toHaveLength(RECORDING_BOUND);
    expect(twice.stills.map((kept) => kept.step).every((step) => step % 2 === 0)).toBe(true);
    const long = record(10 * RECORDING_BOUND);
    expect(long.stride).toBe(16);
    expect(long.stills.length).toBeLessThanOrEqual(RECORDING_BOUND);
    expect(long.stills.length).toBeGreaterThan(RECORDING_BOUND / 2);
    expect(long.stills.at(-1)?.step).toBe(10 * RECORDING_BOUND - 16);
  });

  it("needs two stills before a clip can be saved", () => {
    expect(canSaveClip(emptyRecording())).toBe(false);
    expect(canSaveClip(record(1))).toBe(false);
    expect(canSaveClip(record(2))).toBe(true);
  });
});

describe("a still that finishes encoding after a Reset", () => {
  it("joins the recording only when its run is still the current one", () => {
    const firstRun = { type: "start", seed: 1 };
    const secondRun = { type: "start", seed: 1 };
    const kept = acceptStill(emptyRecording(), still(0), firstRun, firstRun);
    expect(kept.stills).toHaveLength(1);
    // Two stills were encoding when Reset landed: the run changed, so neither is kept.
    const afterRestart = acceptStill(acceptStill(emptyRecording(), still(0), firstRun, secondRun), still(1), firstRun, secondRun);
    expect(afterRestart.stills).toHaveLength(0);
    expect(canSaveClip(afterRestart)).toBe(false);
  });
});
