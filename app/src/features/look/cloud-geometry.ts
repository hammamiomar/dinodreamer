import { cloudPoint, type BlockCloud, type CloudAxes, type CloudRows } from "../../library/block-cloud";
import type { Code, StrengthCuts } from "../../recipe";
import { projector, type ScreenPoint, type Vec3, type View } from "../../ui/code-space/projection";
import type { CloudToken } from "./cloud-token";
import { bandColours, bandIndex, bandMembers, type BandIndex } from "./strength-bands";

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Coordinate j is dot(code, axes[j]). The axes are orthonormal, so norms and distances do not change. */
export function inPrincipalFrame(code: Vec3, axes: CloudAxes): Code {
  return [dot(code, axes[0]), dot(code, axes[1]), dot(code, axes[2])];
}

export function projectCloud(codes: readonly Vec3[], view: View): ScreenPoint[] {
  return codes.map(projector(view));
}

/**
 * The block page's points, in four groups:
 *
 * - your picture's patches, page indices [0, own);
 * - the uniform public sample: band counts, strips and lifts;
 * - the block's strongest rows, when published (at most 1,024, norm descending);
 * - the loaded prefix of the full file: drawing and selection.
 *
 * Only the last group grows, so loading more rows never renumbers a selection.
 * When the page falls back to the sample, the prefix group is empty.
 */
export interface PreparedCloud {
  count: number;
  own: number;
  sample: number;
  strongestRows: number;
  native: Vec3[];
  display: Vec3[];
  norms: Float64Array;
  bands: BandIndex[];
  colours: string[];
  /** 1 for a row whose occurrence an earlier group already holds: a selection counts it once. */
  repeats: Uint8Array;
  /** Distinct library occurrences on the page. */
  libraryRows: number;
  /** Distinct library occurrences without a public picture. */
  withoutPicture: number;
  /** Sample rows per band, with or without pictures. The block's shares are estimated from these. */
  sampleCounts: [number, number, number, number];
  /** Page indices of sample rows with pictures, per band, strongest first. */
  members: number[][];
  /** Page indices of the picture's patches, strongest first. */
  ownByStrength: number[];
  /** The camera's radius: every loaded patch and the whole cloud's maximum stay in view. */
  extent: number;
  /** The strongest sample patch with a picture, or null. */
  strongest: number | null;
}

/** The full file's loaded rows, or null when the page shows the sample alone. */
export function prefixRows(cloud: BlockCloud): CloudRows | null {
  return cloud.source === "full" ? cloud.rows : null;
}

/** The library groups in page order, after your picture's patches. */
function libraryGroups(cloud: BlockCloud): CloudRows[] {
  const prefix = prefixRows(cloud);
  return [cloud.sample, ...(cloud.strongest ? [cloud.strongest] : []), ...(prefix ? [prefix] : [])];
}

export function prepareCloud(cloud: BlockCloud, own: readonly CloudToken[], strength: StrengthCuts): PreparedCloud {
  const groups = libraryGroups(cloud);
  const count = own.length + groups.reduce((sum, rows) => sum + rows.count, 0);
  const native: Vec3[] = own.map((point) => point.code);
  const norms = new Float64Array(count);
  own.forEach((point, index) => { norms[index] = point.norm; });
  const repeats = new Uint8Array(count);
  const seen = new Map<number, Set<number>>();
  let repeated = 0;
  let withoutPicture = 0;
  for (const rows of groups) {
    for (let row = 0; row < rows.count; row++) {
      const index = native.length;
      norms[index] = rows.norms[row];
      native.push([rows.codes[3 * row], rows.codes[3 * row + 1], rows.codes[3 * row + 2]]);
      const slots = seen.get(rows.imageIds[row]) ?? new Set<number>();
      if (slots.has(rows.slots[row])) {
        repeats[index] = 1;
        repeated++;
      } else if (rows.publicPreview[row] === 0) {
        withoutPicture++;
      }
      slots.add(rows.slots[row]);
      seen.set(rows.imageIds[row], slots);
    }
  }
  const sample = cloud.sample.count;
  const bands: BandIndex[] = [];
  const sampleCounts: [number, number, number, number] = [0, 0, 0, 0];
  let extent = Math.max(strength.maximum, cloud.whole.maximumNorm);
  const inSample = (index: number) => index >= own.length && index < own.length + sample;
  for (let index = 0; index < count; index++) {
    bands[index] = bandIndex(norms[index], strength);
    if (inSample(index)) sampleCounts[bands[index]]++;
    extent = Math.max(extent, norms[index]);
  }
  const members = bandMembers(norms, strength, (index) => inSample(index) && cloud.sample.publicPreview[index - own.length] === 1);
  const ownByStrength = bandMembers(norms, strength, (index) => index < own.length).reverse().flat();
  const strongest = members.slice().reverse().find((band) => band.length > 0)?.[0] ?? null;
  return {
    count,
    own: own.length,
    sample,
    strongestRows: cloud.strongest?.count ?? 0,
    native,
    display: native.map((code) => inPrincipalFrame(code, cloud.whole.axes)),
    norms,
    bands,
    colours: bands.map((band) => bandColours()[band]),
    repeats,
    libraryRows: count - own.length - repeated,
    withoutPicture,
    sampleCounts,
    members,
    ownByStrength,
    extent,
    strongest,
  };
}

/** The library rows and row number that hold a page index of the library groups. */
function libraryRow(cloud: BlockCloud, own: number, index: number): { rows: CloudRows; row: number } {
  let row = index - own;
  for (const rows of libraryGroups(cloud)) {
    if (row < rows.count) return { rows, row };
    row -= rows.count;
  }
  throw new Error("No patch at this page index.");
}

/** One page index as a point object, made only where the UI or a request needs it. */
export function pageToken(cloud: BlockCloud, own: readonly CloudToken[], index: number): CloudToken {
  if (index < own.length) return own[index];
  const { rows, row } = libraryRow(cloud, own.length, index);
  return cloudPoint(rows, row);
}

/** Your picture's patches always have a picture; library rows say so in their column. */
export function pageHasPicture(cloud: BlockCloud, own: number, index: number): boolean {
  if (index < own) return true;
  const { rows, row } = libraryRow(cloud, own, index);
  return rows.publicPreview[row] === 1;
}
