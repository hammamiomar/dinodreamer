// The live grid's loop for a set method (nara and the Train owner, 17 November 2026). A set method's
// automaton is worth seeing near steps 100 to 400 and can fade by 2,000, so its live grid does not grow
// on for thousands of steps: it starts from the live seed's start, grows to the loop's end, holds that
// picture, and starts again from the same noise. Each reading falls at the loop's end, so one compares
// with the next. During training the end is LIVE_LOOP_STEPS; after the run, the automaton's own reading
// step (figure-recipe.ts readingStep). A brush stroke postpones the restart, so a visitor sees what the
// damage does. Basis-group mean matching keeps its continuous live grid. The worker applies each turn.

/** The step a set method's live grid grows to while it trains: the research's peak is 100 to 400. */
export const LIVE_LOOP_STEPS = 400;
/**
 * Steps the live grid grows per training update in the loop: a loop of 50 updates, about 12 s on an RTX
 * 2080 Super. 16 would make it 25 updates, but cost 5.1 % of the time per update there (paired runs of
 * token distribution on group 12002 to update 300, wall time per update over updates 50 to 300: 8 steps
 * 237.2 and 252.4 ms, 16 steps 254.9 and 259.8 ms, 17 November 2026), above the 3 % that would allow it.
 */
export const LIVE_LOOP_STEPS_PER_UPDATE = 8;
/** How long the loop's end picture holds before the grid starts again, and how long a brush stroke postpones that. */
export const LIVE_HOLD_MS = 1500;

/** What the live grid does on one turn: grow (and read when the turn reaches the loop's end), hold the picture, or start again. */
export type LoopTurn =
  | { kind: "grow"; steps: number; reachesEnd: boolean }
  | { kind: "hold" }
  | { kind: "restart" };

/**
 * One turn of the loop. `tick`: the grid's step now; `end`: the loop's end; `steps`: the most it grows in
 * a turn; `heldSince`: when the hold began (null before the end is reached); `lastStroke`: the time of the
 * latest brush stamp, or null. The grid restarts once the hold and the latest stroke are both LIVE_HOLD_MS old.
 */
export function loopTurn(tick: number, end: number, steps: number, heldSince: number | null, lastStroke: number | null, now: number): LoopTurn {
  if (tick < end) {
    const grow = Math.min(steps, end - tick);
    return { kind: "grow", steps: grow, reachesEnd: tick + grow === end };
  }
  const quietSince = Math.max(heldSince ?? now, lastStroke ?? Number.NEGATIVE_INFINITY);
  return now - quietSince >= LIVE_HOLD_MS ? { kind: "restart" } : { kind: "hold" };
}
