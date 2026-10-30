// The recording of a run: one still per frame the worker sends, kept in memory as a
// compressed 256 px image, for the creation's current image. A restart (and so an
// opened creation) starts it afresh; pause, step, resume and a re-seed continue it.
// The bound keeps memory under about 25 MB: past 600 stills, every second still is
// dropped and the keep stride doubles, so a long run keeps an evenly thinned record.
// The rule is pure; the hook below applies it to the session's frames.

import { useEffect, useRef, useState } from "react";
import type { RunState } from "./session";

export interface Still {
  /** The step of the frame's image. */
  step: number;
  /** The image at 256 px, WebP (video/stills.ts). */
  blob: Blob;
}

export interface Recording {
  stills: Still[];
  /** Every `stride`-th frame is kept: 1 at first, doubled at each thinning. */
  stride: number;
  /** Frames passed since the last kept one. */
  skipped: number;
}

/** The most stills kept at once; past it the record is thinned by half. */
export const RECORDING_BOUND = 600;

export function emptyRecording(): Recording {
  return { stills: [], stride: 1, skipped: 0 };
}

/**
 * The recording after one more frame: kept when its turn in the stride comes, else
 * passed over. When the kept stills exceed the bound, every second one is dropped
 * (the first stays) and the stride doubles.
 */
export function recordStill(recording: Recording, still: Still): Recording {
  if (recording.skipped + 1 < recording.stride) return { ...recording, skipped: recording.skipped + 1 };
  const stills = [...recording.stills, still];
  if (stills.length <= RECORDING_BOUND) return { stills, stride: recording.stride, skipped: 0 };
  return { stills: stills.filter((_, index) => index % 2 === 0), stride: recording.stride * 2, skipped: 0 };
}

/** Whether a clip can be saved: two stills make a change to show. */
export function canSaveClip(recording: Recording): boolean {
  return recording.stills.length >= 2;
}

/**
 * A still that finished encoding joins the recording only if its run is still the
 * current one: a Reset that landed while the still was encoding started a new run,
 * and the old still would be the record of another image.
 */
export function acceptStill(recording: Recording, still: Still, stillRun: unknown, currentRun: unknown): Recording {
  return stillRun === currentRun ? recordStill(recording, still) : recording;
}

/**
 * Keeps the session's frames as stills. The record belongs to the image the run
 * started from: it starts afresh when the sequence does (a restart, an opened
 * creation). Stills encode asynchronously, in frame order; one that finishes after a
 * Reset is dropped (acceptStill reads the run current at completion, not at start).
 */
export function useRecording(session: RunState, encodeStill: (pixels: Uint8ClampedArray) => Promise<Blob>): Recording {
  const [recording, setRecording] = useState(emptyRecording);
  // The run's identity: the sequence's start event, a new object at every restart.
  const run = session.sequence[0];
  const currentRun = useRef(run);
  currentRun.current = run;
  const lastFrame = useRef<RunState["frame"]>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    lastFrame.current = undefined;
    queue.current = Promise.resolve();
    setRecording(emptyRecording());
  }, [run]);

  const frame = session.frame;
  useEffect(() => {
    if (!frame || frame === lastFrame.current) return;
    lastFrame.current = frame;
    const { step, pixels } = frame;
    const stillRun = run;
    queue.current = queue.current.then(async () => {
      if (stillRun !== currentRun.current) return;
      const blob = await encodeStill(pixels);
      setRecording((current) => acceptStill(current, { step, blob }, stillRun, currentRun.current));
    }).catch(() => {
      // A failed still is omitted; later frames must remain recordable.
    });
  }, [frame, run, encodeStill]);

  return recording;
}
