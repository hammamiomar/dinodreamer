// Deploy a committed revision, or the current CI checkout:
//   pnpm run deploy [revision] [--ci] [--without-gpu] [--preview-alias=pr-<number>]
// CI builds engine/pkg first. Local runs create a temporary worktree under DEPLOY_WORKTREE or the system temp directory.
// Engine publication belongs to GPU qualification: this script only checks its public URL.
// Releases require engine/qualified-engine.json to match the built WASM exactly.
// A preview uploads a Worker version without changing production traffic. In GitHub it reports its alias
// only: the address holds the account's workers.dev subdomain, which Cloudflare takes from the account's
// email, and the repository's logs and comments are public.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { libraryCdnBaseUrl } from "./review-cli.ts";
import { engineWasmKey } from "./src/storage.ts";
import { DINODREAMER_ORIGIN } from "./src/site-location.ts";

const GALLERY = import.meta.dirname;
const REPOSITORY = resolve(GALLERY, "..");
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

/** Resolve the revision in its source repository. Keep the checkout private to this invocation
 * until the build and its checks finish, including when another release runs at the same time.
 */
export async function withReleaseCheckout(
  repository: string,
  revision: string,
  parent: string,
  operation: (directory: string, commit: string) => Promise<void>,
): Promise<void> {
  const commit = run("git", ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], repository).trim();
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "dinodreamer-deploy-"));
  try {
    run("git", ["worktree", "add", "--detach", directory, commit], repository);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  try {
    const checkedOut = run("git", ["rev-parse", "HEAD"], directory).trim();
    if (checkedOut !== commit) throw new Error(`Expected to build ${commit}, but the worktree contains ${checkedOut}`);
    await operation(directory, commit);
  } finally {
    run("git", ["worktree", "remove", "--force", directory], repository);
  }
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

/** Extract the account's workers.dev subdomain from a Worker URL such as https://pr-7-dinodreamer-public.<subdomain>.workers.dev. */
export function workersSubdomain(url: string): string {
  const subdomain = /\.([a-z0-9-]+)\.workers\.dev$/.exec(new URL(url).hostname)?.[1];
  if (subdomain === undefined) throw new Error(`Not a workers.dev address: ${url}`);
  return subdomain;
}

/** Read the preview alias URL from Wrangler's JSON-lines output rather than its console text. */
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

/** Return paths where production does not yet serve the new build, or an empty array when ready. */
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

function reportPreview(message: string): void {
  console.log(message);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `message=${message}\n`);
}

interface DeployOptions {
  revision: string;
  ci: boolean;
  withoutGpu: boolean;
  alias: string | undefined;
}

interface PreparedBuild {
  app: string;
  gallery: string;
  commit: string;
  engineKey: string;
  message: string;
}

export function parseDeployOptions(args: string[]): DeployOptions {
  const { values, positionals, tokens } = parseArgs({
    args,
    allowPositionals: true,
    tokens: true,
    options: {
      ci: { type: "boolean", default: false },
      "without-gpu": { type: "boolean", default: false },
      "preview-alias": { type: "string" },
    },
  });
  const revision = positionals[0] ?? "main";
  if (positionals.length > 1 || !revision || revision.startsWith("-")) throw new Error("Specify at most one Git revision");
  const alias = values["preview-alias"];
  const aliases = tokens.filter((token) => token.kind === "option" && token.name === "preview-alias");
  if (alias !== undefined && (!/^pr-[1-9][0-9]*$/.test(alias) || aliases.length !== 1 || !aliases[0]?.inlineValue)) {
    throw new Error("Use one --preview-alias=pr-<number> option");
  }
  return { revision, ci: values.ci, withoutGpu: values["without-gpu"], alias };
}

