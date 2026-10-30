import { describe, expect, it } from "vitest";
import { CELLS, patchSlot, type Token } from "../../../recipe";
import { applyAreaStroke, createRecipe, createRequest, removeReference, setTermEnabled } from "../model";
import { termProblem } from "./status";

const token: Token = { imageId: 7, role: "patch", slot: patchSlot(2, 8) };
const recipe = createRequest(createRecipe("pass-003"), { token, block: 1398, code: [0.4, -0.2, 0.9] });

describe("termProblem", () => {
  it("names an active area term with nothing painted, and nothing for a term that is off", () => {
    const erased = applyAreaStroke(recipe, 1, "look", { mode: "erase", cells: new Array<number>(CELLS).fill(100) });
    expect(termProblem(erased, "request:1:look")).toBe("no area painted");
    expect(termProblem(setTermEnabled(erased, "request:1:look", false), "request:1:look")).toBeNull();
    expect(termProblem(recipe, "request:1:respond")).toBeNull();
  });

  it("names an Appearance term without pictures", () => {
    expect(termProblem(removeReference(recipe, 1, 7), "request:1:look")).toBe("no reference picture");
  });

  it("has nothing to say about a CLS request's Code, which has no area", () => {
    const cls = createRequest(createRecipe("pass-003"), { token: { imageId: 9, role: "cls", slot: 0 }, block: 3, code: [1, 0, 0] });
    expect(termProblem(cls, "request:1:respond")).toBeNull();
  });
});
