import { SITE_WORDS, fill } from "../app/site-words";
import type { StrengthBand } from "../recipe";
import type { LiveReading } from "./protocol";
import { MAP_PATCHES, neededPatches, readPatchIndices, type ReadRegion } from "./selection-cells";

const BAND_NAMES: Record<StrengthBand, string> = { barely: "Level 1", weakly: "Level 2", strongly: "Level 3", strongest: "Level 4" };

export function bandName(band: StrengthBand): string {
  return BAND_NAMES[band];
}

/**
 * Counts selected patches, naming the central region when only its 16 patches are read, and the selection
 * target's count. A run that compares with a set has no selection target (`selectionTarget` false), so its
 * line gives the count alone.
 */
export function readoutText(reading: Pick<LiveReading, "winnerFraction">, group: number, region?: ReadRegion, selectionTarget = true): string {
  const patches = region ? readPatchIndices(region).length : MAP_PATCHES;
  const WORDS = SITE_WORDS.grow;
  let words: string;
  if (selectionTarget) words = region ? WORDS.readingCentre : WORDS.reading;
  else words = region ? WORDS.readingSetCentre : WORDS.readingSet;
  return fill(words, { group, selected: Math.round(reading.winnerFraction * patches), patches, needed: neededPatches(patches) });
}
