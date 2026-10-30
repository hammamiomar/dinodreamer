import { SITE_WORDS, fill } from "../app/site-words";
import type { StrengthBand } from "../recipe";
import type { LiveReading } from "./protocol";
import { MAP_PATCHES, neededPatches, readPatchIndices, type ReadRegion } from "./selection-cells";

const BAND_NAMES: Record<StrengthBand, string> = { barely: "Level 1", weakly: "Level 2", strongly: "Level 3", strongest: "Level 4" };

export function bandName(band: StrengthBand): string {
  return BAND_NAMES[band];
}

/** Counts selected patches and the target, naming the central region when only its 16 patches are read. */
export function readoutText(reading: Pick<LiveReading, "winnerFraction">, group: number, region?: ReadRegion): string {
  const patches = region ? readPatchIndices(region).length : MAP_PATCHES;
  const words = region ? SITE_WORDS.grow.readingCentre : SITE_WORDS.grow.reading;
  return fill(words, { group, selected: Math.round(reading.winnerFraction * patches), patches, needed: neededPatches(patches) });
}
