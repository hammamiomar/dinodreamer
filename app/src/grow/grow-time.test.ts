import { describe, expect, it } from "vitest";
import { MEASURED_AFTER, durationText, timeBefore, timeLeft, timeTaken } from "./grow-time";
import type { MaterialKind } from "./material-kind";

const FINE_NOISE: MaterialKind = { rule: "cell", start: "noise" };
const COARSE_SEED: MaterialKind = { rule: "pyramid", start: "centre-disc" };

describe("the time before a run", () => {
  it("counts a continuation's updates from its definition's update, or 500 past the schedule", () => {
    expect(timeBefore(FINE_NOISE, false, 450).updates).toBe(550);
    expect(timeBefore(FINE_NOISE, false, 1000).updates).toBe(500);
    expect(timeBefore(FINE_NOISE, true, 900).updates).toBe(100);
  });

  it("is the whole run at the reference cost, unless the run stops at the first fire", () => {
    expect(timeBefore(FINE_NOISE, false)).toEqual({ updates: 1000, seconds: 395, measured: false });
    expect(timeBefore(FINE_NOISE, true)).toEqual({ updates: 250, seconds: 98.75, measured: false });
    expect(timeBefore(COARSE_SEED, true)).toEqual({ updates: 450, seconds: 288.45, measured: false });
  });
});

describe("the time left", () => {
  it("uses the reference cost until the device has trained MEASURED_AFTER updates", () => {
    expect(timeLeft(FINE_NOISE, false, { completed: 10, total: 1000, trainingMs: 9000 })).toEqual({ updates: 990, seconds: 391.05, measured: false });
    const measured = timeLeft(FINE_NOISE, false, { completed: MEASURED_AFTER, total: 1000, trainingMs: 25 * 600 });
    expect(measured).toEqual({ updates: 975, seconds: 585, measured: true });
  });

  it("aims at the typical first fire, then at the run's end once that update has passed", () => {
    expect(timeLeft(FINE_NOISE, true, { completed: 100, total: 1000, trainingMs: 40000 }).updates).toBe(150);
    expect(timeLeft(FINE_NOISE, true, { completed: 250, total: 1000, trainingMs: 100000 }).updates).toBe(750);
    expect(timeLeft(FINE_NOISE, false, { completed: 1000, total: 1000, trainingMs: 400000 }).updates).toBe(0);
    // After a Resume past update 1,000, the run's own last update counts.
    expect(timeLeft(FINE_NOISE, false, { completed: 1100, total: 1500, trainingMs: 440000 }).updates).toBe(400);
  });

  it("measures only updates performed in a continuation", () => {
    expect(timeLeft(FINE_NOISE, false, { completed: 451, total: 1000, trainingMs: 600 }, 450)).toEqual({ updates: 549, seconds: 216.855, measured: false });
    expect(timeLeft(FINE_NOISE, false, { completed: 475, total: 1000, trainingMs: 15000 }, 450)).toEqual({ updates: 525, seconds: 315, measured: true });
    expect(timeLeft(FINE_NOISE, true, { completed: 475, total: 1000, trainingMs: 15000 }, 450).updates).toBe(225);
    expect(timeLeft(FINE_NOISE, true, { completed: 925, total: 1000, trainingMs: 15000 }, 900).updates).toBe(75);
    expect(timeTaken({ completed: 1000, trainingMs: 330000 }, 450)).toEqual({ updates: 550, seconds: 330, measured: true });
  });

  it("after a run is the training time it took", () => {
    expect(timeTaken({ completed: 1000, trainingMs: 384000 })).toEqual({ updates: 1000, seconds: 384, measured: true });
  });
});

describe("a duration in words", () => {
  it("is seconds, then minutes with one decimal, then whole minutes", () => {
    expect(durationText(0.2)).toBe("1 s");
    expect(durationText(40)).toBe("40 s");
    expect(durationText(395)).toBe("6.6 min");
    expect(durationText(641)).toBe("11 min");
  });
});
