import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { layoutViewports } from "../app/tests/how-layout-viewports.mjs";

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

function readDiff(base) {
  // HEAD is the merge result tested by Actions. Retain both sides of a rename.
  const fields = execFileSync("git", ["diff", "--no-renames", "--name-status", "-z", base, "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0");
  fields.pop();
  const changes = [];
  for (let index = 0; index < fields.length; index += 2)
    changes.push({ status: fields[index], file: fields[index + 1] });
  return changes;
}

const dataDirectory = /^(?:app\/(?:fixtures|public)|gallery\/seed|engine\/tools\/fixtures)\//;
const projectConfiguration =
  /\/(?:package\.json|pnpm-.*\.yaml|.*config\.(?:[cm]?[jt]s|jsonc?)|\.env(?:\..*)?|.*\.d\.ts)$/;

function requiresFullCheck({ file, status }) {
  if (status === "D" || !/^(app|gallery|engine)\//.test(file)) return true;
  if (projectConfiguration.test(file)) return true;
  // An unknown addition can introduce a new input that neither the current graph nor
  // the input directories describe. Ordinary new modules are resolved on the merge result.
  return status !== "M" && !moduleFile.test(file) && !dataDirectory.test(file);
}

function testScope(diff) {
  const changes = (diff ?? []).filter(
    ({ file }) =>
      !/(^|\/)(README|AGENTS)\.md$/.test(file) &&
      !/^ci\/.+\.md$/.test(file) &&
      !["LICENSE", "NOTICE", "engine/set-methods-ledger.md"].includes(file),
  );
  const paths = changes.map((change) => change.file);
  const engine = paths.filter((file) => file.startsWith("engine/"));
  const full = diff === null || changes.some((change) => requiresFullCheck(change));
  const runtime = full || engine.some((file) => !/^engine\/(tests|examples|tools|benchmarks)\//.test(file));
  return {
    paths,
    full,
    runtime,
    cargo:
      runtime ||
      engine.some((file) => /^engine\/(tests|examples)\/.+\.rs$/.test(file)) ||
      paths.includes("engine/tools/fixtures/target-set-losses.json"),
    engineNode:
      runtime ||
      engine.some(
        (file) =>
          /^engine\/(benchmarks|tools\/fixtures)\//.test(file) || /^engine\/tests\/.+\.test\.ts$/.test(file),
      ) ||
      paths.some((file) => file.startsWith("app/src/synthesis/")),
  };
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = process.argv[2];
  const plan = await planTests(base && base !== "--all" ? readDiff(base) : null);
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const fields = {
      matrix: JSON.stringify({ include: plan.jobs }),
      tests: plan.jobs.length > 0,
      cargo: plan.cargo,
      engineNode: plan.engineNode,
      planner: plan.planner,
    };
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(fields)
        .map(([name, value]) => name + "=" + value + "\n")
        .join(""),
    );
  }
}
