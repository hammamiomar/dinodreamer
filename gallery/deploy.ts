// Deploy a committed revision, or the current CI checkout:
//   pnpm run deploy [revision] [--ci] [--without-gpu] [--preview-alias=pr-<number>]
// CI builds engine/pkg first. Local runs build in a separate worktree.
// Engine publication belongs to GPU qualification: this script only checks its public URL.
// Releases require engine/qualified-engine.json to match the built WASM exactly.
// A preview uploads a Worker version without changing production traffic.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { engineWasmKey } from "./src/storage.ts";
import { DINODREAMER_ORIGIN } from "./src/site-location.ts";

const GALLERY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(GALLERY, "..");
const WORKTREE = resolve(REPOSITORY, "..", "dinodreamer-public-deploy");
const ENGINE_WASM = "dinodreamer_engine_bg.wasm";
const PRODUCTION = DINODREAMER_ORIGIN;
// Allow edge propagation before checking the deployed build.
const PROPAGATION_MS = 120_000;
// One request of that wait, at most; a request that hangs counts as not served yet.
const REQUEST_MS = 10_000;
const POLL_MS = 2_000;
// Require sustained availability: one successful round can be followed by missing build files.
const STABLE_MS = 30_000;

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}): string {
  console.log(`$ (${cwd}) ${command} ${args.join(" ")}`);
  return execFileSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function checkoutRevision(revision: string): string {
  if (!existsSync(WORKTREE)) run("git", ["worktree", "add", "--detach", WORKTREE, revision], REPOSITORY);
  else run("git", ["checkout", "--detach", revision], WORKTREE);
  return run("git", ["rev-parse", "HEAD"], WORKTREE).trim();
}

/** A release may only serve the exact runtime recorded by GPU qualification. */
export function checkQualifiedEngine(built: string, qualified: string): void {
  if (!/^[0-9a-f]{64}$/.test(qualified)) throw new Error("qualified-engine.json must contain a full lowercase SHA-256");
  if (built !== qualified) {
    throw new Error(`Built engine SHA-256 ${built} differs from the qualified ${qualified}. Qualify the CI artifact before releasing.`);
  }
}

/** Check the public object without R2 credentials or writes. HTML fallback is not an engine. */
export async function publishedEngineExists(url: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher(url, { method: "HEAD", signal: AbortSignal.timeout(REQUEST_MS) });
  if (response.status === 404) return false;
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "application/wasm") {
    throw new Error(`Engine is not published at ${url} (HTTP ${response.status}). Publish the qualified artifact outside CI first.`);
  }
  return true;
}

/** Wrangler writes one JSON object per line; use its alias URL rather than its console format. */
export function previewUrl(output: string): string {
  const record = output.trim().split(/\r?\n/).map((line) => JSON.parse(line)).reverse().find((entry) => entry.type === "version-upload");
  const url = record?.preview_alias_url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("Wrangler did not return a preview alias URL");
  return url;
}

/**
 * Wait until production answers / with this build's index.html (its build files, named by
 * content hashes), answers every file of the build under /assets/ with 200, and answers a
 * file missing from /assets/ with 404 (the Worker's rule), in every round for STABLE_MS.
 * Each request opens its own connection, so the rounds do not all ride one kept-alive
 * connection; that does not guarantee another edge server. The Worker, index and lazy assets
 * can become available at different times, so each round checks all three.
 */
