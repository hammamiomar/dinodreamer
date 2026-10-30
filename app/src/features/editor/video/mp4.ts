// The MP4 clip: H.264 from the browser's encoder (WebCodecs), boxed by mp4-muxer
// (MIT). Loaded only when a clip is saved.

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { CLIP, H264_CODEC, type ClipEncoder } from "./clip";

/** Bits per second at 512 px: ample for a smooth, slowly changing image. */
const BITRATE = 4_000_000;
/** A key frame every five seconds keeps seeking quick without costing much. */
const KEY_FRAME_INTERVAL = CLIP.fps * 5;
/** How many frames may wait in the encoder before the loop pauses for it. */
const ENCODER_QUEUE_LIMIT = 16;

export const mp4Encoder: ClipEncoder = {
  extension: "mp4",
  async encode(plan, decode) {
    const size = CLIP.mp4Size;
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: "avc", width: size, height: size }, fastStart: "in-memory" });
    const failure = new AbortController();
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        failure.abort(error);
      },
    });
    try {
      encoder.configure({ codec: H264_CODEC, width: size, height: size, bitrate: BITRATE, framerate: CLIP.fps });
      const frameMicros = 1_000_000 / CLIP.fps;
      let index = 0;
      for (const { still, repeat } of plan) {
        const rgba = await decode(still, size);
        for (let shown = 0; shown < repeat; shown++) {
          failure.signal.throwIfAborted();
          if (encoder.encodeQueueSize > ENCODER_QUEUE_LIMIT) await dequeued(encoder, failure.signal);
          const frame = new VideoFrame(rgba, {
            format: "RGBA",
            codedWidth: size,
            codedHeight: size,
            timestamp: Math.round(index * frameMicros),
            duration: Math.round(frameMicros),
          });
          try {
            encoder.encode(frame, { keyFrame: index % KEY_FRAME_INTERVAL === 0 });
          } finally {
            frame.close();
          }
          index++;
        }
      }
      await encoder.flush();
      failure.signal.throwIfAborted();
      muxer.finalize();
      return new Blob([target.buffer], { type: "video/mp4" });
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }
  },
};

/** An encoder failure need not emit dequeue; release the waiter and both listeners either way. */
function dequeued(encoder: VideoEncoder, failure: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      encoder.removeEventListener("dequeue", ready);
      failure.removeEventListener("abort", failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(failure.reason); };
    encoder.addEventListener("dequeue", ready, { once: true });
    failure.addEventListener("abort", failed, { once: true });
    if (failure.aborted) failed();
  });
}
