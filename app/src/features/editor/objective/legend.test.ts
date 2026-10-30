import { NO_INK_CHOICES, inkTable } from "../inks";
import { defaultInkPairs } from "../presentation";
import { describe, expect, it } from "vitest";
import { patchSlot, type Recipe, type Token } from "../../../recipe";
import { createRecipe, createRequest } from "../model";
import { createRunState } from "../run/session";
import { detailCaption, minimapLegend } from "./legend";
import { objectiveRows } from "./rows";

/** The default tones of a recipe's requests (inks.ts), as the editor session builds them with no picks. */
const inksOf = (recipe: Recipe) => inkTable(recipe, NO_INK_CHOICES, () => true, defaultInkPairs());

const handoff = (token: Token, block = 1398) => ({ token, block, code: [0.4, -0.2, 0.9] as [number, number, number] });
const patch: Token = { imageId: 7, role: "patch", slot: patchSlot(2, 8) };
const cls: Token = { imageId: 9, role: "cls", slot: 0 };
const storage: Token = { imageId: 11, role: "storage", slot: 2 };

describe("minimapLegend", () => {
  it("names one cell's code and the token's code for patch requests", () => {
    const recipe = createRequest(createRecipe("pass-003"), handoff(patch));
    const rows = objectiveRows(recipe, createRunState(), inksOf(recipe));
    expect(minimapLegend(rows)).toBe("● one cell's response vector · ◯ the token's response vector");
  });

  it("names the image's own token for CLS and storage constraints, once each", () => {
    let recipe = createRequest(createRecipe("pass-003"), handoff(patch));
    recipe = createRequest(recipe, handoff(cls, 3));
    recipe = createRequest(recipe, handoff(storage, 4));
    recipe = createRequest(recipe, handoff({ ...cls, imageId: 10 }, 5));
    const rows = objectiveRows(recipe, createRunState(), inksOf(recipe));
    expect(minimapLegend(rows)).toBe("● one cell's response vector · ● the CLS token's response vector · ● the Storage 1 token's response vector · ◯ the token's response vector");
  });
});

describe("detailCaption", () => {
  it("says what the dots are for a patch request and for a prefix request", () => {
    const [patchRequest] = createRequest(createRecipe("pass-003"), handoff(patch)).requests;
    expect(detailCaption(patchRequest, true)).toBe(
      "each dot is one painted cell's response vector in basis group 1398; the ring is the token's response vector; the distance is the root mean square of the dots' distances to it",
    );
    const [clsRequest] = createRequest(createRecipe("pass-003"), handoff(cls, 3)).requests;
    expect(detailCaption(clsRequest, false)).toContain("the dot is the image's CLS token's response vector in basis group 3");
  });
});
