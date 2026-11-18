import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import planTests from "./test-plan.mjs";
import { balance, unitShards } from "./test-shards.mjs";

const changed = (file) => [{ status: "M", file }];
const filesOf = (plan) => plan.jobs.flatMap((job) => job.files);

test("shards preserve every file once, including new untimed files", () => {
  const bins = balance(["a", "b", "c", "d", "e"], { a: 30, b: 20, c: 10, d: 10 }, 2, 1);
  assert.deepEqual(
    bins.map((bin) => bin.duration),
    [50, 40],
  );
  assert.deepEqual(bins.flatMap((bin) => bin.files).sort(), ["a", "b", "c", "d", "e"]);
});

test("a documentation change schedules no tests", async () => {
  assert.deepEqual(await planTests(changed("README.md")), {
    jobs: [],
    cargo: false,
    engineNode: false,
    planner: false,
  });
});

test("a changed unit test schedules that file alone", async () => {
  const file = "app/src/features/automata/deck-level-swipe.test.ts";
  assert.deepEqual(filesOf(await planTests(changed(file))), [file]);
});

test("shared app modules reach gallery tests and the app source audit", async () => {
  const files = filesOf(await planTests(changed("app/src/materials/material-file.ts")));
  assert(files.includes("gallery/test/materials.test.ts"));
  assert(files.includes("app/src/app/engine-wasm.test.ts"));
});

test("main, deleted modules, engine inputs and CI changes run the complete matrix", async () => {
  const main = await planTests(null);
  const all = filesOf(main).sort();
  assert.equal(new Set(all).size, all.length);
  for (const project of ["app/src", "app/tests", "gallery/test"]) {
    const actual = readdirSync(project, { recursive: true })
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => project + "/" + name);
    assert.deepEqual(
      actual.sort(),
      all.filter((file) => file.startsWith(project + "/") && file.endsWith(".test.ts")),
    );
  }
  for (const changes of [
    [{ status: "D", file: "app/src/shared.ts" }],
    changed("engine/src/lib.rs"),
    changed(".github/workflows/check.yml"),
  ]) {
    const plan = await planTests(changes);
    assert.deepEqual(filesOf(plan).sort(), all);
    assert(plan.cargo);
  }
});

test("a browser-only edit selects its suite, including every viewport in a layout test", async () => {
  const file = "app/tests/how-layout-browser.test.mjs";
  const files = filesOf(await planTests(changed(file)));
  assert(files.length > 1);
  assert(files.every((task) => task.startsWith(file + "#")));
});

test("a Rust integration test schedules Cargo alone", async () => {
  const plan = await planTests(changed("engine/tests/numerics.rs"));
  assert.deepEqual(plan.jobs, []);
  assert(plan.cargo);
  assert.equal(plan.engineNode, false);
});

test("a shared browser harness reaches only its consumer", async () => {
  const files = filesOf(await planTests(changed("app/tests/ui-state-harness.tsx")));
  assert.deepEqual(files, ["app/tests/shell-browser.test.mjs"]);
});

test("the Rust target-set fixture reaches Cargo", async () => {
  assert((await planTests(changed("engine/tools/fixtures/target-set-losses.json"))).cargo);
});

test("the shared gallery setup reaches every gallery test", async () => {
  const complete = filesOf(await planTests(null)).filter((file) => file.startsWith("gallery/"));
  const affected = filesOf(await planTests(changed("gallery/src/turnstile.ts")));
  assert(complete.every((file) => affected.includes(file)));
});

test("large unit suites give each project its own jobs and keep small PRs together", () => {
  const app = Array.from({ length: 73 }, (_, index) => "app/" + index + ".test.ts");
  const gallery = ["gallery/sample.test.ts"];
  const shards = unitShards([...app, ...gallery], {});
  assert.equal(shards.length, 4);
  assert.deepEqual(shards.flatMap(({ files }) => files).sort(), [...app, ...gallery].sort());
  assert(shards.every(({ files }) => files.every((file) => file.split("/")[0] === files[0].split("/")[0])));
  assert.equal(unitShards([app[0], gallery[0]], {}).length, 1);
});
