// Live-grid loop for set-based training methods. Set-method automata typically peak near
// steps 100-400 and can fade by 2,000, so the live grid runs from its start state to the
// loop end, holds that frame, and restarts from the same seed. Readings occur at the loop
// end so consecutive updates stay comparable. During training the end is LIVE_LOOP_STEPS;
// after training it uses the automaton's reading step (figure-recipe.ts readingStep).
// A brush stroke delays the restart so damage remains visible. Basis-group mean matching
// keeps a continuous live grid instead.

/** Step a set method's live grid advances to while training. */
export const LIVE_LOOP_STEPS = 400;
/**
 * Steps the live grid advances per training update during the loop (50 updates per cycle).
 * Using 16 steps added 5.1% wall time per update on an RTX 2080 Super (paired runs over
 * updates 50-300, 2026-11-17: 8 steps 237.2/252.4 ms vs 16 steps 254.9/259.8 ms), above
 * the 3% overhead limit.
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
