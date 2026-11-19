import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const moduleFile = /\.[cm]?[jt]sx?$/;

export function readDiff(base) {
  if (!base || base === "--all") return null;
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

export const dataDirectory = /^(?:app\/(?:fixtures|public)|gallery\/seed|engine\/tools\/fixtures)\//;
const projectConfiguration =
  /\/(?:package\.json|pnpm-.*\.yaml|.*config\.(?:[cm]?[jt]s|jsonc?)|\.env(?:\..*)?|.*\.d\.ts)$/;

function requiresFullCheck({ file, status }) {
  if (status === "D" || !/^(app|gallery|engine)\//.test(file)) return true;
  if (projectConfiguration.test(file)) return true;
  // An unknown addition can introduce a new input that neither the current graph nor
  // the input directories describe. Ordinary new modules are resolved on the merge result.
  return status !== "M" && !moduleFile.test(file) && !dataDirectory.test(file);
}

export function testScope(diff) {
  const changes = (diff ?? []).filter(
    ({ file }) => !file.endsWith(".md") && !["LICENSE", "NOTICE"].includes(file),
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { cargo, engineNode, full } = testScope(readDiff(process.argv[2]));
  console.log(JSON.stringify({ cargo, engineNode, full }));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "cargo=" + cargo + "\nengineNode=" + engineNode + "\nfull=" + full + "\n");
  }
}
