import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mp4Encoder } from "./mp4";

vi.mock("mp4-muxer", () => ({
  ArrayBufferTarget: class { buffer = new ArrayBuffer(0); },
  Muxer: class { addVideoChunk() {} finalize() {} },
}));

class EncoderStub extends EventTarget {
  static current: EncoderStub;
  state = "configured";
  encodeQueueSize = 0;
  encodeFailure?: Error;
  configure = vi.fn();
  flush = vi.fn(async () => {});
  close = vi.fn(() => { this.state = "closed"; });
  constructor(readonly callbacks: { error(error: Error): void }) {
    super();
    EncoderStub.current = this;
  }
  encode() { if (this.encodeFailure) throw this.encodeFailure; }
}
class FrameStub {
  static current: FrameStub;
  close = vi.fn();
  constructor() { FrameStub.current = this; }
}
const plan = [{ still: { step: 1, blob: new Blob(["frame"]) }, repeat: 1 }];
beforeEach(() => {
  vi.stubGlobal("VideoEncoder", EncoderStub);
  vi.stubGlobal("VideoFrame", FrameStub);
});
afterEach(() => vi.unstubAllGlobals());

it("closes the video encoder if a still cannot be decoded", async () => {
  const error = new Error("Invalid still");
  await expect(mp4Encoder.encode(plan, async () => { throw error; })).rejects.toBe(error);
  expect(EncoderStub.current.close).toHaveBeenCalledTimes(1);
});

it("closes the frame and encoder if encoding throws", async () => {
  const error = new Error("Codec stopped");
  await expect(mp4Encoder.encode(plan, async () => {
    EncoderStub.current.encodeFailure = error;
    return new Uint8ClampedArray(4);
  })).rejects.toBe(error);
  expect(FrameStub.current.close).toHaveBeenCalledTimes(1);
  expect(EncoderStub.current.close).toHaveBeenCalledTimes(1);
});

it("rejects an encoder error while waiting for queue space without requiring a dequeue event", async () => {
  const error = new Error("Codec device lost");
  let failure: unknown;
  const result = mp4Encoder.encode(plan, async () => {
    EncoderStub.current.encodeQueueSize = 20;
    return new Uint8ClampedArray(4);
  }).catch((reason: unknown) => { failure = reason; });
  await Promise.resolve();
  EncoderStub.current.callbacks.error(error);
  await vi.waitFor(() => expect(failure).toBe(error), { timeout: 100 });
  await result;
  expect(EncoderStub.current.close).toHaveBeenCalledTimes(1);
});
