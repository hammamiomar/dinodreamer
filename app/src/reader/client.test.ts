import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReaderClient } from "./client";

class WorkerStub {
  static current: WorkerStub;
  onmessage?: (message: { data: unknown }) => void;
  onmessageerror?: () => void;
  onerror?: (event: { message: string }) => void;
  sent: any[] = [];
  terminate = vi.fn();
  constructor() { WorkerStub.current = this; }
  postMessage(message: unknown) { this.sent.push(message); }
  emit(data: unknown) { this.onmessage?.({ data }); }
}
const location = { baseUrl: "/assets", manifestPath: "releases/current.json" };
const pixels = () => { const value = new Uint8ClampedArray(256 * 256 * 4); value.fill(255); return value; };
beforeEach(() => vi.stubGlobal("Worker", WorkerStub));
afterEach(() => vi.unstubAllGlobals());

it("waits for all assets and preserves the requested image before ready", async () => {
  const client = new ReaderClient(location);
  const image = pixels();
  const reading = client.readImage(image);
  image[0] = 0;
  expect(WorkerStub.current.sent).toHaveLength(1);
  WorkerStub.current.emit({ type: "ready" });
  await client.ready; await Promise.resolve();
  const request = WorkerStub.current.sent[1];
  expect(request.pixels[0]).toBe(255);
  WorkerStub.current.emit({ type: "image-addresses", id: request.id, addresses: { grid: 16 } });
  await expect(reading).resolves.toEqual({ grid: 16 });
  client.dispose();
});
it("rejects pending and future requests when disposed", async () => {
  const client = new ReaderClient(location);
  WorkerStub.current.emit({ type: "ready" }); await client.ready;
  const reading = client.readImage(pixels()); await Promise.resolve();
  const rejected = expect(reading).rejects.toThrow("closed");
  client.dispose();
  await rejected;
  await expect(client.readImage(pixels())).rejects.toThrow("closed");
  expect(WorkerStub.current.terminate).toHaveBeenCalled();
});
it("refuses transparent images at the public boundary", async () => {
  const client = new ReaderClient(location);
  const image = pixels(); image[3] = 0;
  await expect(client.readImage(image)).rejects.toThrow("transparent");
  client.dispose();
});

it("reports a useful error when the worker script fails without an error message", async () => {
  const client = new ReaderClient(location);
  const rejected = expect(client.ready).rejects.toThrow("Image analyzer worker could not start");
  WorkerStub.current.onerror?.({ message: "" });
  await rejected;
});

it("rejects current and future reads after a worker message cannot be decoded", async () => {
  const client = new ReaderClient(location);
  WorkerStub.current.emit({ type: "ready" });
  await client.ready;
  let failure: string | undefined;
  void client.readImage(pixels()).catch((error: Error) => { failure = error.message; });
  await Promise.resolve();
  WorkerStub.current.onmessageerror?.();
  await Promise.resolve();
  await vi.waitFor(() => expect(failure).toBe("An image analyzer message could not be decoded."), { timeout: 100 });
  await expect(client.readImage(pixels())).rejects.toThrow("could not be decoded");
  expect(WorkerStub.current.terminate).toHaveBeenCalledTimes(1);
  client.dispose();
});
