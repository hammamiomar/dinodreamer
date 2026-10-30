// The engine counts selected patches, joint selections with the requested group, and rank sums
// for each group. The panel sorts by patch share, then mean rank, then group id. Mean rank breaks
// the ties when a uniform texture selects the same groups on every patch.

/** Groups the Train panel lists. */
export const CO_SELECTED_SHOWN = 8;

export interface CoSelectedGroup {
  group: number;
  /** Read patches on which the group is among the 32 selected. */
  patches: number;
  /** Read patches on which it and the requested group are both selected. */
  joint: number;
  /** The sum over its patches of its position among the 32 selected, 1 for the patch's largest squared response. */
  positionSum: number;
}

export interface CoSelection {
  /** The read patches: 64, or 16 for the central start. Shares are counts over this. */
  readPatches: number;
  /** The first CO_SELECTED_SHOWN groups in the panel's order: by share, then by mean position, then by group id. */
  top: CoSelectedGroup[];
  /**
   * The requested group: its rank, one more than the groups before it in that order, so groups of the
   * same share and position share a rank, or null when no read patch selects it.
   */
  requested: { group: number; rank: number | null; patches: number; positionSum: number };
}

/** The engine's four parallel columns (figure_reading), in the engine's order. */
export interface CoSelectedColumns {
  coSelectedGroups: Uint16Array;
  coSelectedPatches: Uint16Array;
  coSelectedJoint: Uint16Array;
  coSelectedPositionSum: Uint16Array;
  readPatches: number;
}

/** Negative when `a` comes before `b`: a larger share, then a smaller mean position (the same share, so the sums compare), then a lower group id. */
function panelOrder(a: CoSelectedGroup, b: CoSelectedGroup): number {
  if (a.patches !== b.patches) return b.patches - a.patches;
  if (a.positionSum !== b.positionSum) return a.positionSum - b.positionSum;
  return a.group - b.group;
}

/** The panel's list from the engine's columns: the first groups in the panel's order and the requested group's place. */
export function coSelection(columns: CoSelectedColumns, requested: number): CoSelection {
  const { coSelectedGroups: groups, coSelectedPatches: patches, coSelectedJoint: joint, coSelectedPositionSum: positionSums } = columns;
  const all: CoSelectedGroup[] = Array.from(groups, (group, index) => ({
    group, patches: patches[index]!, joint: joint[index]!, positionSum: positionSums[index]!,
  }));
  all.sort(panelOrder);
  const top = all.slice(0, CO_SELECTED_SHOWN);
  const own = all.find((entry) => entry.group === requested);
  if (!own) return { readPatches: columns.readPatches, top, requested: { group: requested, rank: null, patches: 0, positionSum: 0 } };
  const before = all.filter((entry) => entry.patches > own.patches || (entry.patches === own.patches && entry.positionSum < own.positionSum)).length;
  return { readPatches: columns.readPatches, top, requested: { group: requested, rank: before + 1, patches: own.patches, positionSum: own.positionSum } };
}
