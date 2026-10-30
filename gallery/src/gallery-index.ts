// The published gallery: published/index.json on the public bucket, newest first.
// Only the owner's review operations rewrite it (review.ts, from the terminal commands or the
// owner page); the Worker's public API serves it as stored.

export interface GalleryEntry {
  id: string;
  title: string;
  credit: string;
  /** The full image, a 256 × 256 PNG of up to 2 MB: for the viewer, not for tiles. */
  imageUrl: string;
  /** A 256 px WebP of the image, for the landing row and the Gallery page's tiles. */
  thumbnailUrl: string;
  recipeUrl: string;
  publishedAt: string;
  /**
   * The engine build that made the image, as the submission recorded it: the engine's wasm
   * asset name. Absent for an entry submitted without it.
   */
  engine?: string;
}

export interface GalleryIndex {
  entries: GalleryEntry[];
}

export const EMPTY_INDEX: GalleryIndex = { entries: [] };

/** The index with this entry added, or replacing an entry with the same id; newest first. */
export function withEntry(index: GalleryIndex, entry: GalleryEntry): GalleryIndex {
  const others = index.entries.filter((existing) => existing.id !== entry.id);
  const entries = [...others, entry].sort(
    (a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id),
  );
  return { entries };
}

/** The index without the entry of this id; the same object when there is none. */
export function withoutEntry(index: GalleryIndex, id: string): GalleryIndex {
  if (!index.entries.some((entry) => entry.id === id)) return index;
  return { entries: index.entries.filter((entry) => entry.id !== id) };
}
