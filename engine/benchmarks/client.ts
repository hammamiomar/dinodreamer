import type {
  BenchmarkEvent,
  BenchmarkSettings,
  BrowserResult,
  Loaded,
  Qualification,
  Request,
} from "./protocol";
import { runMeasurements } from "./measurements";

class BenchmarkWorker {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(onEvent: (event: BenchmarkEvent) => void) {
    this.worker.onmessage = ({ data }) => {
      if (data.event) {
        onEvent(data.event);
        return;
      }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data.result);
    };
    this.worker.onerror = (event) =>
      this.close(new Error(event.message || "Worker crashed"));
    this.worker.onmessageerror = () =>
      this.close(new Error("Worker response could not be decoded"));
  }

  call<T>(request: Request): Promise<T> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({ id, request });
    });
  }

  close(error = new Error("Worker terminated")): void {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export async function runHarness(
  settings: BenchmarkSettings,
  onEvent: (event: BenchmarkEvent) => void,
): Promise<BrowserResult> {
  const result: BrowserResult = { settings, modes: {} };
  const releaseUrl = new URL("/release/", location.href).href;
  let worker = new BenchmarkWorker(onEvent);
  try {
    onEvent({ type: "phase", message: "qualification: loading" });
    result.qualificationLoad = await worker.call<Loaded>({
      type: "load",
      releaseUrl,
      settings,
    });
    onEvent({ type: "phase", message: "qualification: outputs and gradients" });
    result.qualification = await worker.call<Qualification>({
      type: "qualify",
      fixtureUrl: new URL("/fixture/reference.safetensors", location.href).href,
    });
    if (!result.qualification.passed)
      throw new Error(
        "Numerical qualification failed. Performance not ranked.",
      );
    worker.close();
    // New worker and GPU device. Qualification tensors must not warm this pool.
    worker = new BenchmarkWorker(onEvent);
    onEvent({ type: "phase", message: "performance: loading a fresh worker" });
    result.performanceLoad = await worker.call<Loaded>({
      type: "load",
      releaseUrl,
      settings,
    });
    await runMeasurements(
      worker,
      settings,
      result.performanceLoad.capabilities.timestamps,
      result,
      onEvent,
    );
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    worker.close();
  }
  return result;
}

declare global {
  interface Window {
    runHarness: typeof runHarness;
  }
}
window.runHarness = runHarness;
