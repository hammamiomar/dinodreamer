import { describe, expect, it } from "vitest";
import { patchSlot, type Recipe } from "../../../recipe";
import type { Command, Event, ReleaseLocation } from "../../../synthesis/protocol";
import { applyAreaStroke, createRecipe, createRequest, removeRequest, setTermWeight } from "../model";
import { MOVEMENT_SERIES } from "./movement";
import {
  HISTORY_STEPS,
  TOTAL_SERIES,
  createRunState,
  imageStartStep,
  latestShown,
  planCommand,
  runReducer,
  stepsPerSecond,
  type DesiredRecipe,
  type RunAction,
  type RunState,
} from "./session";

const release: ReleaseLocation = { baseUrl: "/fixtures", manifestPath: "releases/fixture.json" };

function validRecipe(): Recipe {
  const handoff = { token: { imageId: 7, role: "patch" as const, slot: patchSlot(2, 8) }, block: 3, code: [1, 0, 0] as [number, number, number] };
  return createRequest(createRecipe("fixture"), handoff);
}

function event(event: Event, receivedAt = 0): RunAction {
  return { type: "event", event, receivedAt };
}

function frame(revision: number, step: number, elapsedMs = 500, pixels: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(4)): Event {
  return {
    type: "frame",
    revision,
    step,
    views: 2,
    loss: 1 / (step + 1),
    terms: [{ id: "request:1:respond", raw: 0.5, weighted: 0.15 }],
    pixels,
    elapsedMs,
  };
}

/** A 256 × 256 RGBA image of one grey level. */
function image(level: number): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(256 * 256 * 4).fill(255);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = level;
  return pixels;
}

/**
 * Drives the session the way use-run.ts does: after every action, send the planned
 * command (if any) and record it. Returns the session and the commands sent.
 */
function drive(state: RunState, desired: DesiredRecipe, actions: RunAction[]): { state: RunState; sent: Command[] } {
  const sent: Command[] = [];
  const settle = () => {
    for (let guard = 0; guard < 10; guard++) {
      const command = planCommand(state, desired, release);
      if (!command) return;
      sent.push(command);
      state = runReducer(state, { type: "sent", command });
    }
    throw new Error("planCommand did not settle");
  };
  settle();
  for (const action of actions) {
    state = runReducer(state, action);
    settle();
  }
  return { state, sent };
}

function loadedAndApplied(desired: DesiredRecipe): RunState {
  return drive(createRunState(), desired, [
    { type: "requestRun" },
    event({ type: "phase", phase: "ready" }),
    event({ type: "applied", revision: desired.revision, step: 0, resetAdam: true, rebased: false }),
  ]).state;
}

