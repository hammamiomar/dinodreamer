import type { LookPoint } from "../library/look-cloud";
import {
  MOST_SET_PICTURES, bandOfNorm, methodComparesDistributions, type FigureMethod, type FigureTargetSet, type SetPicture, type TargetSetSource,
} from "../materials/material-file";
import type { MaterialPoint, StrengthCuts } from "../recipe";

// The target set of a set method (Omar, 17 November 2026, evening): the patches the visitor selected on a
// group's page and sent to Train; with no selection, the group's strongest pictures in its public sample
// cloud, which is the research's own set. Either way the research's rule picks the pictures (meme, from
// research/given-set: selection.Band(block, "pole"), given_set.build with "3x3"). The page resolves the set
// and shows it; the worker fetches the pictures and has the engine prepare them once per run.

/** The research's standard set: at most this many pictures. Fewer is allowed, down to one. */
export const SET_PICTURES = MOST_SET_PICTURES;
export const SET_NEIGHBOURHOOD: FigureTargetSet["neighbourhood"] = "3x3";

/** A token's slot counts DINO's 5 prefix tokens (the class token and 4 registers) before the 256 patches. */
export const PREFIX_SLOTS = 5;

/** One patch that may enter a set: its picture, its token slot, the norm of its code, and whether the picture is public. */
export interface SetCandidate {
  imageId: number;
  slot: number;
  norm: number;
  publicPreview: boolean;
}

/**
 * The research's rule over candidate patches, as their positions in `candidates`, in set order: public
 * pictures only; strongest first by the norm of the code, ties in the given order (a stable sort, as the
 * research's); one patch for each distinct picture, its strongest; the first `count`. A pure function of
 * the rows, so a selection, the sample cloud and Look's send (which keeps these patches) take one rule.
 */
export function setChoice(candidates: readonly SetCandidate[], count = SET_PICTURES): number[] {
  const strongestFirst = candidates.map((candidate, position) => ({ candidate, position }))
    .filter(({ candidate }) => candidate.publicPreview)
    .sort((a, b) => b.candidate.norm - a.candidate.norm);
  const chosen: number[] = [];
  const taken = new Set<number>();
  for (const { candidate, position } of strongestFirst) {
    if (chosen.length === count) break;
    if (taken.has(candidate.imageId)) continue;
    taken.add(candidate.imageId);
    chosen.push(position);
  }
  return chosen;
}

/** The set's pictures from candidate patches, by setChoice's rule, in set order. */
export function resolveTargetSet(candidates: readonly SetCandidate[], count = SET_PICTURES): SetPicture[] {
  return setChoice(candidates, count).map((position) => {
    const { imageId, slot } = candidates[position]!;
    return { imageId, patch: slot - PREFIX_SLOTS };
  });
}

/**
 * The candidates of a visitor's selection (MaterialRequest.points): its library patches, the norm of
 * each code. A patch of the visitor's own picture is not a candidate: its pixels are not in the library.
 */
export function selectionCandidates(points: readonly MaterialPoint[]): SetCandidate[] {
  return points.flatMap((point) => point.source === "library"
    ? [{ imageId: point.imageId, slot: point.slot, norm: Math.hypot(...point.code), publicPreview: point.publicPreview !== false }]
    : []);
}

/** The fewest pictures a distribution method takes (decision 15, 17 November 2026): one picture is not a distribution. */
export const FEWEST_DISTRIBUTION_PICTURES = 2;

/**
 * Why a method cannot train toward a set, or null when it can (decision 15): a set needs a picture, and a
 * distribution method needs FEWEST_DISTRIBUTION_PICTURES. A mean method takes a set of one picture.
 */
export function setRefusal(method: FigureMethod, set: FigureTargetSet): "empty" | "one-picture" | null {
  if (set.pictures.length === 0) return "empty";
  if (methodComparesDistributions(method) && set.pictures.length < FEWEST_DISTRIBUTION_PICTURES) return "one-picture";
  return null;
}

