import { NO_INK_CHOICES, inkTable, termInk } from "../inks";
import { defaultInkPairs } from "../presentation";
import { describe, expect, it } from "vitest";
import { RECIPE_DEFAULTS, patchSlot, type Recipe, type Token } from "../../../recipe";
import { createRecipe, createRequest, removeRequest, setTermEnabled, setTermWeight } from "../model";

import { createRunState, type RunState } from "../run/session";
import { measuredCodes, objectiveRows, objectiveTotal } from "./rows";

/** The default tones of a recipe's requests (inks.ts), as the editor session builds them with no picks. */
const inksOf = (recipe: Recipe) => inkTable(recipe, NO_INK_CHOICES, () => true, defaultInkPairs());

const patch = (imageId: number, row: number, column: number): Token => ({ imageId, role: "patch", slot: patchSlot(row, column) });
const handoff = (token: Token, block = 1398, code: [number, number, number] = [0.4, -0.2, 0.9]) => ({ token, block, code });

function twoRequests(): Recipe {
  const one = createRequest(createRecipe("pass-003"), handoff(patch(7, 2, 8), 1398));
  return createRequest(one, handoff(patch(8, 10, 10), 77, [1, 0, 0]));
}

/** A session that applied `recipe` as revision 3 and measured the image at step 12. */
function measuredSession(recipe: Recipe, revision = 3): RunState {
  const codes = new Float32Array([0.5, -0.1, 0.8, 0.3, -0.3, 1.0]);
  return {
    ...createRunState(),
    applied: { revision, recipe, step: 0, resetAdam: false, rebased: false },
    measurement: {
      revision,
      step: 12,
      terms: [
        { id: "request:1:respond", raw: 0.01, weighted: 0.003 },
        { id: "request:1:look", raw: 0.2, weighted: 0.2 },
        { id: "request:2:respond", raw: 0.02, weighted: 0.006 },
        { id: "request:2:look", raw: 0.25, weighted: 0.25 },
      ],
      codes: [{ requestId: 1, slots: new Uint16Array([patchSlot(2, 8), patchSlot(2, 9)]), codes, errors: new Float32Array([0.02, 0.05]) }],
      pixels: new Uint8ClampedArray(4),
      receivedAt: 0,
    },
  };
}

