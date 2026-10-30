import type { AtlasCloud } from "../../library/atlas-cloud";
import type { StrengthBand, StrengthCuts } from "../../recipe";
// Explicit .ts: the gallery's terminal commands load this module under plain Node through material-file.ts.
import { cssColour } from "../../ui/css-colour.ts";

// One band rule for the Atlas, the block page, the picture page and the request.
// engine/tools/prepare_atlas.py computes the cuts once per block from the public
// sample and stores them in the Atlas record. The block page applies the same rule
// to the same sample, which it already holds; the picture page reads the records.
// Neither refits the cuts to a loaded prefix of the full cloud. Occurrences beyond
// the sample maximum are Strongest.

/** Band index 0–3 is the number an Atlas record stores, from the ring outward. */
export type BandIndex = 0 | 1 | 2 | 3;
export const STRENGTH_BANDS: readonly StrengthBand[] = ["barely", "weakly", "strongly", "strongest"];
/** The response levels' names on the site; the stored band strings above stay. */
export const BAND_NAMES = ["Level 1", "Level 2", "Level 3", "Level 4"] as const;
/** The bands' colour tokens in styles.css, Barely to Strongest. */
export const BAND_TOKENS = ["--barely", "--weakly", "--strongly", "--strongest"] as const;
/** Each band's colour for a style: the token itself, so a page follows styles.css. */
export const BAND_COLOURS: readonly string[] = BAND_TOKENS.map((token) => `var(${token})`);
/** The tokens' values where there is no stylesheet (tests in node): the same as styles.css. */
const BAND_FALLBACKS = ["#8f9aa8", "#7fd3b5", "#dccf63", "#ee9a62"] as const;
let computedBandColours: readonly string[] | null = null;

/**
 * Each band's colour as a value a canvas or WebGL can draw with (neither reads var()): the
 * tokens' values, read once on the first draw, when the stylesheet has loaded.
 */
export function bandColours(): readonly string[] {
  if (typeof document === "undefined") return BAND_FALLBACKS;
  computedBandColours ??= BAND_TOKENS.map((token, band) => cssColour(token, BAND_FALLBACKS[band]));
  return computedBandColours;
}
export const STRONGEST: BandIndex = 3;

export function strengthCuts(record: Pick<AtlasCloud, "ring" | "cuts" | "maximum">): StrengthCuts {
  return { ring: record.ring, cuts: [...record.cuts], maximum: record.maximum };
}

/**
 * The producer's rule on the public sample: quarter the distance from the ring to
 * the sample's largest norm. When no norm passes the ring, every cut is the ring.
 */
export function sampleStrengthCuts(ring: number, sampleNorms: ArrayLike<number>): StrengthCuts {
  let maximum = 0;
  for (let index = 0; index < sampleNorms.length; index++) maximum = Math.max(maximum, sampleNorms[index]);
  if (maximum <= ring) return { ring, cuts: [ring, ring, ring], maximum };
  const quarter = (maximum - ring) / 4;
  return { ring, cuts: [ring + quarter, ring + 2 * quarter, ring + 3 * quarter], maximum };
}

/**
 * The number of cuts at or below the norm, as numpy's searchsorted(cuts, norm, side="right").
 * When the sample never passes the ring, every cut equals the ring and every patch is Barely.
 */
export function bandIndex(norm: number, strength: StrengthCuts): BandIndex {
  if (strength.maximum <= strength.ring) return 0;
  let band = 0;
  for (const cut of strength.cuts) if (norm >= cut) band++;
  return band as BandIndex;
}

/**
 * Where a norm sits along the lobe: 0 at the ring and 1 at the sample maximum.
 * Each band is a quarter of this distance. A patch inside the ring is negative;
 * a patch beyond the sample maximum is above 1. A block whose sample never
 * passes its ring has no lobe to measure; it reports 0.
 */
export function lobePosition(norm: number, strength: StrengthCuts): number {
  const length = strength.maximum - strength.ring;
  return length > 0 ? (norm - strength.ring) / length : 0;
}

/**
 * Indices per band, strongest first inside each band. Ties keep row order.
 * The stored row order is not changed; this is only the order a strip shows.
 */
export function bandMembers(norms: ArrayLike<number>, strength: StrengthCuts, include: (index: number) => boolean = () => true): number[][] {
  const members: number[][] = [[], [], [], []];
  for (let index = 0; index < norms.length; index++) {
    if (include(index)) members[bandIndex(norms[index], strength)].push(index);
  }
  for (const band of members) band.sort((a, b) => norms[b] - norms[a] || a - b);
  return members;
}
