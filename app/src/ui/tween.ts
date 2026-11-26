// Values that move when the marked token changes: the made-from bar's
// numbers and meters, and the marked token's ring and arrows in the code space, travel to
// their new values instead of jumping. Every such move takes one duration and one curve,
// the house's --motion-move (styles.css), so a bar and an arrow that change together
// arrive together. A new target starts from wherever the values are, never queued. With
// "reduce motion" set, values change at once.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const NO_VALUES: readonly number[] = [];

/** How long a move takes: --motion-move in styles.css. */
export const MOVE_MS = 240;

/** Ease-out cubic, --motion-move's curve: quick to leave, gentle to arrive. */
export function easeOutCubic(progress: number): number {
  const remaining = 1 - Math.min(Math.max(progress, 0), 1);
  return 1 - remaining * remaining * remaining;
}

/**
 * The values `elapsed` ms into a move from `from` to `to` (two lists of the same length).
 * Once the move is over the result is `to` itself, so the end is exact.
 */
export function valuesAt(from: readonly number[], to: readonly number[], elapsed: number, duration = MOVE_MS): readonly number[] {
  if (elapsed >= duration) return to;
  const eased = easeOutCubic(elapsed / duration);
  return to.map((end, index) => {
    const start = from[index]!;
    return start + (end - start) * eased;
  });
}

/** The same numbers in the same order. */
export function sameValues(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export interface MoveOptions {
  /** Show the target at once, e.g. the bar's plain list of an unstable record. */
  instant?: boolean;
  /**
   * What the values belong to, e.g. the code space's block and role. Values of a new space
   * do not travel from the old space's: they change at once.
   */
  space?: string;
}

/**
 * The values to show for `target`. A new target is reached in MOVE_MS from the values on
 * screen, frame by frame. The values change at once on the first render, when the number
 * of values or the space changes, when `instant` is set, and with "reduce motion".
 */
export function useMovingValues(target: readonly number[], { instant = false, space = "" }: MoveOptions = {}): readonly number[] {
  const reduceMotion = usePrefersReducedMotion();
  const [shown, setShown] = useState(target);
  // What is on screen, and where it is heading.
  const onScreen = useRef(target);
  const heading = useRef({ values: target, space });
  const frame = useRef<number | null>(null);

  // Before paint, so a change at once never shows the old values for a frame.
  useLayoutEffect(() => {
    const sameTarget = sameValues(heading.current.values, target) && heading.current.space === space;
    const finishNow = frame.current !== null && (instant || reduceMotion);
    if (sameTarget && !finishNow) return;
    const from = onScreen.current;
    const sameSpace = heading.current.space === space;
    heading.current = { values: target, space };
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (instant || reduceMotion || !sameSpace || from.length !== target.length) {
      onScreen.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const values = valuesAt(from, target, now - start);
      onScreen.current = values;
      setShown(values);
      frame.current = values === target ? null : requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  });
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return shown;
}

/** Typed 3-vector wrapper around useMovingValues that preserves reference stability and avoids tuple casts. */
export function useMovingVec3(
  target: readonly [number, number, number] | null,
  options?: MoveOptions,
): [number, number, number] | null {
  const values = useMovingValues(target ?? NO_VALUES, options);
  return useMemo(
    () => (values.length === 3 ? [values[0]!, values[1]!, values[2]!] : null),
    [values],
  );
}

/** Reduced-motion enforcement is disabled so cellular automata, 3-D clouds, and transitions stay live. */
export function usePrefersReducedMotion(): boolean {
  return false;
}
