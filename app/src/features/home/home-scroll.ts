// How the home moves (home-page.tsx): which beat the window is on, the pages a wheel gesture turns
// between, how a beat's figure plays once the beat has arrived, and what each figure shows at a
// point of its play (home-panel.tsx). Pure, so the page only measures and applies.

export { easeOutCubic } from "../../ui/tween";

/** The page's sections in order: the entrance, the three beats, the end. */
export const HOME_BEATS = ["entrance", "model", "basis", "automaton", "end"] as const;
export type HomeBeat = (typeof HOME_BEATS)[number];

/** Where a section is on the page: its top in page pixels and its height. */
export interface SectionPlace {
  top: number;
  height: number;
  /** Last readable content, excluding the section's empty space and bottom padding. */
  contentBottom?: number;
}

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
 * The section the window is on: the last one whose top is at or above the reading line (`line`
 * pixels under the window's top), so a beat becomes current once its words have reached that
 * line, and the first before any has.
 */
export function sectionAt(sections: readonly SectionPlace[], scrollY: number, line: number): number {
  const reading = scrollY + line;
  let at = 0;
  sections.forEach((section, index) => {
    if (reading >= section.top) at = index;
  });
  return at;
}

/**
 * Wheel stops are section tops minus `offset` (the narrow panel's height), clamped to the page.
 * Include the page's end so the footer is reachable. Tall text gets overlapping reading stops
 * before the next section.
 */
export function pageTops(sections: readonly SectionPlace[], scrollMax: number, offset = 0, windowHeight = 0): number[] {
  const tops = [0];
  const maximum = Math.max(0, scrollMax);
  const add = (top: number) => {
    const bounded = Math.min(maximum, Math.max(0, top));
    if (bounded > tops[tops.length - 1]! + 1) tops.push(bounded);
  };
  const readingHeight = windowHeight - offset;
  for (const section of sections) {
    const start = Math.max(0, section.top - offset);
    add(start);
    if (section.contentBottom === undefined || readingHeight <= 0) continue;
    const end = Math.min(maximum, section.contentBottom - windowHeight);
    const overflow = end - start;
    // A margin or short final line must not consume another gesture.
    if (overflow < readingHeight * 0.2) continue;
    // Keep at least a fifth of the previous view visible. Even spacing avoids
    // a short final step when the overflow is just over a full reading step.
    const steps = Math.ceil(overflow / (readingHeight * 0.8));
    for (let step = 1; step <= steps; step++) {
      add(start + overflow * step / steps);
    }
  }
  add(maximum);
  return tops;
}

/** Choose the first stop in the requested direction, including after a manual scrollbar move. */
export function pageTarget(tops: readonly number[], scrollY: number, direction: -1 | 1): number {
  const candidates = direction === 1 ? tops : [...tops].reverse();
  return candidates.find(top => direction * (top - scrollY) > 1) ?? scrollY;
}

/** One wheel gesture includes its entire momentum tail, however long the animation takes. */
const WHEEL_IDLE_MS = 180;
const WHEEL_DISTANCE = 8;

export class HomeWheelGesture {
  private lastAt = -Infinity;
  private distance = 0;
  private consumed = false;

  direction(delta: number, now: number): -1 | 1 | null {
    if (now - this.lastAt > WHEEL_IDLE_MS) {
      this.distance = 0;
      this.consumed = false;
    }
    this.lastAt = now;
    this.distance += delta;
    if (this.consumed || Math.abs(this.distance) < WHEEL_DISTANCE) return null;
    this.consumed = true;
    return this.distance > 0 ? 1 : -1;
  }
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
