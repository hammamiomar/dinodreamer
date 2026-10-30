import { describe, expect, it } from "vitest";
import { CO_SELECTED_SHOWN, coSelection } from "./co-selection";

/** Columns as figure_reading returns them, in the engine's order (share, then group id): group, patches, joint, position sum. */
function columns(rows: [number, number, number, number][], readPatches = 64) {
  return {
    coSelectedGroups: Uint16Array.from(rows.map(([group]) => group)),
    coSelectedPatches: Uint16Array.from(rows.map(([, patches]) => patches)),
    coSelectedJoint: Uint16Array.from(rows.map(([, , joint]) => joint)),
    coSelectedPositionSum: Uint16Array.from(rows.map(([, , , positionSum]) => positionSum)),
    readPatches,
  };
}

describe("the co-selected basis groups", () => {
  // A tick-600 readout of a pool-64 automaton of 12002: eleven groups selected on all 64 patches,
  // the requested group on 63. The position sums are invented: each group at one position on every patch.
  const rows: [number, number, number, number][] = [
    [3, 64, 63, 64 * 5], [5, 64, 63, 64 * 1], [7, 64, 63, 64 * 3], [9, 64, 63, 64 * 2], [11, 64, 63, 64 * 8], [13, 64, 63, 64 * 4],
    [15, 64, 63, 64 * 6], [17, 64, 63, 64 * 9], [639, 64, 63, 64 * 7], [820, 64, 63, 64 * 10], [1456, 64, 63, 64 * 11],
    [12002, 63, 63, 63 * 12], [4000, 2, 1, 40],
  ];

  it("lists the first eight by share, then by mean position", () => {
    const list = coSelection(columns(rows), 12002);
    expect(list.top).toHaveLength(CO_SELECTED_SHOWN);
    expect(list.top.map((entry) => entry.group)).toEqual([5, 9, 7, 13, 3, 15, 639, 11]);
    expect(list.top[0]).toEqual({ group: 5, patches: 64, joint: 63, positionSum: 64 });
    expect(list.top.map((entry) => entry.positionSum / entry.patches)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("orders groups of the same share and position by group id, and a smaller share after a larger one whatever its position", () => {
    const tied: [number, number, number, number][] = [[820, 64, 64, 64], [639, 64, 64, 64], [12002, 64, 64, 64], [4000, 3, 3, 3]];
    expect(coSelection(columns(tied), 12002).top.map((entry) => entry.group)).toEqual([639, 820, 12002, 4000]);
  });

  it("gives the requested group's rank in that order, shared by groups of the same share and position, or none when no read patch selects it", () => {
    expect(coSelection(columns(rows), 12002).requested).toEqual({ group: 12002, rank: 12, patches: 63, positionSum: 63 * 12 });
    const tied: [number, number, number, number][] = [[639, 64, 64, 64], [785, 64, 64, 64], [820, 64, 64, 64], [12002, 64, 64, 64], [4000, 3, 3, 3]];
    expect(coSelection(columns(tied), 12002).requested).toEqual({ group: 12002, rank: 1, patches: 64, positionSum: 64 });
    // Selected on every patch like 639, but nearer the top of each patch's 32: before it.
    const nearer = coSelection(columns([[639, 64, 64, 128], [12002, 64, 64, 64]]), 12002);
    expect([nearer.top.map((entry) => entry.group), nearer.requested.rank]).toEqual([[12002, 639], 1]);
    expect(coSelection(columns(rows.filter(([group]) => group !== 12002)), 12002).requested).toEqual({ group: 12002, rank: null, patches: 0, positionSum: 0 });
  });

  it("keeps the read patches of the central start", () => {
    expect(coSelection(columns([[12002, 16, 16, 16]], 16), 12002)).toEqual({
      readPatches: 16, top: [{ group: 12002, patches: 16, joint: 16, positionSum: 16 }], requested: { group: 12002, rank: 1, patches: 16, positionSum: 16 },
    });
  });
});
