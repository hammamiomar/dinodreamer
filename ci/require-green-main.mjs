// The release's first step (.github/workflows/release.yml): a tag deploys only a commit that is on main and
// whose full check on main passed, browser suites included. A check still running is waited for; one that failed
// or was cancelled stops the release before anything is built or deployed.
//
//   GITHUB_REPOSITORY=owner/name GITHUB_SHA=<commit> GH_TOKEN=<token> node ci/require-green-main.mjs

import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

/** How long a release waits for main's check of its commit. A full check takes about five minutes. */
const LONGEST_WAIT_MS = 20 * 60_000;
const POLL_MS = 30_000;

/**
 * What a release does about main's check of its commit: deploy, wait, or stop with the reason. `onMain` is the
 * comparison of main with the commit ("identical" or "behind" when main holds it); `run` is the latest push run of
 * check.yml on main for the commit, or undefined before it starts.
 */
export default function verdict(onMain, run) {
  if (!["identical", "behind"].includes(onMain)) return { stop: "the tagged commit is not on main; tag a commit on main" };
  if (run === undefined || run.status !== "completed") return { wait: run === undefined ? "has not started" : `is ${run.status}` };
  if (run.conclusion === "success") return { deploy: true };
  return { stop: `main's check of this commit ended with ${run.conclusion} (${run.html_url}); fix main, or re-run that check, then tag again` };
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const sha = process.env.GITHUB_SHA;
  const deadline = Date.now() + LONGEST_WAIT_MS;
  const { status: onMain } = await github(`/compare/main...${sha}`);
  for (;;) {
    const { workflow_runs: runs } = await github(`/actions/workflows/check.yml/runs?head_sha=${sha}&branch=main&event=push&per_page=1`);
    const answer = verdict(onMain, runs[0]);
    if (answer.deploy) {
      console.log(`main's check passed for ${sha}: ${runs[0].html_url}`);
      return;
    }
    if (answer.stop) throw new Error(`Nothing was deployed: ${answer.stop}.`);
    if (Date.now() > deadline) throw new Error(`Nothing was deployed: main's check of ${sha} ${answer.wait} after ${LONGEST_WAIT_MS / 60_000} minutes.`);
    console.log(`main's check of ${sha} ${answer.wait}; waiting`);
    await sleep(POLL_MS);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
