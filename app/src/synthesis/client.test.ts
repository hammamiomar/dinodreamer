import { afterEach, expect, test, vi } from "vitest";
import { createSynthesisClient } from "./client";
import type { Event } from "./protocol";

/** Stands in for the browser's module Worker: the test drives its handlers. */
class WorkerStub {
  static last: WorkerStub;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    WorkerStub.last = this;
  }
  postMessage() {}
  terminate() {}
}

afterEach(() => vi.unstubAllGlobals());

function connect() {
  vi.stubGlobal("Worker", WorkerStub);
  const events: Event[] = [];
  createSynthesisClient().subscribe((event) => events.push(event));
  return { worker: WorkerStub.last, events };
}

test("a worker whose script does not load says so", () => {
  const { worker, events } = connect();
  // A module script that fails to load: a plain Event, no message.
  worker.onerror!({ message: "" } as ErrorEvent);
  expect(events[0]).toMatchObject({ type: "error", fatal: true });
  expect(events[0]).toMatchObject({ message: "The synthesis worker could not start: its script did not load." });
  expect(events[1]).toMatchObject({ type: "phase", phase: "failed" });
});

test("a worker that crashes after it started keeps the general message", () => {
  const { worker, events } = connect();
  worker.onmessage!({ data: { type: "phase", phase: "idle" } } as MessageEvent);
  worker.onerror!({ message: "" } as ErrorEvent);
  expect(events.at(-1)).toMatchObject({ type: "phase", phase: "failed", message: "The synthesis worker stopped unexpectedly." });
});

test("an error that carries a message passes it on", () => {
  const { worker, events } = connect();
  worker.onerror!({ message: "Uncaught RangeError: out of memory" } as ErrorEvent);
  expect(events[0]).toMatchObject({ type: "error", message: "Uncaught RangeError: out of memory", fatal: true });
});
