// The library's six token roles and how they map to the recipe's tokens.
//
// The library (web/v2) names each storage slot as its own role: "storage0" …
// "storage3". The recipe has one "storage" role and tells the four apart by slot.
// Slot order is native: 0 CLS, 1–4 storage, 5–260 the 16 × 16 patch grid.

import { PATCH_SLOT_OFFSET, TOKEN_SLOTS } from "../recipe";
import type { Token } from "../recipe";
import { slotRole } from "../recipe-parse";

export const LIBRARY_ROLES = ["patch", "cls", "storage0", "storage1", "storage2", "storage3"] as const;
export type LibraryRole = (typeof LIBRARY_ROLES)[number];

/** The prefix roles in slot order: slot = index. */
export const PREFIX_ROLES = ["cls", "storage0", "storage1", "storage2", "storage3"] as const;
export type PrefixRole = (typeof PREFIX_ROLES)[number];

export const ROLE_LABELS: Record<LibraryRole, string> = {
  patch: "Patches",
  cls: "CLS",
  storage0: "Storage 0",
  storage1: "Storage 1",
  storage2: "Storage 2",
  storage3: "Storage 3",
};

/** For tight controls; zero-based like the full names. */
export const ROLE_SHORT_LABELS: Record<LibraryRole, string> = {
  patch: "Patches",
  cls: "CLS",
  storage0: "S0",
  storage1: "S1",
  storage2: "S2",
  storage3: "S3",
};

export function isLibraryRole(value: unknown): value is LibraryRole {
  return (LIBRARY_ROLES as readonly unknown[]).includes(value);
}

/** The native slot of a library role; a patch needs its grid position (0–255). */
export function librarySlot(role: LibraryRole, position: number | null): number {
  if (role === "patch") {
    if (position === null || !Number.isInteger(position) || position < 0 || position >= TOKEN_SLOTS - PATCH_SLOT_OFFSET) {
      throw new Error(`a patch token needs a grid position, got ${position}`);
    }
    return PATCH_SLOT_OFFSET + position;
  }
  return PREFIX_ROLES.indexOf(role);
}

/** The library role of a native slot: storage slots keep their index. */
export function slotLibraryRole(slot: number): LibraryRole {
  return slot < PATCH_SLOT_OFFSET ? PREFIX_ROLES[slot]! : "patch";
}

export function libraryToken(imageId: number, role: LibraryRole, position: number | null): Token {
  const slot = librarySlot(role, position);
  return { imageId, role: slotRole(slot), slot };
}

/** "patch (3, 12)", "CLS token" or "Storage 2 token". */
export function tokenLabel(slot: number): string {
  if (slot >= PATCH_SLOT_OFFSET) {
    const position = slot - PATCH_SLOT_OFFSET;
    return `patch (${Math.floor(position / 16)}, ${position % 16})`;
  }
  return `${ROLE_LABELS[slotLibraryRole(slot)]} token`;
}
