// How the home moves (home-page.tsx): which beat the window is on as the page scrolls, and which
// sections may load their files (home-panel.tsx). Pure, so the page only measures and applies.
// The browser owns the scroll.

/** The page's sections in order: the entrance, the four scenes, and the closing hibiscus field. */
export const HOME_BEATS = ["entrance", "properties", "collection", "train", "keep", "end"] as const;
export type HomeBeat = (typeof HOME_BEATS)[number];

/**
 * The line of the window the page reads at, from its top: the middle of the words' part of it.
 * On a wide window the words have the whole height (`panelShare` 0).
 */
export function readingLine(windowHeight: number, panelShare = 0): number {
  return windowHeight * (panelShare + (1 - panelShare) / 2);
}

/**
 * The section the window is on, from the sections' tops in page pixels: the last one whose top is at
 * or above the reading line (`line` pixels under the window's top), so a beat becomes current once
 * its words have reached that line, and the first before any has.
 */
export function sectionAt(tops: readonly number[], scrollY: number, line: number): number {
  const reading = scrollY + line;
  let at = 0;
  tops.forEach((top, index) => {
    if (reading >= top) at = index;
  });
  return at;
}

/**
 * The beats whose stages may load their files, from the furthest section the reader has reached (an index
 * into HOME_BEATS) and whether the page has scrolled at all. The entrance loads at once. After the first
 * scroll, a beat loads while the reader is one section before it, so its stage is ready when its words
 * arrive. A visitor who stays on the entrance downloads nothing for the sections below it.
 */
export function approachedBeats(furthest: number, scrolled: boolean): Record<HomeBeat, boolean> {
  const approached = {} as Record<HomeBeat, boolean>;
  HOME_BEATS.forEach((beat, at) => {
    approached[beat] = at === 0 || (scrolled && at <= furthest + 1);
  });
  return approached;
}
