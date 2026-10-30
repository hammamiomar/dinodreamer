import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaterialAnchor, MaterialRequest } from "../recipe";
import { NO_RECORD } from "./grow-view";
import type { GrowEvent } from "./protocol";
import { createTrainRun, sameTarget, SIDE, trayShown, type GrowSettings, type TrainRunClient } from "./train-run";
import { SAMPLE_EVERY_TICKS } from "../ui/sampled-accent";

const anchor: MaterialAnchor = {
  source: "library", imageId: 7, slot: 40, code: [1, 2, 3], band: "strongest", norm: 2, strength: { ring: 1, cuts: [1.2, 1.5, 1.8], maximum: 3 },
};
const request: MaterialRequest = { block: 12002, points: [], anchor };
const choices = { kind: { rule: "cell", start: "noise" }, stopAtFirstFire: false, continuation: null, picture: null } as const;

/** Workers as the store creates them, each with the commands it was given and a way to speak. */
function fakeWorkers() {
  const made: { calls: string[]; say: (event: GrowEvent) => void }[] = [];
  const createClient = (onEvent: (event: GrowEvent) => void): TrainRunClient => {
    const calls: string[] = [];
    made.push({ calls, say: onEvent });
    return {
      start: () => { calls.push("start"); },
      stop: () => { calls.push("stop"); },
      resumeTraining: () => { calls.push("resume-training"); },
      restart: () => { calls.push("restart"); },
      keep: () => { calls.push("keep"); },
      brush: () => { calls.push("brush"); },
      dispose: () => { calls.push("dispose"); },
    };
  };
  return { made, createClient };
}

function store() {
  const workers = fakeWorkers();
  const run = createTrainRun({ createClient: workers.createClient, keep: async () => {}, release: { url: "", name: "test" } as never, batch: () => 4 });
  return { run, workers };
}

const frame = (tick: number) => ({ type: "live", frame: { pixels: new Uint8ClampedArray(SIDE * SIDE * 4), seed: 0, tick, rule: "training", completed: 0 } }) as GrowEvent;

afterEach(() => {
  vi.useRealTimers();
});

