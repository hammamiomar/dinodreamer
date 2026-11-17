import type { GrowCommand, GrowEvent, GrowStart } from "./protocol";

/** One worker owns the training, its GPU pool and the live grid. Disposing the client ends them. */
export class GrowClient {
  private worker = new Worker(new URL("./grow.worker.ts", import.meta.url), { type: "module" });
  constructor(onEvent: (event: GrowEvent) => void) {
    this.worker.onmessage = ({ data }: MessageEvent<GrowEvent>) => onEvent(data);
    this.worker.onerror = (event) => onEvent({ type: "error", message: event.message });
  }
  start(start: GrowStart) {
    this.send({ type: "start", ...start });
  }
  stop() { this.send({ type: "stop" }); }
  resumeTraining() { this.send({ type: "resume-training" }); }
  restart() { this.send({ type: "restart" }); }
  keep() { this.send({ type: "keep" }); }
  brush(stamps: [number, number, number][]) { this.send({ type: "brush", stamps }); }
  private send(command: GrowCommand) { this.worker.postMessage(command); }
  dispose() { this.worker.terminate(); }
}
