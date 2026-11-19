import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { unitProjects } from "./test-shards.mjs";

const root = resolve(import.meta.dirname, "..");
const { kind, files, shard } = JSON.parse(process.env.TEST_SHARD);
if (!Array.isArray(files) || files.length === 0) throw new Error("Empty test shard");
const timingDirectory = process.env.CI_RECORD_DURATIONS;
if (timingDirectory) mkdirSync(timingDirectory, { recursive: true });
if (kind === "browser") {
  const env = { ...process.env };
  if (timingDirectory) env.TEST_DURATION_FILE = resolve(timingDirectory, "browser-" + shard + ".json");
  execFileSync(process.execPath, ["app/tests/run-browser-tests.mjs", ...files], {
    cwd: root,
    stdio: "inherit",
    env,
  });
} else if (kind === "unit") {
  const unexpected = files.find((file) => !/^(app|gallery)\//.test(file));
  if (unexpected) throw new Error("Unknown unit test " + unexpected);
  for (const project of unitProjects) {
    const tests = files.filter((file) => file.startsWith(project + "/")).map((file) => resolve(root, file));
    if (!tests.length) continue;
    const args = [
      "exec",
      "vitest",
      "run",
      "--maxWorkers=" + (process.env.CI_UNIT_WORKERS ?? "2"),
      "--passWithNoTests=false",
    ];
    const env = { ...process.env, MATERIAL_AUDIT: "1" };
    if (timingDirectory) {
      env.TEST_DURATION_FILE = resolve(timingDirectory, "unit-" + shard + "-" + project + ".json");
      args.push("--reporter=default", "--reporter=../ci/record-test-duration.mjs");
    }
    execFileSync("pnpm", [...args, ...tests], {
      cwd: resolve(root, project),
      stdio: "inherit",
      env,
    });
  }
} else {
  throw new Error("Unknown test suite " + kind);
}
