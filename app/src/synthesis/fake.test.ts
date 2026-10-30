import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecipe, createRequest, removeRequest, setTermEnabled, setOptimizer, setSeed, setTermWeight, setZoomPerUpdate } from "../features/editor/model";
import { createRunState, latestShown, planCommand, runReducer, type DesiredRecipe, type RunState } from "../features/editor/run/session";
import { patchSlot, type Optimizer } from "../recipe";
import { createFakeSynthesisClient, zoomAboutCentre } from "./fake";
import type { Event } from "./protocol";

const release = { baseUrl: "/fixtures", manifestPath: "releases/fixture.json" };

function recipe() {
  const handoff = { token: { imageId: 7, role: "patch" as const, slot: patchSlot(2, 8) }, block: 3, code: [1, 0.5, 0] as [number, number, number] };
  return createRequest(createRecipe("fixture"), handoff);
}

/** The editor's session driving the fake, the way use-run.ts drives a client. */
function connect(desired: DesiredRecipe) {
  const client = createFakeSynthesisClient({ stepMs: 10, loadMs: 30, prepareMs: 10 });
  const events: Event[] = [];
  const harness = { session: createRunState() as RunState, desired, events, client };
  const settle = () => {
    for (let command = planCommand(harness.session, harness.desired, release); command; command = planCommand(harness.session, harness.desired, release)) {
      client.send(command);
      harness.session = runReducer(harness.session, { type: "sent", command });
    }
  };
  client.subscribe((event) => {
    events.push(event);
    harness.session = runReducer(harness.session, { type: "event", event, receivedAt: 0 });
    settle();
  });
  return { harness, settle };
}

/** Stop at the frame the assertion needs; fake time still does real image work. */
function advanceToFrame(events: Event[], step: number): Extract<Event, { type: "frame" }> {
  for (let timer = 0; timer < 500; timer++) {
    const frame = events.find((event) => event.type === "frame" && event.step === step);
    if (frame?.type === "frame") return frame;
    vi.advanceTimersToNextTimer();
  }
  throw new Error(`The fake worker did not report frame ${step}.`);
}