describe("planCommand", () => {
  it("does nothing until the visitor first asks for steps", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    expect(drive(createRunState(), desired, []).sent).toEqual([]);
  });

  it("loads, applies, then runs, in that order", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const { sent, state } = drive(createRunState(), desired, [
      { type: "requestRun" },
      event({ type: "phase", phase: "loading" }),
      event({ type: "phase", phase: "ready" }),
      event({ type: "phase", phase: "preparing" }),
      event({ type: "applied", revision: 1, step: 0, resetAdam: true, rebased: false }),
      event({ type: "phase", phase: "running" }),
    ]);
    expect(sent.map((command) => command.type)).toEqual(["load", "apply", "run"]);
    expect(state.applied?.revision).toBe(1);
    expect(state.applied?.recipe).toBe(desired.recipe);
  });

  it("keeps one apply pending and then sends only the latest revision", () => {
    const first = { revision: 1, recipe: validRecipe() };
    let { state, sent } = drive(createRunState(), first, [{ type: "requestRun" }, event({ type: "phase", phase: "ready" })]);
    expect(sent.map((command) => command.type)).toEqual(["load", "apply"]);

    // Two more edits arrive while revision 1 is being prepared.
    const second = { revision: 2, recipe: applyAreaStroke(first.recipe, 1, "look", { mode: "paint", cells: new Array<number>(256).fill(100) }) };
    const third = { revision: 3, recipe: { ...second.recipe, seed: 9 } };
    expect(planCommand(state, second, release)).toBeNull();
    expect(planCommand(state, third, release)).toBeNull();

    ({ state, sent } = drive(state, third, [event({ type: "applied", revision: 1, step: 0, resetAdam: true, rebased: false })]));
    expect(sent[0]).toEqual({ type: "apply", revision: 3, recipe: third.recipe });
  });

  it("never sends an invalid recipe and does not resend a rejected revision", () => {
    const invalid = { revision: 4, recipe: { ...createRecipe("fixture"), seed: -1 } };
    const loaded = drive(createRunState(), invalid, [{ type: "requestRun" }, event({ type: "phase", phase: "ready" })]);
    expect(loaded.sent.map((command) => command.type)).toEqual(["load"]);

    const desired = { revision: 5, recipe: validRecipe() };
    const rejected = drive(loaded.state, desired, [event({ type: "rejected", revision: 5, message: "no device memory" })]);
    expect(rejected.sent.map((command) => command.type)).toEqual(["apply"]);
    expect(rejected.state.rejected?.message).toBe("no device memory");
    expect(planCommand(rejected.state, desired, release)).toBeNull();
  });

  it("pauses a running worker once, and steps a paused one", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = loadedAndApplied(desired);
    let sent: Command[];
    ({ state, sent } = drive(state, desired, [event({ type: "phase", phase: "running" }), { type: "requestPause" }]));
    expect(sent.map((command) => command.type)).toEqual(["pause"]);

    ({ state, sent } = drive(state, desired, [
      event({ type: "phase", phase: "paused" }),
      event({ type: "measurement", revision: 1, step: 0, terms: [], codes: [], pixels: new Uint8ClampedArray(4) }),
      { type: "requestStep" },
    ]));
    expect(sent.map((command) => command.type)).toEqual(["step"]);
    expect(state.wantsRunning).toBe(false);
  });

  it("never plans a measure: the worker measures after every step, apply, pause and restart", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const state = drive(createRunState(), desired, [
      { type: "requestStep" },
      event({ type: "phase", phase: "ready" }),
      event({ type: "applied", revision: 1, step: 0, resetAdam: true, rebased: false }),
      event({ type: "phase", phase: "paused" }),
      event(frame(1, 0)),
    ]);
    expect(state.sent.map((command) => command.type)).toEqual(["load", "apply", "step"]);
    // The drawn image is the frame's: the image before its update, after 0 updates.
    expect(latestShown(state.state)?.step).toBe(0);
  });

  it("sends a requested restart once an objective is applied", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const { sent, state } = drive(loadedAndApplied(desired), desired, [{ type: "requestRestart", seed: 7 }]);
    expect(sent).toContainEqual({ type: "restart", seed: 7 });
    expect(state.restartSeed).toBeUndefined();
  });

  it("waits for the running phase instead of reading an earlier paused event as a refusal", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    // Run was sent right after "applied"; the worker's own post-apply phase arrives next.
    const { state, sent } = drive(loadedAndApplied(desired), desired, [
      event({ type: "phase", phase: "paused" }),
      event({ type: "phase", phase: "running" }),
    ]);
    expect(sent).toEqual([]);
    expect(state.wantsRunning).toBe(true);
    expect(state.controlSent).toBeNull();
  });

  it("stops wanting to run when the worker pauses itself", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const { state, sent } = drive(loadedAndApplied(desired), desired, [
      event({ type: "phase", phase: "running" }),
      event({ type: "error", message: "non-finite loss", fatal: false }),
      event({ type: "phase", phase: "paused" }),
    ]);
    // One pause in case the worker is still stepping; never Run again.
    expect(sent.map((command) => command.type)).toEqual(["pause"]);
    expect(state.wantsRunning).toBe(false);
  });

  it("clears the outstanding run on refused and asks nothing more, with the phase still ready", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const state0 = loadedAndApplied(desired);
    expect(state0.controlSent).toBe("run");
    const { state, sent } = drive(state0, desired, [
      event({ type: "refused", command: "run", message: "Nothing to optimize: every term is off." }),
    ]);
    expect(sent).toEqual([]);
    expect(state.phase).toBe("ready");
    expect(state.controlSent).toBeNull();
    expect(state.wantsRunning).toBe(false);
    expect(state.refused?.message).toContain("Nothing to optimize");
    expect(runReducer(state, { type: "requestRun" }).refused).toBeUndefined();
  });

  it("sends pause while an apply is pending, then resumes nothing on install", () => {
    const first = { revision: 1, recipe: validRecipe() };
    let { state } = drive(loadedAndApplied(first), first, [event({ type: "phase", phase: "running" })]);
    const second = { revision: 2, recipe: { ...first.recipe, seed: 4 } };
    let sent: Command[];
    ({ state, sent } = drive(state, second, [event({ type: "phase", phase: "preparing" })]));
    expect(sent).toEqual([{ type: "apply", revision: 2, recipe: second.recipe }]);

    ({ state, sent } = drive(state, second, [{ type: "requestPause" }]));
    expect(sent).toEqual([{ type: "pause" }]);
    expect(state.pending?.revision).toBe(2);

    ({ state, sent } = drive(state, second, [
      event({ type: "applied", revision: 2, step: 7, resetAdam: false, rebased: false }),
      event({ type: "phase", phase: "paused" }),
    ]));
    expect(sent).toEqual([]);
    expect(state.controlSent).toBeNull();
    expect(state.settledPhase).toBe("paused");
  });

  it("stops wanting to run when the first apply is rejected", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const { state, sent } = drive(createRunState(), desired, [
      { type: "requestRun" },
      event({ type: "phase", phase: "ready" }),
      event({ type: "rejected", revision: 1, message: "Could not load a preview (404)" }),
    ]);
    expect(sent.map((command) => command.type)).toEqual(["load", "apply"]);
    expect(state.wantsRunning).toBe(false);
  });

  it("starts over with a replaced client after a fatal error", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const failed = runReducer(loadedAndApplied(desired), event({ type: "error", message: "device lost", fatal: true }));
    const { sent, state } = drive(failed, desired, [{ type: "clientReplaced" }]);
    expect(sent).toEqual([{ type: "load", release }]);
    expect(state.applied).toBeUndefined();
    expect(state.wantsRunning).toBe(true);
  });

  it("stops planning after a fatal error", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const state = runReducer(loadedAndApplied(desired), event({ type: "error", message: "device lost", fatal: true }));
    expect(planCommand(state, desired, release)).toBeNull();
    expect(state.wantsRunning).toBe(false);
  });
});

