// The research runs' commands, for the terminal:
//
//   pnpm run research publish <folder> [--local <dir>] [--reread]
//   pnpm run research show-default [--local <dir>] [--production]
//
// <folder> is the research repository's export: manifest.json, and runs/<id>/material.json with a
// still-NNNN.png for every tick the index lists (app/src/features/research/research-runs.ts). The
// command checks every file first and writes nothing when one is wrong. Then it writes the runs the
// stored index does not list yet, and the new index last (src/research.ts), to the private bucket:
// the owner's research page shows them; nothing is public. --local <dir> writes the local Worker's
// bucket instead (`wrangler dev --local --persist-to <dir>`).
//
// A listed run whose file changed is refused, unless --reread is given: then a run whose reading was
// taken again, at another step, replaces its file under the same id, when nothing but its reading and
// its preview differs. If the run is on the Automata page, shown or hidden, that automaton's public
// file, poster and entry take the new reading too (src/research.ts, republishRereadRuns).
//
// show-default shows on the Automata page every run of the stored index that the export shows by
// default (`gallery.shown`, research-runs.ts) and that is not there yet (src/research.ts,
// showResearchRuns): the public gallery's starting state, before the owner has chosen. On Cloudflare
// it writes only with --production; without it, a dry run that counts what it would do.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openBuckets, openLocalBuckets } from "./review-cli.ts";
import { stillName, type ResearchRun } from "../app/src/features/research/research-runs.ts";
import {
  changedRuns, checkedResearchManifest, republishRereadRuns, rereadProblems, researchRunProblems, runsToWrite, showResearchRuns, storedResearchManifest,
  writeResearch, type ResearchRunFiles,
} from "./src/research.ts";

const args = process.argv.slice(2);
const localAt = args.indexOf("--local");
const persistTo = localAt >= 0 ? args.splice(localAt, 2)[1] : undefined;
const productionAt = args.indexOf("--production");
const production = productionAt >= 0;
if (production) args.splice(productionAt, 1);
const rereadAt = args.indexOf("--reread");
const reread = rereadAt >= 0;
if (reread) args.splice(rereadAt, 1);
const [command, folder] = args;
const usage = "usage: pnpm run research publish <folder> [--local <wrangler persist directory>] [--reread]\n"
  + "       pnpm run research show-default [--local <wrangler persist directory>] [--production]";
if ((command !== "publish" && command !== "show-default") || (command === "publish" && folder === undefined) || (localAt >= 0 && !persistTo)) {
  console.error(usage);
  process.exit(2);
}

if (command === "show-default") {
  const opened = persistTo ? await openLocalBuckets(persistTo) : { ...openBuckets(), close: async () => {} };
  try {
    const stored = await storedResearchManifest(opened.submissions);
    if (stored === null) throw new Error("no research run index is stored yet; run: pnpm run research publish <folder>");
    const runs = stored.runs.filter((run) => run.gallery?.shown === true);
    const write = persistTo !== undefined || production;
    const result = await showResearchRuns(opened.submissions, opened.library, runs, new Date(), write);
    const place = persistTo ? `the local store ${persistTo}` : "Cloudflare";
    console.log(`${runs.length} runs are shown by default, of ${stored.runs.length} in the stored index.`);
    console.log(`  ${result.published.length} published as new automata`);
    console.log(`  ${result.placed.length} were shown automata already and took their place in the grid`);
    console.log(`  ${result.keptHidden.length} stay hidden, as the owner left them`);
    console.log(`  ${result.withoutPlace.length} have no place in the grid and are not published`);
    console.log(write ? `Written to ${place}.` : "Dry run: nothing was written. Add --production to write Cloudflare.");
  } finally {
    await opened.close();
  }
  process.exit(0);
}

const manifestText = readFileSync(join(folder!, "manifest.json"), "utf8");
const manifest = checkedResearchManifest(manifestText);
const readRunFiles = (run: ResearchRun): ResearchRunFiles => {
  const runFolder = join(folder!, "runs", run.id);
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
  const runs = runsToWrite(stored, manifest, reread);
  const rereadRuns = changedRuns(stored, manifest);
  const rereadWrong = await rereadProblems(opened.submissions, rereadRuns, readRunFiles);
  if (rereadWrong.length > 0) {
    console.error(`Nothing was written. ${rereadWrong.length} runs changed more than their reading:\n${rereadWrong.join("\n")}`);
    process.exit(1);
  }
  await writeResearch(opened.submissions, manifestText, [...runs, ...rereadRuns], readRunFiles);
  const place = persistTo ? `the local store ${persistTo}` : "Cloudflare's private bucket";
  console.log(`Wrote ${runs.length} new runs and the index of ${manifest.runs.length} runs in ${manifest.studies.length} studies to ${place}`);
  if (rereadRuns.length > 0) {
    const replaced = await republishRereadRuns(opened.submissions, opened.library, rereadRuns);
    console.log(`${rereadRuns.length} runs were read again and replaced their file.`);
    console.log(`  ${replaced.shown.length} are shown automata: their file, poster and entry took the new reading`);
    console.log(`  ${replaced.hidden.length} are hidden automata: their file, poster and recovery record took it`);
    console.log(`  ${replaced.absent.length} are not on the Automata page`);
  }
} finally {
  await opened.close();
}