describe("fake synthesis worker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("removes an inactive request without crashing or resetting the unchanged objective", () => {
    const client = createFakeSynthesisClient({ loadMs: 1, prepareMs: 1 });
    const events: Event[] = [];
    client.subscribe((event) => events.push(event));
    client.send({ type: "load", release });
    vi.advanceTimersByTime(10);
    const inactive = setTermEnabled(setTermEnabled(recipe(), "request:1:respond", false), "request:1:look", false);
    client.send({ type: "apply", revision: 1, recipe: inactive });
    vi.advanceTimersByTime(10);
    expect(() => client.send({ type: "apply", revision: 2, recipe: removeRequest(inactive, 1) })).not.toThrow();
    vi.advanceTimersByTime(10);
    expect(events.filter((event) => event.type === "applied").at(-1)).toMatchObject({ revision: 2, resetAdam: false });
    client.dispose();
  });

  it("loads, applies, runs and reports frames and measurements labelled with the revision", () => {
    const { harness, settle } = connect({ revision: 1, recipe: recipe() });
    harness.session = runReducer(harness.session, { type: "requestRun" });
    settle();
    advanceToFrame(harness.events, 1);

    const types = harness.events.map((event) => event.type);
    expect(types.slice(0, 2)).toEqual(["phase", "capabilities"]);
    expect(types).toContain("applied");
    expect(harness.session.phase).toBe("running");
    expect(harness.session.frame?.revision).toBe(1);
    expect(harness.session.measurement?.codes[0].slots).toHaveLength(9);

    const frames = harness.events.filter((event) => event.type === "frame");
    expect(frames[0].step).toBe(0);
    const first = frames[0].loss;
    const last = frames[frames.length - 1].loss;
    expect(last).toBeLessThan(first);
    harness.client.dispose();
  });

  it("measures after every frame, apply, pause and restart, as the protocol promises", () => {
    const desired = { revision: 1, recipe: recipe() };
    const { harness, settle } = connect(desired);
    harness.session = runReducer(harness.session, { type: "requestStep" });
    settle();
    vi.advanceTimersByTime(200);
    const afterStep = harness.events.map((event) => event.type);
    // apply (stopped) -> measurement; step -> frame -> measurement of the same image.
    expect(afterStep.indexOf("measurement")).toBeGreaterThan(afterStep.indexOf("applied"));
    expect(afterStep.slice(afterStep.indexOf("frame"))).toContain("measurement");
    const frame = harness.events.find((event) => event.type === "frame");
    const following = harness.events.slice(harness.events.indexOf(frame!)).filter((event) => event.type === "measurement");
    // The frame's own image (step 0), then the stepped image the visitor now sees (step 1).
    expect(following.map((event) => event.step)).toEqual([0, 1]);
    // After a Step the drawn image, and so the step label, is the stepped image.
    expect(latestShown(harness.session)?.step).toBe(1);

    const before = harness.events.length;
    harness.client.send({ type: "restart", seed: 3 });
    harness.client.send({ type: "pause" });
    vi.advanceTimersByTime(5);
    const later = harness.events.slice(before).map((event) => event.type);
    expect(later.filter((type) => type === "measurement")).toHaveLength(2);
    expect(harness.events.some((event) => event.type === "error")).toBe(false);
    harness.client.dispose();
  });

  it("measures soft fields through the protocol and keeps inactive edits out of Adam resets", () => {
    const client = createFakeSynthesisClient({ loadMs: 1, prepareMs: 1 });
    const events: Event[] = [];
    client.subscribe((event) => events.push(event));
    client.send({ type: "load", release });
    vi.advanceTimersByTime(10);
    const full = recipe();
    full.requests[0].respondLike.where.fill(100);
    full.requests[0].lookLike.where.fill(100);
    client.send({ type: "apply", revision: 1, recipe: full });
    vi.advanceTimersByTime(10);
    const first = events.filter((event) => event.type === "measurement").at(-1)!;
    const half = structuredClone(full);
    half.requests[0].respondLike.where.fill(50);
    half.requests[0].lookLike.where.fill(50);
    client.send({ type: "apply", revision: 2, recipe: half });
    vi.advanceTimersByTime(10);
    const second = events.filter((event) => event.type === "measurement").at(-1)!;
    expect(second.revision).toBe(2);
    expect(second.pixels.length).toBe(first.pixels.length);
    expect(second.pixels.every((byte, index) => byte === first.pixels[index])).toBe(true);
    for (const term of second.terms) {
      expect(term.raw).toBeCloseTo(first.terms.find((candidate) => candidate.id === term.id)!.raw / 2, 10);
    }
    expect(events.filter((event) => event.type === "applied").at(-1)?.resetAdam).toBe(true);
    const off = structuredClone(half);
    off.requests[0].respondLike.enabled = false;
    client.send({ type: "apply", revision: 3, recipe: off });
    vi.advanceTimersByTime(10);
    const editedProbe = structuredClone(off);
    editedProbe.requests[0].respondLike.where[0] = 1;
    client.send({ type: "apply", revision: 4, recipe: editedProbe });
    vi.advanceTimersByTime(10);
    expect(events.filter((event) => event.type === "applied").at(-1)).toMatchObject({ revision: 4, resetAdam: false });
    client.dispose();
  });

  it("honors a pause sent while references are being prepared", () => {
    const desired = { revision: 1, recipe: recipe() };
    const { harness, settle } = connect(desired);
    harness.session = runReducer(harness.session, { type: "requestRun" });
    settle();
    advanceToFrame(harness.events, 1);
    expect(harness.session.phase).toBe("running");

    // An objective change starts preparation; the visitor pauses before it installs.
    harness.desired = { revision: 2, recipe: setTermWeight(desired.recipe, "request:1:look", 0.5) };
    settle();
    vi.advanceTimersByTime(2);
    expect(harness.session.phase).toBe("preparing");
    expect(harness.session.pending?.revision).toBe(2);
    harness.session = runReducer(harness.session, { type: "requestPause" });
    settle();
    const sentPause = harness.session.controlSent;
    vi.advanceTimersByTime(100);

    expect(sentPause).toBe("pause");
    expect(harness.session.applied?.revision).toBe(2);
    expect(harness.session.phase).toBe("paused");
    const framesAfterInstall = harness.events.slice(harness.events.findIndex((event) => event.type === "applied" && event.revision === 2));
    expect(framesAfterInstall.some((event) => event.type === "frame")).toBe(false);
    harness.client.dispose();
  });

  it("refuses a run with nothing to optimize, leaving the phase and the session settled", () => {
    const empty = createRecipe("fixture");
    const { harness, settle } = connect({ revision: 1, recipe: empty });
    harness.session = runReducer(harness.session, { type: "requestRun" });
    settle();
    vi.advanceTimersByTime(200);

    const refused = harness.events.find((event) => event.type === "refused");
    expect(refused).toMatchObject({ command: "run" });
    expect(harness.session.wantsRunning).toBe(false);
    expect(harness.session.controlSent).toBeNull();
    expect(harness.events.filter((event) => event.type === "frame")).toHaveLength(0);
    harness.client.dispose();
  });

  it("acknowledges a seed-only apply without preparation and restarts at step 0", () => {
    const desired = { revision: 1, recipe: recipe() };
    const { harness, settle } = connect(desired);
    harness.session = runReducer(harness.session, { type: "requestRun" });
    settle();
    advanceToFrame(harness.events, 1);

    harness.desired = { revision: 2, recipe: setSeed(desired.recipe, 5) };
    harness.session = runReducer(harness.session, { type: "requestRestart", seed: 5 });
    settle();
    vi.advanceTimersByTime(5);

    const applied = harness.events.filter((event) => event.type === "applied");
    expect(applied[applied.length - 1]).toMatchObject({ revision: 2, resetAdam: false });
    expect(harness.events.some((event) => event.type === "restarted")).toBe(true);
    vi.advanceTimersByTime(15);
    const restartedAt = harness.events.findIndex((event) => event.type === "restarted");
    const nextFrame = harness.events.slice(restartedAt).find((event) => event.type === "frame");
    expect(nextFrame).toMatchObject({ step: 0, revision: 2 });
    harness.client.dispose();
  });

  it("re-seeds the painted unprotected cells and nothing else, keeps the step, and measures after it", () => {
    const protect = Array.from({ length: 256 }, (_, cell) => cell === 1);
    const desired = { revision: 1, recipe: { ...recipe(), protect } };
    const { harness, settle } = connect(desired);
    harness.session = runReducer(harness.session, { type: "requestStep" });
    settle();
    vi.advanceTimersByTime(200);
    const before = latestShown(harness.session)!;
    expect(before.step).toBe(1);
    // Before the first apply a re-seed is refused; here one is applied, so the stroke is sent.
    harness.session = runReducer(harness.session, { type: "requestReseed", cells: protect.map((_, cell) => cell === 0 || cell === 1), seed: 77 });
    settle();
    vi.advanceTimersByTime(50);
    const reseeded = harness.events.find((event) => event.type === "reseeded");
    expect(reseeded).toEqual({ type: "reseeded", revision: 1, step: 1, seed: 77 });
    const after = latestShown(harness.session)!;
    expect(after.step).toBe(1);
    expect(harness.events.at(-1)?.type).toBe("measurement");
    // Cell 0 (its 16 x 16 pixels at the top left) changed; cell 1 is protected and cell 17 was not painted.
    const pixel = (pixels: Uint8ClampedArray, x: number, y: number) => Array.from(pixels.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 3));
    expect(pixel(after.pixels, 3, 3)).not.toEqual(pixel(before.pixels, 3, 3));
    expect(pixel(after.pixels, 20, 3)).toEqual(pixel(before.pixels, 20, 3));
    expect(pixel(after.pixels, 20, 20)).toEqual(pixel(before.pixels, 20, 20));
    expect(harness.session.sequence.at(-1)).toMatchObject({ type: "reseed", step: 1, seed: 77 });
  });

  it("refuses a re-seed before any recipe is applied", () => {
    const client = createFakeSynthesisClient({ stepMs: 10, loadMs: 30, prepareMs: 10 });
    const events: Event[] = [];
    client.subscribe((event) => events.push(event));
    client.send({ type: "reseed", cells: Array(256).fill(true), seed: 1 });
    vi.advanceTimersByTime(10);
    expect(events).toEqual([{ type: "refused", command: "reseed", message: "No image-editing configuration is applied yet." }]);
    client.dispose();
  });

  it("restores a stored picture as the image at its step, and refuses one it cannot read with the image unchanged", async () => {
    const stored = new Uint8ClampedArray(256 * 256 * 4).fill(200);
    const decodePicture = async (png: Uint8Array) => {
      if (png[0] !== 1) throw new Error("not a PNG");
      return stored;
    };
    const client = createFakeSynthesisClient({ stepMs: 10, loadMs: 30, prepareMs: 10, decodePicture });
    const events: Event[] = [];
    client.subscribe((event) => events.push(event));
    client.send({ type: "restore", picture: new Uint8Array([1]), step: 150 });
    await vi.advanceTimersByTimeAsync(5);
    expect(events.at(-1)).toMatchObject({ type: "refused", command: "restore" });

    client.send({ type: "load", release });
    await vi.advanceTimersByTimeAsync(100);
    client.send({ type: "apply", revision: 1, recipe: recipe() });
    await vi.advanceTimersByTimeAsync(100);
    client.send({ type: "restore", picture: new Uint8Array([1]), step: 150 });
    // A step sent right after waits behind the restore, as the worker handles commands in order.
    client.send({ type: "step" });
    await vi.advanceTimersByTimeAsync(100);
    const restoredAt = events.findIndex((event) => event.type === "restored");
    expect(events[restoredAt]).toEqual({ type: "restored", revision: 1, step: 150 });
    const after = events.slice(restoredAt).find((event) => event.type === "measurement");
    expect(after).toMatchObject({ step: 150 });
    expect(Array.from((after as Extract<Event, { type: "measurement" }>).pixels.subarray(0, 4))).toEqual([200, 200, 200, 255]);
    expect(events.slice(restoredAt).find((event) => event.type === "frame")).toMatchObject({ step: 150 });

    const before = events.length;
    client.send({ type: "restore", picture: new Uint8Array([0]), step: 3 });
    await vi.advanceTimersByTimeAsync(10);
    expect(events.slice(before)).toEqual([{ type: "refused", command: "restore", message: "not a PNG" }]);
    client.dispose();
  });

  it("applies a change of zoom alone without preparation or an Adam reset", () => {
    const desired = { revision: 1, recipe: recipe() };
    const { harness, settle } = connect(desired);
    harness.session = runReducer(harness.session, { type: "requestRun" });
    settle();
    advanceToFrame(harness.events, 1);

    const before = harness.events.length;
    harness.desired = { revision: 2, recipe: setZoomPerUpdate(desired.recipe, 0.01) };
    settle();
    vi.advanceTimersByTime(15);
    const applied = harness.events.filter((event) => event.type === "applied");
    expect(applied[applied.length - 1]).toMatchObject({ revision: 2, resetAdam: false, rebased: false });
    expect(harness.events.slice(before).some((event) => event.type === "phase" && event.phase === "preparing")).toBe(false);
    harness.client.dispose();
  });
});

