// How the home moves (home-page.tsx): which beat the window is on as the page scrolls, how a beat's
// figure plays once the beat has arrived, and what each figure shows at a point of its play
// (home-panel.tsx). Pure, so the page only measures and applies. The browser owns the scroll.

/** The page's sections in order: the entrance, the three beats, the end. */
export const HOME_BEATS = ["entrance", "model", "basis", "automaton", "end"] as const;
export type HomeBeat = (typeof HOME_BEATS)[number];

/**
 * The line of the window the page reads at, from its top: the middle of the words' part of it. On a
 * wide window the words have the whole height; on a narrow one the panel takes `panelShare` of it
 * from the top (home.css, 60 %) and the words the rest.
 */
export function readingLine(windowHeight: number, panelShare: number): number {
  return windowHeight * (panelShare + (1 - panelShare) / 2);
}

/** The panel's share of a narrow window (home.css, .home-panel). */
export const NARROW_PANEL_SHARE = 0.6;

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

/** How long a beat's figure plays once the beat has arrived, in milliseconds; 0 where there is nothing to play. */
export const BEAT_PLAY_MS: Record<HomeBeat, number> = { entrance: 0, model: 4000, basis: 3000, automaton: 6000, end: 0 };

/** The frame for a progress from 0 to 1, of `count` frames: the first at 0, the last at 1. */
export function frameAt(progress: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.round(progress * (count - 1))));
}

/** The model's layer the attention is read at, 1 to `layers`, over the play. */
export function layerAt(progress: number, layers = 12): number {
  return 1 + frameAt(progress, layers);
}

/** How much of the cloud has arrived: the four levels in order, then the patch's point; 0 to 5. */
export function levelsArrived(progress: number): number {
  return frameAt(progress, 6);
}
