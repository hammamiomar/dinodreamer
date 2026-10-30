// Each cell represents one of the picture's 8 × 8 patches, lit when the requested basis group
// is among the 32 selected. Readings count all 64 patches, or the central 4 × 4 for a central start.

import { FIRES } from "../materials/material-file";

/** Patches along a side of the read grid: the 128-cell picture is read as 8 × 8 patches of 16 cells. */
export const MAP_SIDE = 8;
export const MAP_PATCHES = MAP_SIDE * MAP_SIDE;

/** The read region: every patch, or the central 4 × 4 (rows and columns 2 to 5), as the engine's CENTRE_PATCHES. */
export type ReadRegion = "centre-4x4" | undefined;

export function readPatchIndices(region: ReadRegion): number[] {
  const all = Array.from({ length: MAP_PATCHES }, (_, index) => index);
  if (!region) return all;
  return all.filter((index) => [index % MAP_SIDE, Math.floor(index / MAP_SIDE)].every((place) => place >= 2 && place <= 5));
}

/** How many read patches must select the group for the selection target: the fraction FIRES, rounded up (58 of 64, 15 of 16). */
export function neededPatches(readPatches: number): number {
  return Math.ceil(FIRES * readPatches);
}

/** A cell of the map: outside the read region, read and not selected, or read and selected. */
export type MapCell = "unread" | "off" | "on";

/** The 64 cells of the map; without a reading, the read region is drawn unselected. */
export function mapCells(selected: Uint8Array | null, region: ReadRegion): MapCell[] {
  const read = new Set(readPatchIndices(region));
  return Array.from({ length: MAP_PATCHES }, (_, index) => {
    if (!read.has(index)) return "unread";
    return selected && selected[index] === 1 ? "on" : "off";
  });
}

/** The lit cells of the read region: the selection fraction as a count. */
export function selectedCount(selected: Uint8Array, region: ReadRegion): number {
  return readPatchIndices(region).filter((index) => selected[index] === 1).length;
}
