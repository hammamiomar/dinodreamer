import { describe, expect, it, vi } from "vitest";
import type { GrowEvent } from "./protocol";
import { createRunControl, decodeFigureUpdate } from "./run-control";

describe("worker run control", () => {
  it("preserves a stop requested during loading until explicitly cleared", () => {
    const events: GrowEvent[] = [];
    const control = createRunControl((event) => events.push(event));

    control.setPhase("loading", "Loading models…");
    control.handleCommand({ type: "stop" });
    expect(control.phase).toBe("loading");
    expect(control.stopping).toBe(true);

    // Entering training sees the pending stop rather than overwriting it.
    control.setPhase("training", "Training…");
    expect(control.stopping).toBe(true);

    control.clearStop();
    expect(control.stopping).toBe(false);
    expect(events).toEqual([
      { type: "phase", phase: "loading", message: "Loading models…" },
      { type: "phase", phase: "training", message: "Training…" },
    ]);
  });

  it("accepts matching hold decisions and discards unmatched ones", () => {
    const control = createRunControl(vi.fn());

    control.handleCommand({ type: "restart" });
    expect(control.takeDecision(["resume-training"])).toBeNull();
    // Unmatched decision is cleared rather than lingering for a later wait.
    expect(control.takeDecision(["restart"])).toBeNull();

    control.handleCommand({ type: "keep" });
    expect(control.takeDecision(["restart", "keep"])).toBe("keep");
    expect(control.takeDecision(["restart", "keep"])).toBeNull();
  });

  it("queues and drains brush stamps only while brush input is open", () => {
    const control = createRunControl(vi.fn());

    control.handleCommand({ type: "brush", stamps: [[10, 20, 4]] }, 100);
    expect(control.lastStroke).toBe(100);
    expect(control.drainStamps()).toEqual([[10, 20, 4]]);
    expect(control.drainStamps()).toEqual([]);

    control.handleCommand({ type: "brush", stamps: [[5, 6, 2]] }, 150);
    control.setBrushOpen(false);
    expect(control.brushOpen).toBe(false);
    expect(control.drainStamps()).toEqual([]);

    control.handleCommand({ type: "brush", stamps: [[7, 8, 3]] }, 200);
    expect(control.drainStamps()).toEqual([]);
    expect(control.lastStroke).toBe(150);

    control.setBrushOpen(true);
    control.handleCommand({ type: "brush", stamps: [[1, 2, 3]] }, 250);
    expect(control.drainStamps()).toEqual([[1, 2, 3]]);
    expect(control.lastStroke).toBe(250);
  });

  it("queues reading-ladder step overrides and consumes them once", () => {
    const control = createRunControl(vi.fn());

    control.handleCommand({ type: "keep-at-step", step: 300 });
    expect(control.takePendingStep()).toBe(300);
    expect(control.takePendingStep()).toBeNull();

    control.handleCommand({ type: "keep-at-step", step: 600 });
    control.clearPendingStep();
    expect(control.takePendingStep()).toBeNull();
  });

  it("frees the engine once and clears all per-run state on dispose", () => {
    const engine = { free: vi.fn() };
    const control = createRunControl(vi.fn());
    control.setEngine(engine);
    control.handleCommand({ type: "stop" });
    control.handleCommand({ type: "resume-training" });
    control.handleCommand({ type: "keep-at-step", step: 400 });
    control.handleCommand({ type: "brush", stamps: [[1, 2, 3]] }, 50);

    control.dispose();
    control.dispose();

    expect(engine.free).toHaveBeenCalledTimes(1);
    expect(control.engine).toBeUndefined();
    expect(control.stopping).toBe(false);
    expect(control.brushOpen).toBe(false);
    expect(control.lastStroke).toBeNull();
    expect(control.takeDecision(["resume-training"])).toBeNull();
    expect(control.takePendingStep()).toBeNull();
    expect(control.drainStamps()).toEqual([]);
  });
});

describe("decodeFigureUpdate", () => {
  const valid = {
    loss: 0.42,
    method: "token-distribution",
    methodLoss: 0.4,
    codeLoss: 0.5,
    overflow: 0.002,
    stateMax: 1.8,
    pictureContrast: 0.24,
    learningRate: 0.002,
  };

  it("decodes valid update metrics with or without optional memory counters", () => {
    expect(decodeFigureUpdate(JSON.stringify(valid))).toEqual(valid);
    expect(decodeFigureUpdate(JSON.stringify({ ...valid, usedBytes: 1024, reservedBytes: 2048 }))).toEqual({
      ...valid,
      usedBytes: 1024,
      reservedBytes: 2048,
    });
  });

  it("rejects malformed JSON, unknown methods, and non-finite metrics", () => {
    expect(() => decodeFigureUpdate("{not-json")).toThrow("expected JSON");
    expect(() => decodeFigureUpdate(JSON.stringify({ ...valid, method: "unknown" }))).toThrow("figure_update.method");
    expect(() => decodeFigureUpdate(JSON.stringify({ ...valid, loss: "bad" }))).toThrow("figure_update.loss");
    expect(() => decodeFigureUpdate(JSON.stringify({ ...valid, usedBytes: "nan" }))).toThrow("figure_update.usedBytes");
  });
});
