import type { CloudRows } from "../library/block-cloud";
import { MOST_SET_PICTURES, type FigureTargetSet, type SetPicture } from "../materials/material-file";

// The target set of a set method (Omar's decision 2, 17 November 2026): the basis group's 33 strongest
// distinct public pictures, with the 3 × 3 tokens around each one's patch, as in the research's standard
// runs (research/given-set: selection.Band(block, "pole"), given_set.build with "3x3"). The worker
// resolves it, fetches the pictures and has the engine prepare it once per run (grow.worker.ts).

/**
 * Where the set's pictures come from: the group's published strongest rows, the top 1,024 of the
 * whole response set. The research takes them from a frozen 4,096-row public sample; the two give
 * different sets (8 to 30 shared pictures of 33 on six groups). Which one the page uses is Omar's
 * decision. Until then it is the strongest file, the only one the browser has.
 */
export const SET_SOURCE: FigureTargetSet["source"] = "strongest";
export const SET_NEIGHBOURHOOD: FigureTargetSet["neighbourhood"] = "3x3";

/** A token's slot counts DINO's 5 prefix tokens (the class token and 4 registers) before the 256 patches. */
const PREFIX_SLOTS = 5;

/**
 * The set's pictures from a group's strongest rows: the rows in file order, which is descending norm;
 * public rows only; the first row of each distinct picture; the first `count`. The research orders its
 * public rows by norm with a stable sort and takes the first row per picture the same way
 * (selection.distinct_pictures).
 */
export function resolveTargetSet(rows: Pick<CloudRows, "count" | "imageIds" | "slots" | "publicPreview">, count = MOST_SET_PICTURES): SetPicture[] {
  const pictures: SetPicture[] = [];
  const taken = new Set<number>();
  for (let row = 0; row < rows.count && pictures.length < count; row++) {
    const imageId = rows.imageIds[row]!;
    if (rows.publicPreview[row] !== 1 || taken.has(imageId)) continue;
    taken.add(imageId);
    pictures.push({ imageId, patch: rows.slots[row]! - PREFIX_SLOTS });
  }
  return pictures;
}

/** The set as a kept file records it (`recipe.settings.set`), in set order. */
export function targetSetRecord(pictures: readonly SetPicture[]): FigureTargetSet {
  return { source: SET_SOURCE, neighbourhood: SET_NEIGHBOURHOOD, pictures: pictures.map(({ imageId, patch }) => ({ imageId, patch })) };
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
