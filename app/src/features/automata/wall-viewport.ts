import { useEffect, useState, type RefObject } from "react";

/** Backtracking by a few decks preserves their cells. All other offscreen decks use their posters. */
const RECENT_OFFSCREEN_DECKS = 3;

interface WallViewport {
  visible: ReadonlySet<number>;
  recent: readonly number[];
}

export function updateWallViewport(previous: WallViewport, visible: ReadonlySet<number>): WallViewport {
  const left = [...previous.visible].filter(group => !visible.has(group));
  const recent = previous.recent.filter(group => !visible.has(group)).concat(left);
  return { visible, recent: recent.slice(-RECENT_OFFSCREEN_DECKS) };
}

/** One observer reports each batch before faces or photos start. */
export function useWallViewport(table: RefObject<HTMLOListElement | null>, order: string, displayed: boolean) {
  const [viewport, setViewport] = useState<WallViewport>({ visible: new Set(), recent: [] });
  useEffect(() => {
    if (!displayed || !table.current) {
      setViewport(previous => updateWallViewport(previous, new Set()));
      return;
    }
    let active = true;
    const intersections = new Set<number>();
    const observer = new IntersectionObserver(entries => {
      if (!active) return;
      for (const entry of entries) {
        const group = Number((entry.target as HTMLElement).dataset.group);
        if (entry.isIntersecting && entry.intersectionRatio > 0) intersections.add(group);
        else intersections.delete(group);
      }
      const visible = new Set(intersections);
      setViewport(previous => updateWallViewport(previous, visible));
    });
    for (const deck of table.current.children) observer.observe(deck);
    return () => { active = false; observer.disconnect(); };
  }, [table, order, displayed]);
  return viewport;
}
