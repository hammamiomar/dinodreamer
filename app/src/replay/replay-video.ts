import type { FigureReplay } from "./figure-replay";

/** Which ticks become frames, and how fast they play back. */
export interface VideoPlan {
  seed: number;
  fromTick: number;
  toTick: number;
  ticksPerFrame: number;
  fps: number;
}
export interface RecordedVideo {
  blob: Blob;
  extension: "webm" | "mp4";
  frames: number;
  /** Wall-clock length of the recording; MediaRecorder stamps frames with capture time. */
  seconds: number;
}

export function checkVideoPlan(plan: VideoPlan): number {
  const whole = (value: number) => Number.isInteger(value) && value >= 0;
  if (!whole(plan.fromTick) || !whole(plan.toTick) || plan.toTick <= plan.fromTick) throw new Error("Record a simulation step range that ends after it starts.");
  if (!whole(plan.ticksPerFrame) || plan.ticksPerFrame < 1 || (plan.toTick - plan.fromTick) % plan.ticksPerFrame !== 0) {
    throw new Error("The step range must be a whole number of frames.");
  }
  if (!whole(plan.fps) || plan.fps < 1 || plan.fps > 60) throw new Error("Record at 1–60 frames per second.");
  return (plan.toTick - plan.fromTick) / plan.ticksPerFrame + 1;
}

/** block-12002-figure-seed-1-ticks-0000-0600-30fps.webm: the range and rate travel in the name. */
export function videoFileName(block: number, plan: VideoPlan, extension: string): string {
  const tick = (value: number) => String(value).padStart(4, "0");
  return `block-${block}-figure-seed-${plan.seed}-ticks-${tick(plan.fromTick)}-${tick(plan.toTick)}-${plan.fps}fps.${extension}`;
}

/** Video frames are 512 pixels square: four pixels per cell at 128 cells, two at 256. */
const VIDEO_PIXELS = 512;

/**
 * Grow from the seed to the first tick off camera, then capture one frame every
 * ticksPerFrame ticks, paced at fps in real time. The first frame shows fromTick.
 * Each frame is the replay's exact displayed bytes, drawn into a 2D canvas before it is
 * captured: capturing the WebGPU canvas itself sometimes recorded the previous tick.
 */
export async function recordReplayVideo(replay: FigureReplay, plan: VideoPlan, onProgress?: (tick: number) => void): Promise<RecordedVideo> {
  const frames = checkVideoPlan(plan);
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser cannot record video from a canvas.");
  const side = replay.pictureSide;
  const cells = new OffscreenCanvas(side, side);
  const cellContext = cells.getContext("2d")!;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil(VIDEO_PIXELS / side) * side;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  try {
    const capture = async () => {
      cellContext.putImageData(new ImageData(await replay.readPixels(), side, side), 0, 0);
      context.drawImage(cells, 0, 0, canvas.width, canvas.height);
      track.requestFrame();
    };
    replay.reseed(plan.seed);
    await replay.advance(plan.fromTick);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    let recordingError: Error | undefined;
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.onerror = (event) => {
        recordingError = new Error(`Recording failed: ${String((event as ErrorEvent).error ?? event.type)}`);
        resolve();
      };
    });
    const interval = 1000 / plan.fps;
    const wait = (until: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, until - performance.now())));
    recorder.start();
    const started = performance.now();
    try {
      await capture();
      for (let frame = 1; frame < frames; frame++) {
        if (recordingError) throw recordingError;
        await replay.advance(plan.ticksPerFrame);
        await wait(started + frame * interval);
        await capture();
        onProgress?.(replay.tick);
      }
      // Hold the last frame for one interval so it has a duration in the file.
      await wait(started + frames * interval);
    } finally {
      if (recorder.state !== "inactive") recorder.stop();
    }
    await stopped;
    if (recordingError) throw recordingError;
    return {
      blob: new Blob(chunks, { type: mimeType.split(";")[0] }),
      extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
      frames,
      seconds: (performance.now() - started) / 1000,
    };
  } finally { track.stop(); }
}