describe("objectiveRows", () => {
  it("lists the active terms in recipe order with their scope, ink and weight", () => {
    const recipe = twoRequests();
    const rows = objectiveRows(recipe, createRunState(), inksOf(recipe));
    expect(rows.map((row) => [row.termId, row.name, row.scope])).toEqual([
      ["request:1:respond", "Response", "basis group 1398"],
      ["request:1:look", "Appearance", undefined],
      ["request:2:respond", "Response", "basis group 77"],
      ["request:2:look", "Appearance", undefined],
    ]);
    expect(rows[0].ink).toBe(termInk(inksOf(recipe), 1, "respond"));
    expect(rows[2].ink).toBe(termInk(inksOf(recipe), 2, "respond"));
    expect(rows[0].weight).toBe(RECIPE_DEFAULTS.respondLikeWeight);
    expect(rows[0].area).toEqual({ kind: "term", requestId: 1, term: "respond" });
    expect(rows[0].select).toEqual(rows[0].area);
  });

  it("gives a CLS request's Code row no area but a selection, and a prefix minimap", () => {
    const recipe = createRequest(createRecipe("pass-003"), handoff({ imageId: 9, role: "cls", slot: 0 }, 3));
    const [row] = objectiveRows(recipe, createRunState(), inksOf(recipe));
    expect(row.area).toBeNull();
    expect(row.select).toEqual({ kind: "term", requestId: 1, term: "respond" });
    expect(row.minimap).toMatchObject({ kind: "prefix", tokenLabel: "CLS token" });
  });

  it("adds a row for a term switched on later and for a request added later, as the applied recipe goes on", () => {
    // A creation that starts with its Code terms only, as "doggy ear" does.
    let recipe = setTermEnabled(setTermEnabled(twoRequests(), "request:1:look", false), "request:2:look", false);
    const session = measuredSession(recipe);
    expect(objectiveRows(recipe, session, inksOf(recipe)).map((row) => row.termId)).toEqual(["request:1:respond", "request:2:respond"]);
    recipe = setTermEnabled(recipe, "request:1:look", true);
    recipe = createRequest(recipe, handoff(patch(9, 4, 4), 12));
    const rows = objectiveRows(recipe, session, inksOf(recipe));
    expect(rows.map((row) => row.termId)).toEqual(["request:1:respond", "request:1:look", "request:2:respond", "request:3:respond", "request:3:look"]);
    // Not applied yet: pending, with no value until the worker measures them.
    expect(rows.filter((row) => row.pending).map((row) => row.termId)).toEqual(["request:1:look", "request:3:respond", "request:3:look"]);
  });

  it("leaves out switched-off terms and terms with weight zero", () => {
    let recipe = twoRequests();
    recipe = setTermEnabled(recipe, "request:1:look", false);
    recipe = setTermWeight(recipe, "request:2:respond", 0);
    expect(objectiveRows(recipe, createRunState(), inksOf(recipe)).map((row) => row.termId)).toEqual([
      "request:1:respond",
      "request:2:look",
    ]);
  });

  it("is pending with no value before anything is applied", () => {
    const rows = objectiveRows(twoRequests(), createRunState(), inksOf(twoRequests()));
    expect(rows.every((row) => row.pending && row.weighted === undefined)).toBe(true);
    expect(objectiveTotal(rows)).toBeUndefined();
  });

  it("takes values from the image measured for the applied recipe, and the total is their sum", () => {
    const recipe = twoRequests();
    const rows = objectiveRows(recipe, measuredSession(recipe), inksOf(recipe));
    expect(rows.every((row) => !row.pending)).toBe(true);
    expect(rows.map((row) => row.weighted)).toEqual([0.003, 0.2, 0.006, 0.25]);
    expect(objectiveTotal(rows)).toBeCloseTo(0.459, 12);
  });

  it("marks a changed term pending with no value while the others keep theirs", () => {
    const applied = twoRequests();
    const edited = setTermWeight(applied, "request:1:look", 2);
    const rows = objectiveRows(edited, measuredSession(applied), inksOf(edited));
    const look = rows.find((row) => row.termId === "request:1:look");
    expect(look).toMatchObject({ pending: true, weight: 2, weighted: undefined });
    expect(rows.find((row) => row.termId === "request:1:respond")).toMatchObject({ pending: false, weighted: 0.003 });
    expect(objectiveTotal(rows)).toBeUndefined();
  });

  it("shows no values from an image of an older revision", () => {
    const recipe = twoRequests();
    const session = measuredSession(recipe);
    const older = { ...session, applied: { ...session.applied!, revision: 4 } };
    const rows = objectiveRows(recipe, older, inksOf(recipe));
    expect(rows.every((row) => row.weighted === undefined)).toBe(true);
  });

  it("gives a Code row the measured codes of its cells, only for the same target", () => {
    const recipe = twoRequests();
    const session = measuredSession(recipe);
    const rows = objectiveRows(recipe, session, inksOf(recipe));
    expect(rows[0].minimap?.requested).toEqual([0.4, -0.2, 0.9]);
    expect(rows[0].minimap?.measured).toHaveLength(6);
    expect(rows[2].minimap?.measured).toBeUndefined();

    // Both requests removed and another dropped reuses id 1 with a different token.
    const emptied = removeRequest(removeRequest(recipe, 2), 1);
    const reused = createRequest(emptied, handoff(patch(9, 0, 0), 1398));
    const replaced = reused.requests.find((request) => request.id === 1)!;
    expect(replaced).toBeDefined();
    expect(measuredCodes(session, replaced)).toBeUndefined();
  });
});

it("joins code readouts to the applied field while a new field is pending", () => {
  const applied = twoRequests();
  const desired = structuredClone(applied.requests[0]);
  desired.respondLike.where = desired.respondLike.where.map((value) => Math.floor(value / 2));
  const session = measuredSession(applied);
  const measured = measuredCodes(session, desired);
  expect(measured?.appliedField).toBe(applied.requests[0].respondLike.where);
});
