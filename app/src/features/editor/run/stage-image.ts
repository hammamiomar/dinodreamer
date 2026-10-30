// What the stage draws: the run's latest image, or, for a creation opened from its saved
// picture, that picture until the worker has restored it. The picture shows at once,
// before the worker loads, so a reopened creation looks as it was left; the step it was
// saved after shows with it.

import { useEffect, useState } from "react";
import { IMAGE_SIZE } from "../canvas/draw";
import type { OpenedPicture } from "../state";
import { decodeStill } from "../video/stills";
import { latestShown, type RunState } from "./session";

/**
 * Whether the stage shows the opened creation's saved picture rather than the run's image:
 * while its restore waits or is in flight; never once that restore ended (restored, then the
 * run's measurement is the picture; or dropped by a refusal or a Reset); and, before the run
 * has been asked at all (the engine not started yet), until the run shows an image.
 */
export function showsStoredPicture(picture: OpenedPicture | null, session: RunState): boolean {
  if (!picture) return false;
  if (session.restore?.opened === picture.opened) return true;
  if (session.restoreOutcome?.opened === picture.opened) return false;
  return latestShown(session) === undefined;
}

export interface StageStep {
  /** The step of the image drawn, or undefined before any. */
  step?: number;
  /** The image is the saved picture, not yet the run's. */
  stored: boolean;
}

export interface StageImage extends StageStep {
  pixels?: Uint8ClampedArray;
}

/** The step the stage shows, without its pixels: for a view that names the step only (the dock's tab). */
export function stageStep(picture: OpenedPicture | null, session: RunState): StageStep {
  if (picture && showsStoredPicture(picture, session)) return { step: picture.step, stored: true };
  return { step: latestShown(session)?.step, stored: false };
}

export function useStageImage(picture: OpenedPicture | null, session: RunState): StageImage {
  const image = stageStep(picture, session);
  const decoded = useDecodedPicture(image.stored ? picture : null);
  return { ...image, pixels: image.stored ? decoded : latestShown(session)?.pixels };
}

/** The picture's RGBA pixels at the image size, decoded once per picture. */
function useDecodedPicture(picture: OpenedPicture | null): Uint8ClampedArray | undefined {
  const [decoded, setDecoded] = useState<{ png: Uint8Array; pixels: Uint8ClampedArray } | null>(null);
  const png = picture?.png;
  useEffect(() => {
    if (!png) return;
    let cancelled = false;
    const blob = new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" });
    decodeStill({ step: 0, blob }, IMAGE_SIZE).then(
      (pixels) => {
        if (!cancelled) setDecoded({ png, pixels });
      },
      () => {
        // An undecodable picture shows nothing; the worker refuses it too and the run starts from the seed.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [png]);
  return decoded && decoded.png === png ? decoded.pixels : undefined;
}
