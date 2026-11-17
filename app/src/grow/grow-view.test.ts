import { describe, expect, it } from "vitest";
import type { FigureMaterialFile } from "../materials/material-file";
import {
  NO_RECORD, choicesOpen, markSaved, recordEvent, growState, hasFired, keptMark, primaryAction, resultOutcome, resumeUpdates,
  shownCoSelection, stepChoiceOpen, stopAction,
  type GrowOutcome, type GrowRecord, type GrowState,
} from "./grow-view";

const progress = { completed: 300, total: 1000, trainingMs: 120000, readerChunks: 32, methodLoss: 0.012 };
const reading = { strength: 1.58, winnerFraction: 1, selectedPatches: new Uint8Array(64).fill(1), coSelection: { readPatches: 64, top: [], requested: { group: 12002, rank: 1, patches: 64, positionSum: 64 } } };
const firstFire: GrowOutcome = { id: "first", run: 1, stage: "first fire", fired: true, saved: true, updates: 250, tick: 600 };
const finalFired: GrowOutcome = { id: "final", run: 1, stage: "final", fired: true, saved: true, updates: 1000, tick: 600 };
const training: GrowRecord = { ...NO_RECORD, active: true, phase: "training", run: { run: 1, runs: 3, method: "basis-group-mean" }, progress, reading };

describe("the state table", () => {
  const rows: [string, GrowRecord, GrowState][] = [
    ["nothing started", NO_RECORD, "idle"],
    ["the worker loads the model", { ...NO_RECORD, active: true, phase: "loading" }, "loading"],
    ["updates arrive", training, "training"],
    ["the next seed starts, before its first update", { ...training, run: { run: 2, runs: 3, method: "basis-group-mean" }, progress: null, reading: null }, "training"],
    ["the run's first fire is kept and training goes on", { ...training, outcomes: [firstFire] }, "fired"],
    ["the final rule grows to tick 600 after a first fire", { ...training, phase: "finishing", outcomes: [firstFire] }, "fired"],
    ["a run's last update did not meet the target and its rule grows while the person decides", { ...training, phase: "retry" }, "retry"],
    ["the kept material plays", { ...training, phase: "live", outcomes: [firstFire, finalFired] }, "done"],
    ["the person's Stop holds the run", { ...training, phase: "stopped", outcomes: [{ ...finalFired, fired: false, updates: 300 }] }, "stopped"],
    ["the worker failed", { ...training, failure: "Device lost" }, "failed"],
  ];
  for (const [name, record, state] of rows) it(`${name}: ${state}`, () => expect(growState(record)).toBe(state));

  it("a first fire of an earlier run does not make a later run fired", () => {
    expect(growState({ ...training, run: { run: 2, runs: 3, method: "basis-group-mean" }, outcomes: [{ ...firstFire, run: 1, fired: false }] })).toBe("training");
  });
});

describe("what each state shows", () => {
  it("the primary: Grow, Stop while running, Resume after Stop, Restart after a run that did not meet the target, Open when done, Grow again for another kind", () => {
    expect((["idle", "failed"] as const).map((state) => primaryAction(state, false))).toEqual(["grow", "grow"]);
    expect((["loading", "training", "fired"] as const).map((state) => primaryAction(state, false))).toEqual(["stop", "stop", "stop"]);
    expect(primaryAction("retry", false)).toBe("restart");
    expect([primaryAction("stopped", false), primaryAction("done", false)]).toEqual(["resume", "open"]);
    expect([primaryAction("stopped", true), primaryAction("done", true)]).toEqual(["grow", "grow"]);
  });

  it("Stop holds a training run, before and after its first fire; with no trainer yet it ends the worker", () => {
    expect((["training", "fired"] as const).map(stopAction)).toEqual(["stop", "stop"]);
    expect((["loading", "retry"] as const).map(stopAction)).toEqual(["end", "end"]);
  });

  it("Resume trains on to the run's last update, or 500 past it once reached", () => {
    expect(resumeUpdates({ completed: 300, total: 1000 })).toBe(700);
    expect(resumeUpdates({ completed: 1000, total: 1000 })).toBe(500);
    expect(resumeUpdates({ completed: 1500, total: 1500 })).toBe(500);
  });

  it("the co-selected groups take the choices' place while a run trains or waits, once a measurement has come", () => {
    expect(shownCoSelection("training", training)).toBe(reading.coSelection);
    expect(shownCoSelection("training", { ...training, reading: null })).toBeNull();
    expect((["idle", "stopped", "done", "failed"] as const).map((state) => shownCoSelection(state, training))).toEqual([null, null, null, null]);
  });

  it("the choices are open only when nothing trains or waits", () => {
    expect((["idle", "failed", "stopped", "done"] as const).every(choicesOpen)).toBe(true);
    expect((["loading", "training", "fired", "retry"] as const).some(choicesOpen)).toBe(false);
  });

  it("the band lights and Kept shows once a fired file is saved", () => {
    const fired = { ...training, outcomes: [firstFire] };
    expect([hasFired("fired", fired), keptMark("fired", fired)]).toEqual([true, true]);
    const saving = { ...training, outcomes: [{ ...firstFire, saved: false }] };
    expect([hasFired("fired", saving), keptMark("fired", saving)]).toEqual([true, false]);
    expect([hasFired("training", training), keptMark("training", training)]).toEqual([false, false]);
  });

  it("a finished Grow offers the final rule when it fired, else the first fire, else the last file", () => {
    const finalLost = { ...finalFired, fired: false };
    expect(resultOutcome({ ...training, outcomes: [firstFire, finalFired] })?.id).toBe("final");
    expect(resultOutcome({ ...training, outcomes: [firstFire, finalLost] })?.id).toBe("first");
    const none = [{ ...finalLost, id: "run-1" }, { ...finalLost, id: "run-2", run: 2 }];
    expect(resultOutcome({ ...training, outcomes: none })?.id).toBe("run-2");
    expect(hasFired("done", { ...training, phase: "live", outcomes: none })).toBe(false);
  });

  it("after repeated Stops, the run's latest final rule when it fired, the rule the held trainer is at", () => {
    const stopAt = (updates: number, fired: boolean): GrowOutcome => ({ ...finalFired, id: `final-${updates}`, fired, updates });
    const stopped = { ...training, phase: "stopped" as const };
    expect(resultOutcome({ ...stopped, outcomes: [firstFire, stopAt(275, true), stopAt(300, true)] })?.id).toBe("final-300");
    // The latest final did not fire: the run's first fire, not an earlier final.
    expect(resultOutcome({ ...stopped, outcomes: [firstFire, stopAt(275, true), stopAt(300, false)] })?.id).toBe("first");
    // No first fire: the last file, the held rule, which did not fire.
    const noFirst = [stopAt(275, true), stopAt(300, false)];
    expect(resultOutcome({ ...stopped, outcomes: noFirst })?.id).toBe("final-300");
    expect(hasFired("stopped", { ...stopped, outcomes: noFirst })).toBe(false);
  });
});


