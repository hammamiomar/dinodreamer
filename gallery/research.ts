// The research runs' publish command, for the terminal: pnpm run research publish <folder> [--local <dir>]
//
// <folder> is the research repository's export: manifest.json, and runs/<id>/material.json with a
// still-NNNN.png for every tick the index lists (app/src/features/research/research-runs.ts). The
// command checks every file first and writes nothing when one is wrong. Then it writes the runs the
// stored index does not list yet, and the new index last (src/research.ts), to the private bucket:
// the owner's research page shows them; nothing is public. --local <dir> writes the local Worker's
// bucket instead (`wrangler dev --local --persist-to <dir>`).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openBuckets, openLocalBuckets } from "./review-cli.ts";
import { stillName, type ResearchRun } from "../app/src/features/research/research-runs.ts";
import { checkedResearchManifest, researchRunProblems, runsToWrite, storedResearchManifest, writeResearch, type ResearchRunFiles } from "./src/research.ts";

const args = process.argv.slice(2);
const localAt = args.indexOf("--local");
const persistTo = localAt >= 0 ? args.splice(localAt, 2)[1] : undefined;
const [command, folder] = args;
if (command !== "publish" || folder === undefined || (localAt >= 0 && !persistTo)) {
  console.error("usage: pnpm run research publish <folder> [--local <wrangler persist directory>]");
  process.exit(2);
}

const manifestText = readFileSync(join(folder, "manifest.json"), "utf8");
const manifest = checkedResearchManifest(manifestText);
const readRunFiles = (run: ResearchRun): ResearchRunFiles => {
  const runFolder = join(folder, "runs", run.id);
  const material = join(runFolder, "material.json");
  const stills = new Map(run.stills.flatMap((tick) => {
    const still = join(runFolder, stillName(tick));
    return existsSync(still) ? [[tick, new Uint8Array(readFileSync(still))] as const] : [];
  }));
  return { material: existsSync(material) ? new Uint8Array(readFileSync(material)) : new Uint8Array(), stills };
};

const problems = (await Promise.all(manifest.runs.map((run) => researchRunProblems(run, readRunFiles(run))))).flat();
if (problems.length > 0) {
  console.error(`Nothing was written. ${problems.length} problems:\n${problems.join("\n")}`);
  process.exit(1);
}

const opened = persistTo ? await openLocalBuckets(persistTo) : { ...openBuckets(), close: async () => {} };
try {
  const stored = await storedResearchManifest(opened.submissions);
  const runs = runsToWrite(stored, manifest);
  await writeResearch(opened.submissions, manifestText, runs, readRunFiles);
  const place = persistTo ? `the local store ${persistTo}` : "Cloudflare's private bucket";
  console.log(`Wrote ${runs.length} new runs and the index of ${manifest.runs.length} runs in ${manifest.studies.length} studies to ${place}`);
} finally {
  await opened.close();
}