describe("events", () => {
  it("ignores an acknowledgement for a revision this session did not send", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const state = loadedAndApplied(desired);
    expect(runReducer(state, event({ type: "applied", revision: 9, step: 3, resetAdam: true, rebased: false }))).toBe(state);
  });

  it("keeps a bounded history per term and the total", () => {
    let state = createRunState();
    for (let step = 0; step < HISTORY_STEPS + 20; step++) state = runReducer(state, event(frame(1, step)));
    expect(state.history["request:1:respond"].values).toHaveLength(HISTORY_STEPS);
    expect(state.history[TOTAL_SERIES].steps[0]).toBe(20);
    expect(latestShown(state)?.step).toBe(HISTORY_STEPS + 19);
  });

  it("clears frames, measurements and history on restart", () => {
    let state = createRunState();
    state = runReducer(state, event(frame(1, 0)));
    state = runReducer(state, event(frame(1, 1)));
    state = runReducer(state, event({ type: "restarted", revision: 1, seed: 4 }));
    expect(state.frame).toBeUndefined();
    expect(state.history).toEqual({});
    expect(latestShown(state)).toBeUndefined();
  });

  it("reports the applied objective from step 0 of a restarted image", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = runReducer(loadedAndApplied(desired), event(frame(1, 40)));
    state = runReducer(state, event({ type: "restarted", revision: 1, seed: 2 }));
    expect(state.applied?.step).toBe(0);
  });

  it("reports the rate from recent step durations and the newest pixels", () => {
    let state = createRunState();
    state = runReducer(state, event(frame(1, 0, 400)));
    state = runReducer(state, event(frame(1, 1, 600)));
    expect(stepsPerSecond(state)).toBeCloseTo(2, 10);

    const measured = new Uint8ClampedArray(4);
    state = runReducer(state, event({ type: "measurement", revision: 1, step: 1, terms: [], codes: [], pixels: measured }));
    expect(latestShown(state)).toMatchObject({ kind: "measurement", pixels: measured });
    state = runReducer(state, event(frame(1, 2)));
    expect(latestShown(state)).toMatchObject({ kind: "frame", step: 2 });
  });
});

