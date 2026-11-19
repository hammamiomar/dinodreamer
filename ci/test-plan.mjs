import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { layoutViewports } from "../app/tests/how-layout-viewports.mjs";

import { dataDirectory, readDiff, testScope } from "./test-scope.mjs";
import { balance, recordedDurations, unitProjects, unitShards } from "./test-shards.mjs";

const root = resolve(import.meta.dirname, "..");
const appRequire = createRequire(resolve(root, "app/package.json"));
const { createVitest } = await import(pathToFileURL(appRequire.resolve("vitest/node")));
const browserDirectory = "app/tests/";
const browserFiles = readdirSync(resolve(root, browserDirectory))
  .filter((name) => name.endsWith("-browser.test.mjs"))
  .map((name) => browserDirectory + name);
const moduleFile = /\.[cm]?[jt]sx?$/;
const unitFile = /\.test\.ts$/;

async function relatedFiles(project, related, include) {
  const context = await createVitest({
    root: resolve(root, project),
    watch: false,
    run: true,
    ...(related && { related: related.map((file) => resolve(root, file)) }),
    ...(include && { include }),
  });
  try {
    const specifications = await context.getRelevantTestSpecifications();
    return specifications.map((spec) => relative(root, spec.moduleId));
  } finally {
    await context.close();
  }
}

// The loader and fixture tests also read files through Node. Treat a changed data file as
// an input to every module that opens files or starts a subprocess. Vitest follows its callers.
function fileReaders() {
  const result = execFileSync(
    "git",
    [
      "grep",
      "-l",
      "-z",
      "-E",
      "(node:)?(fs(/promises)?|child_process)[\"']",
      "--",
      "app/src",
      "app/tests",
      "gallery/src",
      "gallery/test",
      "gallery/*.ts",
      ":(exclude)gallery/vitest.config.ts",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  return result.split("\0").filter((file) => moduleFile.test(file));
}

async function relatedUnits({ paths, runtime }) {
  const web = paths.filter(
    (file) => !file.startsWith("engine/") || file.startsWith("engine/tools/fixtures/"),
  );
  const wholeSuite =
    runtime ||
    web.some((file) => !moduleFile.test(file) && !file.endsWith(".css") && !dataDirectory.test(file));
  if (!wholeSuite && !web.some((file) => !browserFiles.includes(file))) return [];
  const data = web.some((file) => dataDirectory.test(file));
  const inputs = data ? [...web, ...fileReaders()] : web;
  // Vitest loads setupFiles before every gallery test. Their imports have the same scope.
  const gallerySetup =
    !wholeSuite &&
    web.some((file) => !unitFile.test(file)) &&
    (await relatedFiles("gallery", inputs, ["test/siteverify.ts"])).length > 0;
  const files = (
    await Promise.all(
      unitProjects.map((project) =>
        relatedFiles(project, wholeSuite || (project === "gallery" && gallerySetup) ? null : inputs),
      ),
    )
  ).flat();
  if (wholeSuite) return files;

  // One test scans the full TypeScript source tree. Another launches Node with import
  // statements in a string. These edges do not appear in Vitest's import graph.
  const sources = web.filter((file) => /^(app|gallery)\/src\/.+\.tsx?$/.test(file) && !unitFile.test(file));
  if (sources.some((file) => file.startsWith("app/"))) files.push("app/src/app/engine-wasm.test.ts");
  if (sources.length) {
    const commands = ["src/review.ts", "src/rest-bucket.ts", "src/material-review.ts"];
    if ((await relatedFiles("gallery", sources, commands)).length) files.push("gallery/test/gallery.test.ts");
  }
  return [...new Set(files)];
}

export default async function planTests(diff) {
  const scope = testScope(diff);
  const units = await relatedUnits(scope);
  const browsers = diff === null ? browserFiles : [];
  const browserTasks = browsers.flatMap((file) =>
    file.endsWith("/how-layout-browser.test.mjs")
      ? layoutViewports.map(({ width, height }) => file + "#" + width + "-" + height)
      : [file],
  );
  const times = recordedDurations(process.env.CI_PREVIOUS_DURATIONS);
  const jobs = [];
  for (const [kind, bins] of [
    ["unit", unitShards(units, times.unit)],
    ["browser", balance(browserTasks, times.browser, 5, 1)],
  ]) {
    bins.forEach(({ files, duration }, index) => {
      jobs.push({
        kind,
        shard: index + 1,
        files,
        milliseconds: duration,
      });
    });
  }
  return {
    jobs,
    cargo: scope.cargo,
    engineNode: scope.engineNode,
    planner: scope.full,
  };
}

// A single unit shard reuses the validation runner. Large suites get one runner per
// timed shard, so a CPU-bound test does not compete with the linter or another shard.
export function scheduleJobs(plan) {
  const units = plan.jobs.filter((job) => job.kind === "unit");
  const inline = units.length === 1 ? units : [];
  const matrix = plan.jobs.filter((job) => !inline.includes(job));
  return { matrix, validation: { jobs: inline, planner: plan.planner, engineNode: plan.engineNode } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const plan = await planTests(readDiff(process.argv[2]));
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const { matrix, validation } = scheduleJobs(plan);
    const fields = {
      matrix: JSON.stringify({ include: matrix }),
      tests: matrix.length > 0,
      validation: JSON.stringify(validation),
      inlineUnit: validation.jobs.length > 0,
    };
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(fields)
        .map(([name, value]) => name + "=" + value + "\n")
        .join(""),
    );
  }
}
