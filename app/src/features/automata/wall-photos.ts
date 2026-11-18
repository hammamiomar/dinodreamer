import { useEffect, useState, type RefObject } from "react";
import type { Library } from "../../library/library";
import { loadLibraryPicture } from "../../ui/library-image";
import { pictureSlots, type PictureSlot } from "../atlas/card-loading";

/** One observer reports the entire visible batch, so the last visible definition permits the focused deck to load. */
export function useVisibleDecks(table: RefObject<HTMLOListElement | null>, order: string, displayed: boolean) {
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    setVisible(new Set());
    if (!displayed || !table.current) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active) return;
      setVisible(previous => {
        const next = new Set(previous);
        for (const entry of entries) {
          const group = Number((entry.target as HTMLElement).dataset.group);
          if (entry.isIntersecting && entry.intersectionRatio > 0) next.add(group);
          else next.delete(group);
        }
        return next;
      });
    });
    for (const deck of table.current.children) observer.observe(deck);
    return () => { active = false; observer.disconnect(); };
  }, [table, order, displayed]);
  return visible;
}

/** Only the deck under the pointer or keyboard focus admits photos. Its effect owns one image at a time. */
export function useWallPhotos(library: Library, block: number, wanted: boolean) {
  const [plates, setPlates] = useState<{ block: number; count: number; complete: boolean; slots: PictureSlot[][] } | null>(null);
  const complete = plates?.block === block && plates.complete;
  useEffect(() => {
    if (!wanted || complete) return;
    const controller = new AbortController();
    const { signal } = controller;
    async function read() {
      const cloud = await library.atlasCloud(block, "low");
      const pictures = [...cloud.pictures].sort((first, second) => second.band - first.band);
      const failed = new Set<number>();
      for (const [index, picture] of pictures.entries()) {
        if (signal.aborted) return;
        try {
          await loadLibraryPicture(library.thumbnailUrl(picture.imageId), { priority: "low", signal });
        } catch {
          failed.add(picture.imageId);
        }
        if (signal.aborted) return;
        // The upper plate opens first. Paint each decoded photograph while the lower plates load.
        const count = index + 1;
        const slots = pictureSlots(pictures.slice(0, count), item => failed.has(item.imageId));
        setPlates(previous => previous?.block === block && previous.count >= count
          ? previous
          : { block, count, complete: count === pictures.length, slots });
      }
    }
    void read().catch(() => { /* A missing record leaves the four colored plate edges. */ });
    return () => controller.abort();
  }, [library, block, wanted, complete]);
  return plates?.block === block ? plates.slots : null;
}
