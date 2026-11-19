import assert from "node:assert/strict";
import { test } from "node:test";
import { verdict } from "./require-green-main.mjs";

const run = (status, conclusion = null) => ({ status, conclusion, html_url: "https://github.com/run" });

test("a release deploys a commit on main whose full check passed", () => {
  assert.deepEqual(verdict("identical", run("completed", "success")), { deploy: true });
  assert.deepEqual(verdict("behind", run("completed", "success")), { deploy: true });
});

test("a release waits for main's check that has not started or is still running", () => {
  assert.ok(verdict("identical", undefined).wait);
  assert.ok(verdict("identical", run("in_progress")).wait);
  assert.ok(verdict("identical", run("queued")).wait);
});

test("a release stops for a failed or cancelled check, and for a commit that is not on main", () => {
  assert.match(verdict("identical", run("completed", "failure")).stop, /failure/);
  assert.match(verdict("identical", run("completed", "cancelled")).stop, /cancelled/);
  assert.match(verdict("ahead", run("completed", "success")).stop, /not on main/);
  assert.match(verdict("diverged", undefined).stop, /not on main/);
});