async function waitForBuild(index: string, assets: string[]): Promise<void> {
  console.log(`Waiting up to ${PROPAGATION_MS / 1000} s for / and ${assets.length} build files: ${assets.join(", ")}`);
  const deadline = Date.now() + PROPAGATION_MS;
  let cleanSince: number | null = null;
  for (;;) {
    const waiting = await notServed(index, assets, deadline);
    cleanSince = waiting.length > 0 ? null : (cleanSince ?? Date.now());
    if (cleanSince !== null && Date.now() - cleanSince >= STABLE_MS) break;
    // No time for a sleep and another round: report this round's answers. A round that the
    // deadline cut short reports its unfinished requests as "no answer".
    if (Date.now() + POLL_MS >= deadline) {
      const state = waiting.length > 0 ? waiting.join(", ") : `clean for only ${((Date.now() - cleanSince!) / 1000).toFixed(0)} s`;
      throw new Error(
        `${PRODUCTION} did not serve the new build steadily within ${PROPAGATION_MS / 1000} s: ${state}. ` +
          "The new Worker is deployed: check it or roll it back.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  console.log(`${PRODUCTION} serves the new build, every round for ${STABLE_MS / 1000} s`);
}

/** What production does not yet answer as this build does, as "path (answer)"; empty when it does. */
async function notServed(index: string, assets: string[], deadline: number): Promise<string[]> {
  const answer = (path: string, read = true) => answerBefore(path, deadline, read);
  const waiting: string[] = [];
  const page = await answer("/");
  if (page.body === undefined) waiting.push(`/ (${page.kind})`);
  else if (buildReferences(page.body) !== buildReferences(index)) waiting.push("/ (another build's index.html)");
  const files = await Promise.all(assets.map(async (name) => ({ name, ...(await answer(`/assets/${name}`, false)) })));
  waiting.push(...files.filter((file) => file.kind !== "200").map((file) => `/assets/${file.name} (${file.kind})`));
  const missing = await answer("/assets/engine.worker-deploy0000.js", false);
  if (missing.kind !== "404") waiting.push(`/assets/engine.worker-deploy0000.js (${missing.kind}, not 404)`);
  return waiting;
}

/**
 * The build files an index.html names, which identify the build by their content hashes. The
 * page is not compared byte for byte: Cloudflare Web Analytics adds its beacon script to some
 * answers.
 */
function buildReferences(html: string): string {
  return [...new Set([...html.matchAll(/\/assets\/[^"']+/g)].map((match) => match[0]))].sort().join(" ");
}

/**
 * One production answer on a connection of its own: its status, "<status> html" for an HTML
 * body (the static assets' fallback for a path they lack), or "no answer" after REQUEST_MS or
 * at the deadline, whichever comes first, so no request outlasts the wait. With `read`, the body.
 */
function answerBefore(path: string, deadline: number, read: boolean): Promise<{ kind: string; body?: string }> {
  const timeout = Math.max(1, Math.min(REQUEST_MS, deadline - Date.now()));
  return new Promise((resolve) => {
    const options = { agent: false, signal: AbortSignal.timeout(timeout), headers: { "cache-control": "no-store" } };
    const sent = request(`${PRODUCTION}${path}`, options, (response) => {
      const html = (response.headers["content-type"] ?? "").includes("text/html");
      const kind = html && path !== "/" ? `${response.statusCode} html` : String(response.statusCode);
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        if (read) chunks.push(chunk);
      });
      response.on("end", () => resolve({ kind, body: read ? Buffer.concat(chunks).toString("utf8") : undefined }));
      response.on("error", () => resolve({ kind: "no answer" }));
    });
    sent.on("error", () => resolve({ kind: "no answer" }));
    sent.end();
  });
}

function reportPreview(message: string, url?: string): void {
  console.log(message);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `message=${message}\n${url ? `url=${url}\n` : ""}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const revision = args.find((arg) => !arg.startsWith("--")) ?? "main";
  const ci = args.includes("--ci");
  const alias = args.find((arg) => arg.startsWith("--preview-alias="))?.split("=")[1];
  if (alias !== undefined && !/^pr-[1-9][0-9]*$/.test(alias)) throw new Error("Use --preview-alias=pr-<number>");
  const repository = ci ? REPOSITORY : WORKTREE;
  const commit = ci ? run("git", ["rev-parse", "HEAD"], repository).trim() : checkoutRevision(revision);
  if (!ci) run("wasm-pack", ["build", "--target", "web", "--release", "--", "--locked"], join(repository, "engine"));

  const wasm = readFileSync(join(repository, "engine", "pkg", ENGINE_WASM));
  const sha256 = createHash("sha256").update(wasm).digest("hex");
  const qualified = JSON.parse(readFileSync(join(repository, "engine", "qualified-engine.json"), "utf8"));
  if (alias === undefined) checkQualifiedEngine(sha256, qualified.sha256);
  const engineKey = engineWasmKey(qualified.sha256, ENGINE_WASM);
  const app = join(repository, "app");
  const library = readFileSync(join(app, ".env"), "utf8").match(/^ASSET_BASE_URL=(https:\/\/\S+)$/m)?.[1];
  if (!library) throw new Error("app/.env must name the public HTTPS library in ASSET_BASE_URL");
  const url = `${library.replace(/\/$/, "")}/${engineKey}`;
  if (!await publishedEngineExists(url)) {
    if (alias !== undefined) {
      reportPreview(`Preview skipped: the recorded qualified engine is not published at ${url}. GPU qualification and publication must finish outside CI.`);
      return;
    }
    throw new Error(`Qualified engine is not published at ${url}. Nothing was deployed.`);
  }
  if (alias !== undefined && sha256 !== qualified.sha256) {
    reportPreview(`Preview skipped: built engine ${sha256} differs from qualified ${qualified.sha256}. Qualify the CI artifact before previewing it.`);
    return;
  }
  if (!ci) run("pnpm", ["install", "--frozen-lockfile"], app);
  run("pnpm", ["build"], app, { ASSET_ENGINE_WASM: engineKey });
  writeFileSync(join(app, "dist", ".assetsignore"), "# Engine served by the public library.\n*.wasm\n");

  const gallery = join(repository, "gallery");
  if (!ci) run("pnpm", ["install", "--frozen-lockfile"], gallery);
  const message = `${revision} ${commit}`;
  if (alias !== undefined) {
    const temporary = mkdtempSync(join(tmpdir(), "dinodreamer-preview-"));
    try {
      const output = join(temporary, "wrangler.jsonl");
      console.log(run("pnpm", ["exec", "wrangler", "versions", "upload", "--preview-alias", alias, "--message", message], gallery, {
        WRANGLER_OUTPUT_FILE_PATH: output,
      }));
      const url = previewUrl(readFileSync(output, "utf8"));
      reportPreview(`Preview: ${url}`, url);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    return;
  }

  console.log(run("pnpm", ["exec", "wrangler", "deploy", "--message", message], gallery));
  console.log(`Deployed ${revision} at ${commit} with engine ${engineKey}`);
  const assets = readdirSync(join(app, "dist", "assets")).filter((name) => !name.endsWith(".wasm"));
  await waitForBuild(readFileSync(join(app, "dist", "index.html"), "utf8"), assets);
  execFileSync(process.execPath, [join(gallery, "check-deployment.ts"), PRODUCTION, ...(args.includes("--without-gpu") ? ["--without-gpu"] : [])], {
    stdio: "inherit",
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
