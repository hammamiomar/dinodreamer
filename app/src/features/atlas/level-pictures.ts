import { useLayoutEffect, useState } from "react";
import type { AtlasCloud } from "../../library/atlas-cloud";
import type { Library } from "../../library/library";
import { loadLibraryPicture } from "../../ui/library-image";
import { pictureSlots, type PictureSlot } from "./card-loading";

// A basis group's library pictures by response level, read while a preview of the group is in view:
// the Automata wall's plates (four per level) and the rows on Your picture (one per level). The
// Index cards read theirs through card-loading.ts, before a card is shown.

type AtlasPicture = AtlasCloud["pictures"][number];

/**
 * The pictures a view reads, in reading order: at most `perLevel` of each level, in record order,
 * the strongest level first, so the most telling pictures appear first.
 */
export function levelReadingOrder(pictures: readonly AtlasPicture[], perLevel: number): AtlasPicture[] {
  const taken = [0, 0, 0, 0];
  const chosen = pictures.filter((picture) => taken[picture.band]++ < perLevel);
  // A stable sort: within a level, record order stays.
  return chosen.sort((first, second) => second.band - first.band);
}

export interface LevelPictures {
  /** Each level's slots (pictureSlots) for the pictures read so far; null before the first one. */
  slots: PictureSlot[][] | null;
  /** Nothing more will load: every chosen picture was read or failed, or the record could not be read. */
  settled: boolean;
}

/**
 * Reads a group's level pictures while `wanted`, one image at a time and at low priority, and paints
 * each one as it decodes. It stops when `wanted` turns false (the view left the screen or a navigation
 * started): the effect aborts what it has not read. A picture that fails becomes a tile in its level's colour.
 */
export function useLevelPictures(library: Library, block: number, wanted: boolean, perLevel: number): LevelPictures {
  const [reading, setReading] = useState<{ block: number; count: number; complete: boolean; slots: PictureSlot[][] } | null>(null);
  const [unreadable, setUnreadable] = useState<number | null>(null);
  const complete = reading?.block === block && reading.complete;
  useLayoutEffect(() => {
    if (!wanted || complete) return;
    const controller = new AbortController();
    const { signal } = controller;
    async function read() {
      const cloud = await library.atlasCloud(block, "low");
      setUnreadable((previous) => (previous === block ? null : previous));
      const pictures = levelReadingOrder(cloud.pictures, perLevel);
      const failed = new Set<number>();
      for (const [index, picture] of pictures.entries()) {
        if (signal.aborted) return;
        try {
          await loadLibraryPicture(library.thumbnailUrl(picture.imageId), { priority: "low", signal });
        } catch {
          failed.add(picture.imageId);
        }
        if (signal.aborted) return;
        // Paint each decoded picture while the weaker levels load.
        const count = index + 1;
        const slots = pictureSlots(pictures.slice(0, count), (item) => failed.has(item.imageId));
        setReading((previous) => previous?.block === block && previous.count >= count
          ? previous
          : { block, count, complete: count === pictures.length, slots });
      }
      if (pictures.length === 0) setReading({ block, count: 0, complete: true, slots: pictureSlots([], () => false) });
    }
    // A missing record leaves the levels' coloured tiles; the next `wanted` tries again.
    void read().catch(() => { if (!signal.aborted) setUnreadable(block); });
    return () => controller.abort();
  }, [library, block, wanted, complete, perLevel]);
  return {
    slots: reading?.block === block ? reading.slots : null,
    settled: complete || unreadable === block,
  };
}
