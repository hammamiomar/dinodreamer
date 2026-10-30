import { describe, expect, it } from "vitest";
import { patchSlot, type Recipe } from "../../recipe";
import { dockSlots as slotsOf, dockSlotsLine } from "./dock-slots";
import { NO_INK_CHOICES, inkTable, type InkChoices } from "./inks";
import { createRecipe, createRequest } from "./model";
import { defaultInkPairs } from "./presentation";

/** The palette's inks by position (styles.css --paint-N). */
const INK = defaultInkPairs().map((pair) => pair.code);
/** The dock's slots with the creation's ink table, as the dock builds them. */
const dockSlots = (recipe: Recipe, heldBlock: number | null, selection: Parameters<typeof slotsOf>[2], blockOnShow: number | null, choices: InkChoices = NO_INK_CHOICES) =>
  slotsOf(recipe, heldBlock, selection, blockOnShow, inkTable(recipe, choices, () => true, defaultInkPairs()));

function withBlocks(...blocks: number[]): Recipe {
  return blocks.reduce(
    (recipe, block, index) =>
      createRequest(recipe, { token: { imageId: 7, role: "patch", slot: patchSlot(2, index) }, block, code: [0.4, -0.2, 0.9] }),
    createRecipe("pass-003"),
  );
}

describe("the dock's request slots", () => {
  it("show the requests in recipe order with their inks, then room up to four", () => {
    const recipe = withBlocks(9023, 7656);
    const slots = dockSlots(recipe, null, null, null);
    expect(slots.map((slot) => slot.kind)).toEqual(["request", "request", "empty", "empty"]);
    expect(slots.slice(0, 2)).toMatchObject([
      { block: 9023, ink: INK[0], selected: false },
      { block: 7656, ink: INK[1], selected: false },
    ]);
    expect(dockSlotsLine(slots)).toBe("2 of 4 constraints · send a reference patch from a basis group's page");
  });

  it("mark the request the dock's brush paints, and the block on show", () => {
    const recipe = withBlocks(9023, 7656);
    const second = recipe.requests[1]!.id;
    const slots = dockSlots(recipe, null, { kind: "term", requestId: second, term: "look" }, 9023);
    expect(slots.slice(0, 2)).toMatchObject([
      { block: 9023, selected: false, onShow: true },
      { block: 7656, selected: true, onShow: false },
    ]);
    // Protect or Noise selected in Create: no request is the brush's.
    expect(dockSlots(recipe, null, { kind: "protect" }, null).some((slot) => slot.kind === "request" && slot.selected)).toBe(false);
  });

  it("show the held token after the requests, in the ink its request will get, and say how to place it", () => {
    const slots = dockSlots(withBlocks(9023), 7656, { kind: "held" }, null);
    expect(slots).toEqual([
      expect.objectContaining({ kind: "request", ink: INK[0], selected: false }),
      { kind: "held", block: 7656, ink: INK[1], selected: true },
      { kind: "empty" },
      { kind: "empty" },
    ]);
    expect(dockSlotsLine(slots)).toBe("1 of 4 constraints · paint on the image to place the new one");
    expect(dockSlots(withBlocks(9023), 7656, null, null)[1]).toEqual({ kind: "held", block: 7656, ink: INK[1], selected: false });
  });

  it("show a request's picked colour in its slot, and the palette's for the held token", () => {
    const recipe = withBlocks(9023);
    const [slot, held] = dockSlots(recipe, 7656, null, null, { 1: { code: "#ff0000" } });
    expect(slot).toMatchObject({ kind: "request", ink: "#ff0000" });
    expect(held).toMatchObject({ kind: "held", ink: INK[1] });
  });

  it("say so when the creation is full", () => {
    const slots = dockSlots(withBlocks(1, 2, 3, 4), null, null, null);
    expect(slots.every((slot) => slot.kind === "request")).toBe(true);
    expect(dockSlotsLine(slots)).toBe("4 of 4 constraints · remove one on the image to add another");
  });
});
