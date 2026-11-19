import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { unitProjects } from "./test-shards.mjs";

const root = resolvePath(import.meta.dirname, "..");
const plan = JSON.parse(process.env.VALIDATION);

function run(name, executable, args, env = {}) {
  const start = performance.now();
  const child = spawn(executable, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      console.log(name + " finished in " + ((performance.now() - start) / 1000).toFixed(1) + " s");
      if (code === 0) resolve();
      else reject(new Error(name + " failed (" + (signal ?? code) + ")"));
    });
  });
}

const compiler = execFileSync("bun", ["-p", "process.versions.typescript"], { encoding: "utf8" }).trim();
for (const project of unitProjects) {
  const locked = JSON.parse(
    readFileSync(resolvePath(root, project, "node_modules/typescript/package.json"), "utf8"),
  );
  if (compiler !== locked.version) throw new Error(project + " requires TypeScript " + locked.version);
}

async function compileWeb() {
  for (const project of unitProjects) {
    await run(project + " types", "bun", ["check", "--no-script", "--all", "-p", project]);
  }
  await run("bundle", "pnpm", ["--dir", "app", "exec", "vite", "build"]);
}

await Promise.all([run("lint", "pnpm", ["--dir", "ci", "lint"]), compileWeb()]);
if (plan.engineNode) {
  const files = readdirSync(resolvePath(root, "engine/tests")).filter((name) => name.endsWith(".test.ts"));
  await run("engine Node tests", process.execPath, [
    "--test",
    ...files.map((name) => "engine/tests/" + name),
  ]);
}
if (plan.planner) await run("planner tests", process.execPath, ["--test", "ci/test-plan.test.mjs"]);
for (const job of plan.jobs) {
  await run("unit shard " + job.shard, process.execPath, ["ci/run-test-shard.mjs"], {
    TEST_SHARD: JSON.stringify(job),
  });
}
