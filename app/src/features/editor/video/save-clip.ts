// Save video: the recording's stills become a clip and a download. The encoder is
// chosen here (clip.ts), the stills decoded on a canvas (stills.ts); everything loads
// only on this click.

import { downloadBlob } from "../../../ui/files";
import type { Recording } from "../run/recording";
import type { ShownImage } from "../run/session";
import { chooseEncoder, clipStills, planClip, savedFileName } from "./clip";
import { decodeStill, encodeStill } from "./stills";

/**
 * Encodes the recording as a clip ending on the image on screen and downloads it as
 * "<title>-<step>.<mp4|gif>".
 */
export async function saveClip(recording: Recording, title: string, shown?: ShownImage): Promise<void> {
  const final = shown ? { step: shown.step, blob: await encodeStill(shown.pixels) } : undefined;
  const plan = planClip(clipStills(recording.stills, final));
  if (plan.length < 2) return;
  const encoder = await chooseEncoder();
  const blob = await encoder.encode(plan, decodeStill);
  const lastStep = plan[plan.length - 1]!.still.step;
  downloadBlob(blob, savedFileName(title, lastStep, encoder.extension));
}
