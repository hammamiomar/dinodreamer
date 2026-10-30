// The engine's qualification installs the evidence recipe from checked-in specs. This test
// keeps those specs equal to what the worker sends for the same recipe.
// Regenerate after changing the recipe or the translation: UPDATE_FIXTURES=1 pnpm test.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { validateRecipe } from "../recipe";
import { parseRecipe } from "../recipe-parse";
import { objectiveSpec, optimizerSpec, probeSpecs } from "./objective";

const fixtures = join(import.meta.dirname, "../../../engine/tools/fixtures");

test("the qualified evidence specs are the worker's translation of the evidence recipe", () => {
  const recipe = parseRecipe(JSON.parse(readFileSync(join(fixtures, "evidence-recipe.json"), "utf8")));
  expect(validateRecipe(recipe, { blocks: 16384 })).toEqual([]);
  // The optimizer settings travel with the specs: the qualification installs them too.
  const specs = { objective: objectiveSpec(recipe), probes: probeSpecs(recipe), optimizer: optimizerSpec(recipe) };
  const path = join(fixtures, "evidence-specs.json");
  if (process.env.UPDATE_FIXTURES) writeFileSync(path, `${JSON.stringify(specs)}\n`);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(specs);
});
