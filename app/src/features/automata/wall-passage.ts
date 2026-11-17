// The passage between the wall and a group's screen. A deck on the wall is a group folded up: its face
// is the automaton the group's stage plays, and the plates under it are the group's patches by level.
// Opening a group unfolds its deck, and Back folds it again: the browser moves each part from where it
// was to where it is (a view transition), because the two pages give the same part the same name.
// Only one deck carries the names at a time: the one being opened, or the one the reader returns to.

import type { AtlasBand } from "../../library/atlas-cloud";

/** The automaton: a deck's face on the wall, the stage's canvas on a group's screen. */
export const STAGE_PASSAGE = "automata-stage";

/** One level's four pictures: a deck's plate on the wall, the level's pictures on a group's screen. */
export function levelPassage(band: AtlasBand): string {
  return `automata-level-${band}`;
}

let opened: number | null = null;

/** The group whose screen is open, or was open last: its deck carries the names. */
export function rememberOpened(group: number): void {
  opened = group;
}

export function openedLast(): number | null {
  return opened;
}