/**
 * Whether a selection lies only at Level 1 or Level 2, by Look's band rule on the reference patch's cuts
 * (decision 15): a weak level tends to grow what surrounds the group's subject. False without library patches.
 */
export function weakSelection(points: readonly MaterialPoint[], strength: StrengthCuts): boolean {
  const library = points.filter((point) => point.source === "library");
  return library.length > 0 && library.every((point) => {
    const band = bandOfNorm(Math.hypot(...point.code), strength);
    return band === "barely" || band === "weakly";
  });
}

/** The candidates of the group's sample cloud (clouds/<block>.json), in file order, with the norms the file stores. */
export function sampleCandidates(points: readonly LookPoint[]): SetCandidate[] {
  return points.map((point) => ({ imageId: point.imageId, slot: point.slot, norm: point.norm, publicPreview: point.publicPreview }));
}

/**
 * The set's part of a kept file's id: "sample" for the group's sample strongest, the same set for every
 * run of a group; "selection-" and a fingerprint of the pictures for a visitor's selection, so two
 * selections name two files. The fingerprint is 32-bit FNV-1a of "imageId.patch" in set order, in hex:
 * it tells sets apart in a name; the file's settings.set holds the pictures themselves.
 */
export function targetSetKey(set: FigureTargetSet): string {
  if (set.source === "sample-strongest") return "sample";
  let hash = 0x811c9dc5;
  for (const character of set.pictures.map(({ imageId, patch }) => `${imageId}.${patch}`).join(",")) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
  }
  return `selection-${hash.toString(16).padStart(8, "0")}`;
}

/** Whether two sets are the same: the same source and the same pictures in the same order; two absent sets are. */
export function sameTargetSet(a: FigureTargetSet | null, b: FigureTargetSet | null): boolean {
  if (a === null || b === null) return a === b;
  return a.source === b.source && a.pictures.length === b.pictures.length
    && a.pictures.every((picture, index) => picture.imageId === b.pictures[index]!.imageId && picture.patch === b.pictures[index]!.patch);
}

/** The set as a kept file and the worker's command carry it, in set order. */
export function targetSetRecord(source: TargetSetSource, pictures: readonly SetPicture[]): FigureTargetSet {
  return { source, neighbourhood: SET_NEIGHBOURHOOD, pictures: pictures.map(({ imageId, patch }) => ({ imageId, patch })) };
}

/** The set's pictures that could be fetched, in set order, with their PNG bytes. */
export interface FetchedSet {
  pictures: SetPicture[];
  pngs: Uint8Array[];
  /** The pictures that could not be fetched: dropped and not replaced, as in the research. */
  dropped: SetPicture[];
}

/** Concurrent preview requests: 33 pictures of about 100 kB each arrive in a few round trips. */
const CONCURRENT_FETCHES = 8;

/**
 * Fetch each set picture's 256 px preview PNG (`previewUrl`). A picture whose request fails or answers
 * with an error is dropped. `onFetched` counts the answered requests, for the status.
 */
export async function fetchSetPictures(
  pictures: readonly SetPicture[], previewUrl: (imageId: number) => string, fetcher: typeof fetch, onFetched: (answered: number) => void = () => {},
): Promise<FetchedSet> {
  const bytes: (Uint8Array | null)[] = new Array(pictures.length).fill(null);
  let next = 0;
  let answered = 0;
  const fetchNext = async () => {
    while (next < pictures.length) {
      const index = next++;
      try {
        const response = await fetcher(previewUrl(pictures[index]!.imageId));
        if (response.ok) bytes[index] = new Uint8Array(await response.arrayBuffer());
      } catch {
        // A picture that cannot be fetched is dropped.
      }
      onFetched(++answered);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_FETCHES, pictures.length) }, fetchNext));
  const fetched: FetchedSet = { pictures: [], pngs: [], dropped: [] };
  pictures.forEach((picture, index) => {
    const png = bytes[index];
    if (png) {
      fetched.pictures.push(picture);
      fetched.pngs.push(png);
    } else {
      fetched.dropped.push(picture);
    }
  });
  return fetched;
}
