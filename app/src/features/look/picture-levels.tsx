import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { useLibrary } from "../../app/library-session";
import type { AtlasBand } from "../../library/atlas-cloud";
import { GRID, PATCH_SLOT_OFFSET } from "../../recipe";
import { LibraryImage } from "../../ui/library-image";
import { useLevelPictures } from "../atlas/level-pictures";
import { BAND_COLOURS } from "./strength-bands";

// Each basis group's row on Your picture shows the group's library pictures, one per response
// level, so the whole set reads without opening each group. The pictures read at low priority, only
// for rows in view, a few rows at a time in the page's order, and not while the visitor leaves the
// page or opens a basis group. A page of 8 to 30 groups then never delays a click (the site audit of
// 18 November 2026).

/**
 * Rows that read their pictures at once. Each row reads one picture at a time, so at most four thumbnails
 * of about 7 kB are on the network. Measured 20 November 2026 on the development server, cold cache: four
 * at once filled a desktop screen of eight groups in 1.9 s, two at once in 2.4 s.
 */
export const ROWS_READING_AT_ONCE = 4;
/** One picture per level: the record's first, the picture an Index card shows first. */
const PICTURES_PER_LEVEL = 1;
/** The four response levels, weakest first: the order of a row's library pictures and of the column head. */
export const LEVELS: readonly AtlasBand[] = [0, 1, 2, 3];

/**
 * The rows that may read their pictures now: the first `limit` rows, in page order, that are in view
 * and not yet settled. None while the page is paused.
 */
export function rowsToRead(
  order: readonly number[],
  inView: ReadonlySet<number>,
  settled: ReadonlySet<number>,
  paused: boolean,
  limit = ROWS_READING_AT_ONCE,
): ReadonlySet<number> {
  if (paused) return new Set();
  const waiting = order.filter((block) => inView.has(block) && !settled.has(block));
  return new Set(waiting.slice(0, limit));
}

/** The blocks of the list's rows (`data-block`) that are in view now. `order` names the rows, so new rows are observed. */
export function useRowsInView(list: RefObject<HTMLElement | null>, order: string): ReadonlySet<number> {
  const [inView, setInView] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const intersecting = new Set<number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const block = Number((entry.target as HTMLElement).dataset.block);
        if (entry.isIntersecting) intersecting.add(block);
        else intersecting.delete(block);
      }
      setInView(new Set(intersecting));
    });
    for (const row of element.children) observer.observe(row);
    return () => observer.disconnect();
  }, [list, order]);
  return inView;
}

/**
 * A basis group's four response levels: the first library picture of each level with its patch
 * marked and the level's colour along its lower edge, as on the Index cards; the visitor's level is
 * framed. A level that is still reading, that failed or that has no picture keeps its square as a
 * tile in its colour. The squares are a preview inside the row's link to the group, so they carry
 * no names of their own.
 */
export function GroupLevels({ block, reading, marked, onSettled }: {
  block: number;
  /** The page admits this row's reads (rowsToRead). */
  reading: boolean;
  /** The level of the visitor's patch: its square is framed. */
  marked: AtlasBand | null;
  onSettled: (block: number) => void;
}) {
  const library = useLibrary();
  const { slots, settled } = useLevelPictures(library, block, reading, PICTURES_PER_LEVEL);
  useEffect(() => {
    if (settled) onSettled(block);
  }, [settled, block, onSettled]);
  return (
    <div className="picture-group-levels" aria-hidden="true">
      {LEVELS.map((band) => {
        const slot = slots?.[band][0];
        const style = { "--band": BAND_COLOURS[band] } as CSSProperties;
        const framed = band === marked || undefined;
        if (slot?.kind !== "picture") return <span key={band} className="picture-group-level" data-band={band} data-marked={framed} style={style} />;
        const patch = slot.picture.slot - PATCH_SLOT_OFFSET;
        return (
          <span key={band} className="picture-group-level" data-band={band} data-marked={framed} style={style}>
            <LibraryImage {...{ fetchpriority: "low" }} src={library.thumbnailUrl(slot.picture.imageId)} alt="" />
            <i style={{ left: `${((patch % GRID) / GRID) * 100}%`, top: `${(Math.floor(patch / GRID) / GRID) * 100}%` }} />
          </span>
        );
      })}
    </div>
  );
}