describe("the site's Train run (train-run.ts)", () => {
  it("starts one worker with the target and choices, and records what it says", () => {
    const { run, workers } = store();
    const changes = vi.fn();
    run.subscribe(changes);
    run.start(request, choices);
    expect(workers.made).toHaveLength(1);
    expect(workers.made[0]!.calls).toEqual(["start"]);
    expect(run.state().settings).toMatchObject({ request, kind: choices.kind, stopAtFirstFire: false });
    expect(run.state().record.active).toBe(true);
    workers.made[0]!.say({ type: "run", run: 1, runs: 3, seed: 1 });
    expect(run.state().record.run).toEqual({ run: 1, runs: 3 });
    expect(changes).toHaveBeenCalled();
  });

  it("gives the live grid to its own listeners, and its colour to the others once a sampling period", () => {
    const { run, workers } = store();
    run.start(request, choices);
    const changes = vi.fn();
    const frames = vi.fn();
    run.subscribe(changes);
    run.subscribeLive(frames);
    workers.made[0]!.say(frame(1));
    workers.made[0]!.say(frame(2));
    expect(frames).toHaveBeenCalledTimes(2);
    expect(run.live()?.tick).toBe(2);
    expect(changes).toHaveBeenCalledTimes(1);
    workers.made[0]!.say(frame(SAMPLE_EVERY_TICKS));
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it("after a run that did not meet the target, nothing goes on by itself: Restart and Keep are the person's", () => {
    vi.useFakeTimers();
    const { run, workers } = store();
    run.start(request, choices);
    workers.made[0]!.say({ type: "phase", phase: "retry", message: "" });
    vi.advanceTimersByTime(60000);
    expect(workers.made[0]!.calls).toEqual(["start"]);
    run.restart();
    run.keep();
    expect(workers.made[0]!.calls).toEqual(["start", "restart", "keep"]);
  });

  it("ends a running worker before the next, and hears nothing more from an ended one", () => {
    const { run, workers } = store();
    run.start(request, choices);
    run.start({ ...request, block: 9759 }, choices);
    expect(workers.made[0]!.calls).toEqual(["start", "dispose"]);
    expect(run.state().settings?.request.block).toBe(9759);
    workers.made[0]!.say({ type: "run", run: 2, runs: 3, seed: 2 });
    expect(run.state().record.run).toBeNull();
    run.end();
    expect(workers.made[1]!.calls.at(-1)).toBe("dispose");
    expect(run.state()).toMatchObject({ record: NO_RECORD, settings: null });
  });

  it("ends the worker on its error and keeps the error for the views", () => {
    const { run, workers } = store();
    run.start(request, choices);
    workers.made[0]!.say({ type: "error", message: "The adapter was lost." });
    expect(workers.made[0]!.calls.at(-1)).toBe("dispose");
    expect(run.state().record).toMatchObject({ active: false, failure: "The adapter was lost." });
  });

  it("reports a worker construction failure instead of remaining active", () => {
    const run = createTrainRun({
      createClient: () => { throw new Error("Worker blocked"); },
      keep: async () => {}, release: { url: "", name: "test" } as never, batch: () => 4,
    });
    expect(() => run.start(request, choices)).not.toThrow();
    expect(run.state().record).toMatchObject({ active: false, failure: "Error: Worker blocked" });
  });

  it.each(["resolve", "reject"] as const)("does not apply an old save's %s after another run starts", async (result) => {
    const workers = fakeWorkers();
    let finish!: () => void;
    const keep = () => new Promise<void>((resolve, reject) => { finish = result === "resolve" ? resolve : () => reject(new Error("quota")); });
    const run = createTrainRun({ createClient: workers.createClient, keep, release: { url: "", name: "test" } as never, batch: () => 4 });
    const file = JSON.parse(readFileSync(new URL("../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8"));
    run.start(request, choices);
    workers.made[0].say({ type: "material", file, run: 1, stage: "final", fired: true });
    run.start({ ...request, block: 9759 }, choices);
    const current = run.state();
    finish();
    await Promise.resolve();
    expect(run.state()).toBe(current);
    expect(run.state().keepFailure).toBeNull();
    run.end();
    expect(run.state().files.size).toBe(0);
  });

  it("says when a page shows it, once per change", () => {
    const { run } = store();
    const changes = vi.fn();
    run.subscribe(changes);
    run.showOnPage(true);
    run.showOnPage(true);
    expect(run.state().shownOnPage).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
  });
});

describe("a page's own run (sameTarget)", () => {
  const settings: GrowSettings = { request, ...choices };
  it("is the run toward the same patch of the same group, the same object or not", () => {
    expect(sameTarget(settings, request, null)).toBe(true);
    expect(sameTarget(settings, { ...request, anchor: { ...anchor, code: [1, 2, 3] } }, null)).toBe(true);
  });
  it("is not a run toward another group, patch, level, picture or definition", () => {
    expect(sameTarget(settings, null, null)).toBe(false);
    expect(sameTarget(settings, { ...request, block: 9759 }, null)).toBe(false);
    expect(sameTarget(settings, { ...request, anchor: { ...anchor, slot: 41 } }, null)).toBe(false);
    expect(sameTarget(settings, { ...request, anchor: { ...anchor, band: "strongly" } }, null)).toBe(false);
    expect(sameTarget(settings, { ...request, anchor: { ...anchor, imageId: 8 } }, null)).toBe(false);
    expect(sameTarget(settings, { ...request, anchor: { ...anchor, source: "upload", imageId: undefined } }, null)).toBe(false);
    expect(sameTarget(settings, request, { id: "saved-1" } as never)).toBe(false);
  });
});

describe("the corner tray's rule (trayShown)", () => {
  const training = { record: { ...NO_RECORD, active: true }, shownOnPage: false };
  it("shows a living or failed run that no page shows", () => {
    expect(trayShown(training, "/index", false)).toBe(true);
    expect(trayShown({ record: { ...NO_RECORD, failure: "lost" }, shownOnPage: false }, "/index", false)).toBe(true);
    expect(trayShown({ record: NO_RECORD, shownOnPage: false }, "/index", false)).toBe(false);
  });
  it("leaves the run to Train's page, except under a basis group panel over it", () => {
    expect(trayShown({ ...training, shownOnPage: true }, "/train", false)).toBe(false);
    expect(trayShown({ ...training, shownOnPage: true }, "/train/basis/9759", true)).toBe(true);
  });
  it("never shows on the image editor's pages, whose dock holds the corner", () => {
    expect(trayShown(training, "/create", false)).toBe(false);
    expect(trayShown(training, "/create/basis/12002", true)).toBe(false);
  });
});
