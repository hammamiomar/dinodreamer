// The main-thread handle on the synthesis worker. The editor uses only this file and protocol.ts.

import type { Command, Event } from "./protocol";

export interface SynthesisClient {
  send(command: Command): void;
  /** Returns the unsubscribe function. */
  subscribe(listener: (event: Event) => void): () => void;
  /** Releases the GPU device and ends the worker. */
  dispose(): void;
}

export function createSynthesisClient(): SynthesisClient {
  // Vite bundles the worker only when `new URL` is written inside `new Worker`.
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  const listeners = new Set<(event: Event) => void>();
  const deliver = (event: Event) => listeners.forEach((listener) => listener(event));
  let disposed = false;
  // A module worker whose script fails to load reports a plain Event, without a message.
  let started = false;

  worker.onmessage = ({ data }: MessageEvent<Event>) => {
    started = true;
    deliver(data);
  };
  // A worker that fails to start or crashes cannot report through its own messages.
  worker.onerror = (error) => {
    const message =
      error.message ||
      (started ? "The synthesis worker stopped unexpectedly." : "The synthesis worker could not start: its script did not load.");
    deliver({ type: "error", message, fatal: true });
    deliver({ type: "phase", phase: "failed", message });
  };
  worker.onmessageerror = () => deliver({ type: "error", message: "A worker message could not be decoded.", fatal: false });

  return {
    send(command) {
      if (!disposed) worker.postMessage(command);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.postMessage({ type: "dispose" } satisfies Command);
      // The worker frees the device and closes itself; terminate covers a stuck GPU call.
      setTimeout(() => worker.terminate(), 1000);
      listeners.clear();
    },
  };
}
