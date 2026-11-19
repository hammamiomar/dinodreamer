// The live automaton (home-material-view.tsx): which automata the entrance shows, their pace, how
// the kind is said, when it regrows, and how one replay fills a field as a torus repeated. Pure
// rules, so the player only applies them.

import { fill, SITE_WORDS } from "../../app/site-words";
import { FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import { RULE_CHOICES } from "../../grow/material-kind";
import type { MaterialEntry } from "../gallery/material-index";

/**
 * The replay regrows from the next seed at this tick, about 33 s at the default 60 ticks a second
 * (home-material-view.tsx): a figure that has dissolved comes back as growth, and growth is the part
 * worth watching. A page with its own reset passes Infinity instead and never regrows by itself.
 */
export const REGROW_AT_TICK = 2000;

/**
 * The home's replays step by time at the essay's pace, 60 ticks a second (replay-loop.ts,
 * stepsPerSecond), so a 60, 120 or 144 Hz screen shows the same growth. One tick per drawn frame
 * would run twice as fast on a 120 Hz screen.
 */
export const HOME_TICKS_PER_SECOND = 60;

/**
 * The entrance's automata: the opening of the essay on computervision.vision
 * (src/pages/essays/dinodreamer.mdx, OpeningAutomaton), all from noise. Each visit shuffles the list
 * once (shuffled), as the essay reshuffles each round, and the arrows go through that order. Three
 * did not meet their selection target; they stay.
 */
export const ENTRANCE_AUTOMATA: readonly string[] = [
  "2088-guided-all-noise-seed-0",
  "2632-guided-release-floor-0p5-all-noise-seed-0",
  "12002-given-set-pole-3x3-noise-projection-mmd-layers-final-seed-0",
  "12240-plain-all-noise-seed-0",
  "12299-plain-all-noise-seed-0",
  "block-13345-stage-6-pyramid-strongest-seed-1",
  "13364-given-set-pole-3x3-noise-projection-mmd-layers-final-seed-0",
  "16250-guided-release-floor-1-all-noise-seed-1",
  "2801-plain-all-noise-seed-0",
  "3907-plain-all-noise-seed-1",
  "4364-plain-all-noise-seed-0",
  "6448-given-set-t13-companions-pole-3x3-noise-plain-seed-1",
  "6496-given-set-t13-companions-pole-3x3-noise-plain-seed-1",
  "6793-given-set-t13-companions-pole-3x3-noise-plain-seed-1",
  "7178-guided-cell-rule-all-noise-seed-1",
  "9275-given-set-t13-companions-pole-3x3-noise-plain-seed-0",
  "12956-guided-all-noise-seed-0",
  "13633-guided-release-floor-0p5-all-noise-seed-1",
];

/** `ids` in a random order (Fisher–Yates), from `random` values in [0, 1). */
export function shuffled(ids: readonly string[], random: () => number): string[] {
  const order = [...ids];
  for (let last = order.length - 1; last > 0; last--) {
    const pick = Math.floor(random() * (last + 1));
    [order[last], order[pick]] = [order[pick]!, order[last]!];
  }
  return order;
}

/** The entrance's automata that the published index holds, in the order of `ids`; an id it lacks is left out. */
export function entrancePool(entries: readonly MaterialEntry[], ids: readonly string[] = ENTRANCE_AUTOMATA): MaterialEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return ids.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
}

/** The replay draws at most this many canvas pixels per cell (figure-replay.ts, checkScale). */
const MOST_PIXELS_PER_CELL = 8;

/** "fine automaton, from a noise disc": the grids in the Train page's words, then the start (site-words.ts, home.kind). */
export function kindWords(entry: Pick<MaterialEntry, "layout" | "start" | "pixelsPerCell">): string {
  const words = SITE_WORDS.home;
  const rule = RULE_CHOICES.find((choice) => choice.value === (entry.layout === FIGURE_PYRAMID_LAYOUT ? "pyramid" : "cell"))!.label.toLowerCase();
  const pixels = entry.pixelsPerCell === 2 ? words.kindTwoPixels : "";
  const start = entry.start === "centre-disc" ? words.kindSeed : words.kindNoise;
  return fill(words.kind, { rule, pixels, start });
}

/** The seed after `seed`, within the unsigned 32-bit range the replay accepts. */
export function nextSeed(seed: number): number {
  return (seed + 1) % 0x100000000;
}

/**
 * The tiled canvas for a field of `width` × `height` CSS pixels at `cellPixels` CSS pixels per
 * cell: its size in device pixels, and whole device pixels per cell (the replay's scale), so every
 * cell is the same size on the screen. The scale is held to the replay's 1 to 8.
 */
export function tiledCanvas(width: number, height: number, cellPixels: number, devicePixelRatio: number): { width: number; height: number; scale: number } {
  return {
    width: Math.max(1, Math.round(width * devicePixelRatio)),
    height: Math.max(1, Math.round(height * devicePixelRatio)),
    scale: Math.min(MOST_PIXELS_PER_CELL, Math.max(1, Math.round(cellPixels * devicePixelRatio))),
  };
}

/**
 * One brush segment on the tiled field, in cells: the pointer's two places unwrapped (`side` cells a
 * tile), shifted together by whole tiles so the first lies on the grid. The brush (figure-shaders.ts,
 * damage) measures distance on the torus for a centre on the grid or just past its edge, which a
 * short pointer move gives; wrapping each end apart would draw a stroke across the whole grid.
 */
export function strokeOnTorus(from: { x: number; y: number }, to: { x: number; y: number }, side: number): { x0: number; y0: number; x1: number; y1: number } {
  const shiftX = Math.floor(from.x / side) * side;
  const shiftY = Math.floor(from.y / side) * side;
  return { x0: from.x - shiftX, y0: from.y - shiftY, x1: to.x - shiftX, y1: to.y - shiftY };
}