describe("mean trails", () => {
  function measurement(revision: number, requestId: number, code: [number, number, number]): Event {
    return {
      type: "measurement",
      revision,
      step: 0,
      terms: [],
      codes: [{ requestId, slots: new Uint16Array([5]), codes: new Float32Array(code), errors: new Float32Array([0]) }],
      pixels: new Uint8ClampedArray(4),
    };
  }

  /** Applies `recipe` as `revision` through the planner, the way use-run.ts does. */
  function apply(state: RunState, revision: number, recipe: Recipe): RunState {
    return drive(state, { revision, recipe }, [event({ type: "applied", revision, step: 0, resetAdam: true, rebased: false })]).state;
  }

  it("keeps a request's trail across edits of its weights and areas", () => {
    const first = validRecipe();
    let state = loadedAndApplied({ revision: 1, recipe: first });
    state = runReducer(state, event(measurement(1, 1, [1, 0, 0])));
    state = apply(state, 2, setTermWeight(first, "request:1:look", 2));
    expect(state.meanTrail[1]).toHaveLength(1);
  });

  it("drops the trail when the request's id returns with another target", () => {
    const first = validRecipe();
    let state = loadedAndApplied({ revision: 1, recipe: first });
    state = runReducer(state, event(measurement(1, 1, [1, 0, 0])));
    // Remove request 1 and add another: it gets id 1 again, in another block.
    const other = { token: { imageId: 8, role: "patch" as const, slot: patchSlot(4, 4) }, block: 9, code: [0, 1, 0] as [number, number, number] };
    const replaced = createRequest(removeRequest(first, 1), other);
    expect(replaced.requests[0].id).toBe(1);
    state = apply(state, 2, replaced);
    expect(state.meanTrail[1]).toBeUndefined();
  });

  it("does not extend a trail with a measurement of an earlier objective", () => {
    const first = validRecipe();
    let state = loadedAndApplied({ revision: 1, recipe: first });
    state = apply(state, 2, setTermWeight(first, "request:1:look", 2));
    state = runReducer(state, event(measurement(1, 1, [1, 0, 0])));
    expect(state.meanTrail[1]).toBeUndefined();
    state = runReducer(state, event(measurement(2, 1, [1, 0, 0])));
    expect(state.meanTrail[1]).toHaveLength(1);
  });
});