describe("the record", () => {
  const file = (id: string, updates: number) => ({ id, training: { seed: 1, updates }, reading: { tick: 600 } }) as unknown as FigureMaterialFile;

  it("follows a run: a new run without progress, then progress and readings", () => {
    let record: GrowRecord = { ...NO_RECORD, active: true };
    record = recordEvent(record, { type: "phase", phase: "loading", message: "Loading the training models · 3/14" });
    expect(record.phaseMessage).toBe("Loading the training models · 3/14");
    record = recordEvent(record, { type: "run", run: 1, runs: 3, seed: 20273024, method: "basis-group-mean" });
    record = recordEvent(record, { type: "phase", phase: "training", message: "Preparing the first training update…" });
    expect([record.run, growState(record)]).toEqual([{ run: 1, runs: 3, method: "basis-group-mean" }, "loading"]);
    record = recordEvent(record, { type: "progress", progress: { completed: 25, trainingMs: 9875, readerChunks: 26, methodLoss: 0.5 } as never });
    expect(growState(record)).toBe("training");
    record = recordEvent(record, { type: "reading", reading: { ...reading, patchCodes: new Float32Array(192), band: "strongest", seed: 9317, tick: 200, rule: "training", completed: 25, elapsedMs: 0, readMs: 60 } });
    expect([record.progress, record.reading]).toEqual([{ completed: 25, trainingMs: 9875, readerChunks: 26, methodLoss: 0.5 }, reading]);
    record = recordEvent(record, { type: "run", run: 2, runs: 3, seed: 20273025, method: "basis-group-mean" });
    expect([record.progress, record.reading]).toEqual([null, null]);
  });

  it("replaces the outcome of a file kept again under its id, as a set method kept at another step", () => {
    const at = (tick: number) => ({ id: "final", training: { seed: 1, updates: 1000 }, reading: { tick } }) as unknown as FigureMaterialFile;
    let record = recordEvent(training, { type: "material", file: at(150), run: 1, stage: "final", fired: false });
    record = markSaved(record, "final");
    record = recordEvent(record, { type: "material", file: at(300), run: 1, stage: "final", fired: false });
    expect(record.outcomes).toEqual([{ id: "final", run: 1, stage: "final", fired: false, saved: false, updates: 1000, tick: 300 }]);
  });

  it("opens a step choice only while the kept file is not sent to the gallery", () => {
    expect([stepChoiceOpen("idle"), stepChoiceOpen("awaiting"), stepChoiceOpen("published")]).toEqual([true, false, false]);
  });

  it("keeps each file unsaved until Keep has saved it", () => {
    let record = recordEvent(training, { type: "material", file: file("first", 250), run: 1, stage: "first fire", fired: true });
    expect(record.outcomes).toEqual([{ id: "first", run: 1, stage: "first fire", fired: true, saved: false, updates: 250, tick: 600 }]);
    record = markSaved(record, "first");
    expect(record.outcomes[0]!.saved).toBe(true);
  });

  it("a run that did not meet the target waits for the person until the next run starts or it is kept", () => {
    const held = recordEvent(training, { type: "phase", phase: "retry", message: "" });
    expect(growState(held)).toBe("retry");
    expect(growState(recordEvent(held, { type: "phase", phase: "live", message: "" }))).toBe("done");
    const next = recordEvent(recordEvent(held, { type: "run", run: 2, runs: 3, seed: 2, method: "basis-group-mean" }), { type: "phase", phase: "training", message: "" });
    expect([growState(next), next.progress, next.reading]).toEqual(["training", null, null]);
  });
});
