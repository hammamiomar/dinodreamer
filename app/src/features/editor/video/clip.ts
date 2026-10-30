// A clip of the run from the recording's stills (run/recording.ts): the cadence, the
// file name and the choice of encoder are decided here, without any browser codec,
// so they test alone. The encoders (mp4.ts with WebCodecs, gif.ts as the fallback)
// sit behind ClipEncoder and load only when a clip is saved.

import type { Still } from "../run/recording";

/** One still per frame at 30 frames per second, the final image held two seconds. */
export const CLIP = { fps: 30, holdLastMs: 2000, mp4Size: 512, gifSize: 256 } as const;

export interface ClipFrame {
  still: Still;
  /** How many frames of the clip show this still: 1, or the hold at the end. */
  repeat: number;
}

/**
 * The stills a clip shows: the recording's, and the image on screen after them when it
 * is newer (the latest frame shows the image before its update; the measurement that
 * follows shows the result, which the clip should end on).
 */
export function clipStills(stills: Still[], shown?: Still): Still[] {
  const last = stills[stills.length - 1];
  if (!shown || !last || shown.step <= last.step) return stills;
  return [...stills, shown];
}

/** The stills in order, one frame each, the last held for the hold time. */
export function planClip(stills: Still[]): ClipFrame[] {
  const hold = Math.round((CLIP.holdLastMs / 1000) * CLIP.fps);
  return stills.map((still, index) => ({ still, repeat: index === stills.length - 1 ? hold : 1 }));
}

/**
 * "<title>-<step>.mp4" for a saved video, ".png" for a saved image: the title trimmed and
 * made safe for a file name, "canvas" when empty.
 */
export function savedFileName(title: string, step: number, extension: ClipEncoder["extension"] | "png"): string {
  const stem = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^-+|-+$/g, "") || "canvas";
  return `${stem}-${step}.${extension}`;
}

/** RGBA pixels of a still drawn at `size` pixels square with smooth scaling (video/stills.ts). */
export type DecodeStill = (still: Still, size: number) => Promise<Uint8ClampedArray>;

export interface ClipEncoder {
  extension: "mp4" | "gif";
  encode(plan: ClipFrame[], decode: DecodeStill): Promise<Blob>;
}

/** The MP4 encoder when the browser can encode H.264 with WebCodecs, else the GIF encoder. */
export async function chooseEncoder(canEncodeH264: () => Promise<boolean> = browserEncodesH264): Promise<ClipEncoder> {
  if (await canEncodeH264()) return (await import("./mp4")).mp4Encoder;
  return (await import("./gif")).gifEncoder;
}

/** H.264 Baseline, level 3.1: 512 × 512 at 30 frames per second fits well within it. */
export const H264_CODEC = "avc1.42001f";

async function browserEncodesH264(): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({ codec: H264_CODEC, width: CLIP.mp4Size, height: CLIP.mp4Size });
    return supported === true;
  } catch {
    return false;
  }
}