describe("movement", () => {
  it("is the change from the previous frame of the same objective, kept with its history; none for the first frame", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = loadedAndApplied(desired);
    state = runReducer(state, event(frame(1, 1, 500, image(100))));
    expect(state.movement).toBeUndefined();
    state = runReducer(state, event(frame(1, 2, 500, image(110))));
    expect(state.movement?.step).toBe(2);
    expect(state.movement?.mean).toBe(10);
    state = runReducer(state, event(frame(1, 3, 500, image(114))));
    expect(state.movement?.mean).toBe(4);
    expect(state.history[MOVEMENT_SERIES]).toEqual({ steps: [2, 3], values: [10, 4] });
  });

  it("has none for the first frame after an apply or a restart", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = loadedAndApplied(desired);
    state = runReducer(state, event(frame(1, 1, 500, image(100))));
    state = runReducer(state, event(frame(1, 2, 500, image(110))));
    expect(state.movement?.mean).toBe(10);
    // A frame of the next revision: the previous frame showed another objective.
    state = runReducer(state, event(frame(2, 3, 500, image(120))));
    expect(state.movement).toBeUndefined();
    expect(state.history[MOVEMENT_SERIES]?.values).toEqual([10]);
    state = runReducer(state, event(frame(2, 4, 500, image(125))));
    expect(state.movement?.mean).toBe(5);
    state = runReducer(state, event({ type: "restarted", revision: 2, seed: 2 }));
    expect(state.movement).toBeUndefined();
    state = runReducer(state, event(frame(2, 1, 500, image(50))));
    expect(state.movement).toBeUndefined();
  });
});

describe("the Noise tool's re-seeds", () => {
  const cells = (...painted: number[]) => Array.from({ length: 256 }, (_, cell) => painted.includes(cell));

  it("sends a painted re-seed once an objective is applied, in the order painted, and drops one painted before", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const early = drive(createRunState(), desired, [{ type: "requestReseed", cells: cells(1), seed: 5 }]);
    expect(early.state.reseedQueue).toEqual([]);
    const { sent, state } = drive(loadedAndApplied(desired), desired, [
      { type: "requestReseed", cells: cells(1), seed: 5 },
      { type: "requestReseed", cells: cells(2), seed: 6 },
    ]);
    expect(sent.filter((command) => command.type === "reseed")).toEqual([
      { type: "reseed", cells: cells(1), seed: 5 },
      { type: "reseed", cells: cells(2), seed: 6 },
    ]);
    expect(state.reseedQueue).toEqual([]);
    expect(state.reseedsSent.map((reseed) => reseed.seed)).toEqual([5, 6]);
  });

  it("records each acknowledged re-seed in the run sequence with its cells, after the image's start", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = drive(loadedAndApplied(desired), desired, [{ type: "requestReseed", cells: cells(7), seed: 5 }]).state;
    expect(state.sequence).toEqual([{ type: "start", seed: validRecipe().seed }]);
    state = runReducer(state, event({ type: "reseeded", revision: 1, step: 12, seed: 5 }));
    expect(state.sequence).toEqual([
      { type: "start", seed: validRecipe().seed },
      { type: "reseed", step: 12, seed: 5, cells: cells(7) },
    ]);
    expect(state.reseedsSent).toEqual([]);
    // A restart begins a new sequence from its seed.
    state = runReducer(state, event({ type: "restarted", revision: 1, seed: 9 }));
    expect(state.sequence).toEqual([{ type: "start", seed: 9 }]);
  });

  it("gives the first frame after a re-seed no movement, and the next one again", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = loadedAndApplied(desired);
    state = runReducer(state, event(frame(1, 1, 500, image(100))));
    state = runReducer(state, event(frame(1, 2, 500, image(110))));
    expect(state.movement?.mean).toBe(10);
    state = runReducer(state, event({ type: "reseeded", revision: 1, step: 3, seed: 5 }));
    state = runReducer(state, event(frame(1, 3, 500, image(200))));
    expect(state.movement).toBeUndefined();
    state = runReducer(state, event(frame(1, 4, 500, image(204))));
    expect(state.movement?.mean).toBe(4);
  });

  it("drops a refused re-seed without touching the run controls", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = drive(loadedAndApplied(desired), desired, [{ type: "requestReseed", cells: cells(1), seed: 5 }]).state;
    state = runReducer(state, event({ type: "refused", command: "reseed", message: "nothing applied" }));
    expect(state.reseedsSent).toEqual([]);
    expect(state.refused).toBeUndefined();
    expect(state.wantsRunning).toBe(true);
  });
});

