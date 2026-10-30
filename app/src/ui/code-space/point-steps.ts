// Arrow keys step through a focused code space's points; the stepped point is ringed and read
// aloud. Enter chooses it, and Space moves a draggable ring onto it. The 3-D and flat views
// share these controls.

import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SpacePoint } from "./code-space-3d";

/** The point an arrow key moves to: the next or previous one, wrapping; the first or last from none. */
export function stepPoint(current: number | null, count: number, step: 1 | -1): number | null {
  if (count === 0) return null;
  if (current === null) return step === 1 ? 0 : count - 1;
  return (((current + step) % count) + count) % count;
}

const STEP_KEYS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** What the live region says when the draggable ring moves to a point without a drag (Space, Random token). */
export function ringIsOn(point: SpacePoint): string {
  return `The ring is on ${point.label}.`;
}

/** What the keys do with a stepped point, as the live region says it. */
export function stepKeys(choose: boolean, place: boolean): string {
  if (choose && place) return "Enter chooses it; Space moves the ring to it.";
  if (place) return "Space moves the ring to it.";
  return "Enter chooses it.";
}

export interface PointSteps {
  /** The stepped point's index, or null. */
  stepped: number | null;
  /** Handles the step, choose and place keys; true when it handled the event. Shift + arrow is left to the caller. */
  onKey: (event: KeyboardEvent) => boolean;
  /** Forgets the stepped point, when the map loses focus. */
  clear: () => void;
  /** What a screen reader says about the stepped point, or about the ring Space just moved. */
  announcement: string;
}

/**
 * `onSelect` chooses a point (Enter, and Space without `onPlace`); `onPlace` moves the map's
 * draggable ring to it (Space). With neither, the keys are not this hook's.
 */
export function usePointSteps(
  points: readonly SpacePoint[],
  onSelect: ((key: string) => void) | undefined,
  onPlace?: (key: string) => void,
): PointSteps {
  const [stepped, setStepped] = useState<number | null>(null);
  // The point Space moved the ring to, until the next step.
  const [placed, setPlaced] = useState<SpacePoint | null>(null);
  // A new set of points has its own order.
  useEffect(() => {
    setStepped(null);
    setPlaced(null);
  }, [points]);
  const onKey = (event: KeyboardEvent): boolean => {
    if ((!onSelect && !onPlace) || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    const step = STEP_KEYS[event.key];
    if (step !== undefined) {
      setStepped((current) => stepPoint(current, points.length, step));
      setPlaced(null);
      return true;
    }
    const point = stepped === null ? undefined : points[stepped];
    if (!point) return false;
    if (event.key === " " && onPlace) {
      onPlace(point.key);
      setPlaced(point);
      return true;
    }
    if ((event.key === "Enter" || event.key === " ") && onSelect) {
      onSelect(point.key);
      return true;
    }
    return false;
  };
  const point = stepped === null ? null : points[stepped];
  let announcement = "";
  if (placed) announcement = ringIsOn(placed);
  else if (point) announcement = `${point.label}. ${stepped! + 1} of ${points.length}. ${stepKeys(onSelect !== undefined, onPlace !== undefined)}`;
  const clear = () => {
    setStepped(null);
    setPlaced(null);
  };
  return { stepped, onKey, clear, announcement };
}
