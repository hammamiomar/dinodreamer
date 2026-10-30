// The dock shows requests in recipe order, then the held token, then empty slots.
// Each request keeps its ink and block; clicking its slot selects it for the brush.

import { RECIPE_DEFAULTS, type Recipe } from "../../recipe";
import { defaultPair, termInk, type InkTable } from "./inks";
import type { Selection } from "./state";

export type DockSlot =
  | {
      kind: "request";
      requestId: number;
      block: number;
      /** The request's ink from the ink table (inks.ts), a picked colour included. */
      ink: string;
      /** The dock's brush paints this request. */
      selected: boolean;
      /** The block panel on show is this request's block. */
      onShow: boolean;
    }
  /** The held token: its block, the ink its request will get, and whether the brush is armed with it. */
  | { kind: "held"; block: number; ink: string; selected: boolean }
  | { kind: "empty" };

/** The requests in recipe order, then the held token, then empty slots up to the creation's limit. */
export function dockSlots(
  recipe: Recipe,
  heldBlock: number | null,
  selection: Selection | null,
  blockOnShow: number | null,
  inks: InkTable,
): DockSlot[] {
  const slots: DockSlot[] = recipe.requests.map((request) => ({
    kind: "request",
    requestId: request.id,
    block: request.block,
    ink: termInk(inks, request.id, "respond"),
    selected: selection?.kind === "term" && selection.requestId === request.id,
    onShow: request.block === blockOnShow,
  }));
  if (heldBlock !== null && slots.length < RECIPE_DEFAULTS.maxRequests) {
    slots.push({ kind: "held", block: heldBlock, ink: defaultPair(inks, slots.length).code, selected: selection?.kind === "held" });
  }
  while (slots.length < RECIPE_DEFAULTS.maxRequests) slots.push({ kind: "empty" });
  return slots;
}

/** The line under the slots: how many editing constraints the creation has, and how to add one, or that it is full. */
export function dockSlotsLine(slots: readonly DockSlot[]): string {
  const requests = slots.filter((slot) => slot.kind === "request").length;
  const count = `${requests} of ${RECIPE_DEFAULTS.maxRequests} constraints`;
  if (slots.some((slot) => slot.kind === "held")) return `${count} · paint on the image to place the new one`;
  if (slots.every((slot) => slot.kind === "request")) return `${count} · remove one on the image to add another`;
  return `${count} · send a reference patch from a basis group's page`;
}