describe("the fake's run settings", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  type Frame = Extract<Event, { type: "frame" }>;
  const framesOf = (events: Event[]) => events.filter((event): event is Frame => event.type === "frame");
  const codeError = (frame: Frame) => frame.terms.find((term) => term.id.endsWith(":respond"))!.raw;

  function running(change: Partial<Optimizer> = {}) {
    const connection = connect({ revision: 1, recipe: setOptimizer(recipe(), change) });
    connection.harness.session = runReducer(connection.harness.session, { type: "requestRun" });
    connection.settle();
    return connection;
  }

  it("moves the codes faster with a longer stride and slower with the far view", () => {
    const errorAt20 = (change: Partial<Optimizer>) => {
      const { harness } = running(change);
      const frame = advanceToFrame(harness.events, 20);
      harness.client.dispose();
      return codeError(frame);
    };
    const quarter = errorAt20({ step: 0.0125 });
    const one = errorAt20({});
    const two = errorAt20({ step: 0.1 });
    expect(two).toBeLessThan(one);
    expect(one).toBeLessThan(quarter);
    expect(errorAt20({ robustView: true })).toBeGreaterThan(one);
  });

  it("keeps the visitor's stride after arrival: below 0.01 the code error falls at the same pace as before", () => {
    const { harness } = running();
    // Each fake frame costs real CPU, so run one frame (10 ms) at a time and stop once the
    // frames reach the arrival plus the 21 that the assertions read. The 4,000 ms cap makes
    // a run that never arrives fail below instead of running on.
    const framesAfterArrival = 21;
    let frames = framesOf(harness.events);
    let arrival = -1;
    for (let elapsedMs = 0; elapsedMs < 4000; elapsedMs += 10) {
      vi.advanceTimersByTime(10);
      frames = framesOf(harness.events);
      arrival = frames.findIndex((frame) => codeError(frame) < 0.01);
      if (arrival >= 0 && frames.length >= arrival + framesAfterArrival) break;
    }
    expect(arrival).toBeGreaterThan(10);
    expect(frames.length).toBeGreaterThan(arrival + 20);
    const ratio = (index: number) => codeError(frames[index + 1]!) / codeError(frames[index]!);
    expect(ratio(arrival + 10)).toBeCloseTo(ratio(arrival - 10), 6);
    expect(frames.every((frame) => !("stepSize" in frame) && !("settle" in frame))).toBe(true);
    harness.client.dispose();
  });

  it("applies a changed run setting without an Adam reset", () => {
    const { harness, settle } = running();
    advanceToFrame(harness.events, 1);
    harness.desired = { revision: 2, recipe: setOptimizer(harness.desired.recipe, { step: 0.1 }) };
    settle();
    vi.advanceTimersByTime(1);
    expect(harness.events.find((event) => event.type === "applied" && event.revision === 2)).toMatchObject({ resetAdam: false });
    harness.client.dispose();
  });
});

describe("zoomAboutCentre", () => {
  const SIZE = 256;
  const pixel = (x: number, y: number) => (y * SIZE + x) * 3;

  it("keeps a uniform image uniform", () => {
    const zoomed = zoomAboutCentre(new Float32Array(SIZE * SIZE * 3).fill(0.4), 0.05);
    expect(zoomed.every((value) => Math.abs(value - 0.4) < 1e-6)).toBe(true);
  });

  it("moves structure away from the centre by the zoom factor", () => {
    // A bright column 72 pixels right of the centre line moves to about 72 × 1.1 = 79 pixels.
    const image = new Float32Array(SIZE * SIZE * 3);
    for (let y = 0; y < SIZE; y++) image[pixel(200, y)] = 1;
    const zoomed = zoomAboutCentre(image, 0.1);
    const row = Array.from({ length: SIZE }, (_, x) => zoomed[pixel(x, 128)]);
    const brightest = row.indexOf(Math.max(...row));
    expect(brightest).toBeGreaterThanOrEqual(206);
    expect(brightest).toBeLessThanOrEqual(208);
  });
});