describe("opening a creation from its saved picture", () => {
  const picture = new Uint8Array([137, 80, 78, 71]);
  const restore = (afterRevision: number, opened = 1) => ({ type: "requestRestore" as const, restore: { picture, step: 150, afterRevision, opened } });

  it("keeps the request before the worker is up, and sends it after the opened recipe's apply, before the run", () => {
    const desired = { revision: 3, recipe: validRecipe() };
    const { sent, state } = drive(createRunState(), desired, [
      restore(3),
      { type: "requestRun" },
      event({ type: "phase", phase: "ready" }),
      event({ type: "applied", revision: 3, step: 0, resetAdam: true, rebased: false }),
    ]);
    expect(sent.map((command) => command.type)).toEqual(["load", "apply", "restore", "run"]);
    expect(sent[2]).toEqual({ type: "restore", picture, step: 150 });
    expect(state.restore?.sent).toBe(true);
  });

  it("waits while the applied objective is an older revision than the opened recipe's", () => {
    const desired = { revision: 5, recipe: validRecipe() };
    const applied = loadedAndApplied({ revision: 4, recipe: validRecipe() });
    const waiting = drive(applied, { revision: 4, recipe: validRecipe() }, [restore(5)]);
    expect(waiting.sent.some((command) => command.type === "restore")).toBe(false);
    const after = drive(waiting.state, desired, [event({ type: "applied", revision: 5, step: 9, resetAdam: false, rebased: false })]);
    expect(after.sent.map((command) => command.type)).toContain("restore");
  });

  it("starts a new image at the stored step when restored: history cleared, the sequence begins with the picture", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = drive(loadedAndApplied(desired), desired, [restore(1)]).state;
    state = runReducer(state, event(frame(1, 400)));
    state = runReducer(state, event({ type: "restored", revision: 1, step: 150 }));
    expect(state.frame).toBeUndefined();
    expect(state.history).toEqual({});
    expect(state.applied?.step).toBe(150);
    expect(state.sequence).toEqual([{ type: "restore", step: 150, picture }]);
    expect(state.restore).toBeUndefined();
    expect(state.restoreOutcome).toEqual({ opened: 1, result: "restored" });
  });

  it("starts the image at the restored step, so only a later step carries an update of this session", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = drive(loadedAndApplied(desired), desired, [restore(1)]).state;
    expect(imageStartStep(state)).toBe(0);
    state = runReducer(state, event({ type: "restored", revision: 1, step: 150 }));
    expect(imageStartStep(state)).toBe(150);
    state = runReducer(state, event({ type: "reseeded", revision: 1, step: 150, seed: 9 }));
    expect(imageStartStep(state)).toBe(150);
    state = runReducer(state, event({ type: "restarted", revision: 1, seed: 4 }));
    expect(imageStartStep(state)).toBe(0);
  });

  it("falls back to the recipe's seed when the worker refuses the picture", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    let state = drive(loadedAndApplied(desired), desired, [restore(1)]).state;
    const after = drive(state, desired, [event({ type: "refused", command: "restore", message: "not a 256 x 256 PNG" })]);
    expect(after.sent).toContainEqual({ type: "restart", seed: validRecipe().seed });
    state = after.state;
    expect(state.restoreOutcome).toEqual({ opened: 1, result: "dropped" });
    expect(state.refused).toBeUndefined();
  });

  it("is replaced by a Reset before it is answered", () => {
    const desired = { revision: 1, recipe: validRecipe() };
    const state = runReducer(runReducer(createRunState(), restore(1)), { type: "requestRestart", seed: 4 });
    expect(state.restore).toBeUndefined();
    expect(state.restoreOutcome).toEqual({ opened: 1, result: "dropped" });
    expect(drive(state, desired, []).sent.some((command) => command.type === "restore")).toBe(false);
  });
});