/** Verify the qualified engine and build the app bundle. Returns null when a PR preview is skipped. */
async function prepareBuild(options: DeployOptions, repository: string, commit: string): Promise<PreparedBuild | null> {
  if (!options.ci) run("wasm-pack", ["build", "--target", "web", "--release", "--", "--locked"], join(repository, "engine"));

  const wasm = readFileSync(join(repository, "engine", "pkg", ENGINE_WASM));
  const sha256 = createHash("sha256").update(wasm).digest("hex");
  const qualified = JSON.parse(readFileSync(join(repository, "engine", "qualified-engine.json"), "utf8")) as { sha256: string };
  if (options.alias === undefined) checkQualifiedEngine(sha256, qualified.sha256);

  const engineKey = engineWasmKey(qualified.sha256, ENGINE_WASM);
  const app = join(repository, "app");
  const url = `${libraryCdnBaseUrl(join(app, ".env"))}/${engineKey}`;
  if (!(await publishedEngineExists(url))) {
    if (options.alias !== undefined) {
      reportPreview(`Preview skipped: the recorded qualified engine is not published at ${url}. GPU qualification and publication must finish outside CI.`);
      return null;
    }
    throw new Error(`Qualified engine is not published at ${url}. Nothing was deployed.`);
  }
  if (options.alias !== undefined && sha256 !== qualified.sha256) {
    reportPreview(`Preview skipped: built engine ${sha256} differs from qualified ${qualified.sha256}. Qualify the CI artifact before previewing it.`);
    return null;
  }

  if (!options.ci) run("pnpm", ["install", "--frozen-lockfile"], app);
  run("pnpm", ["build"], app, { ASSET_ENGINE_WASM: engineKey });
  writeFileSync(join(app, "dist", ".assetsignore"), "# Engine served by the public library.\n*.wasm\n");

  const gallery = join(repository, "gallery");
  if (!options.ci) run("pnpm", ["install", "--frozen-lockfile"], gallery);
  return { app, gallery, commit, engineKey, message: `${options.revision} ${commit}` };
}

function uploadPreview(build: PreparedBuild, alias: string): void {
  const temporary = mkdtempSync(join(tmpdir(), "dinodreamer-preview-"));
  try {
    const output = join(temporary, "wrangler.jsonl");
    const uploaded = run("pnpm", ["exec", "wrangler", "versions", "upload", "--preview-alias", alias, "--message", build.message], build.gallery, {
      WRANGLER_OUTPUT_FILE_PATH: output,
    });
    const url = previewUrl(readFileSync(output, "utf8"));
    const inGitHub = process.env.GITHUB_ACTIONS === "true";
    // Mask the account's workers.dev subdomain before logging Wrangler output in public GitHub logs.
    if (inGitHub) console.log(`::add-mask::${workersSubdomain(url)}`);
    console.log(uploaded);
    reportPreview(inGitHub ? `Preview ${alias} is ready behind Cloudflare Access.` : `Preview: ${url}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function deployProduction(build: PreparedBuild, options: DeployOptions): Promise<void> {
  console.log(run("pnpm", ["exec", "wrangler", "deploy", "--message", build.message], build.gallery));
  console.log(`Deployed ${options.revision} at ${build.commit} with engine ${build.engineKey}`);
  const assets = readdirSync(join(build.app, "dist", "assets")).filter((name) => !name.endsWith(".wasm"));
  await waitForBuild(readFileSync(join(build.app, "dist", "index.html"), "utf8"), assets);
  execFileSync(process.execPath, [join(build.gallery, "check-deployment.ts"), PRODUCTION, ...(options.withoutGpu ? ["--without-gpu"] : [])], {
    stdio: "inherit",
  });
}

async function main(): Promise<void> {
  const options = parseDeployOptions(process.argv.slice(2));
  const deploy = async (repository: string, commit: string) => {
    const build = await prepareBuild(options, repository, commit);
    if (build === null) return;
    if (options.alias !== undefined) uploadPreview(build, options.alias);
    else await deployProduction(build, options);
  };
  if (options.ci) {
    await deploy(REPOSITORY, run("git", ["rev-parse", "HEAD"], REPOSITORY).trim());
  } else {
    await withReleaseCheckout(REPOSITORY, options.revision, resolve(process.env.DEPLOY_WORKTREE ?? tmpdir()), deploy);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await main();
