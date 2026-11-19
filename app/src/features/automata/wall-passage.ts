// View-transition coordination between the Automata group wall and an individual group screen.
// Only the group being opened or returned from carries `STAGE_PASSAGE` and `levelPassage` names.

import { useSyncExternalStore } from "react";
import type { AtlasBand } from "../../library/atlas-cloud";

export const STAGE_PASSAGE = "automata-stage";

export function levelPassage(band: AtlasBand): string {
  return `automata-level-${band}`;
}

let opened: number | null = null;
const listeners = new Set<() => void>();

/** Record the active or most recently opened basis group and notify subscribed wall views. */
export function rememberOpened(group: number): void {
  if (opened === group) return;
  opened = group;
  for (const listener of listeners) listener();
}

export function openedLast(): number | null {
  return opened;
}

/** Reactive read of the most recently opened basis group for view-transition tagging. */
export function useOpenedGroup(): number | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openedLast,
  );
}
