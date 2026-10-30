// Deploy the committed app and Worker:
//   pnpm run deploy [revision] [--without-gpu] [--engine-sha256=<hex>]   (default main)
//
// 1. Check out main HEAD in a separate worktree, ../dinodreamer-public-deploy, so edits
//    in progress in the shared checkout never reach production.
// 2. Build the engine there, and upload its .wasm to the library bucket under
//    app/<content hash>/. Workers static assets refuse files over 25 MiB, and the
//    engine is larger; the bucket serves it with the CDN, CORS and immutable caching.
//    With --engine-sha256, the built .wasm must have that SHA-256: the runtime package
//    built from the numerically qualified engine revision; otherwise the deploy stops here, before anything is uploaded or deployed.
//    The Chrome qualification itself runs a separate harness build (--features harness),
//    so this hash is the identity of the runtime package, not of the bytes it tested.
// 3. Build the app with ASSET_ENGINE_WASM naming that object, exclude *.wasm from the
//    static assets, and deploy the Worker with the commit in its version message.
// 4. Wait until production serves the new build, then run the deployment check (check-deployment.ts)
//    against it; a failure fails the deploy. With --without-gpu, the deployment check runs
//    the pages on the fake engine; run pnpm run check:deployment separately to check the engine.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RestBucket, wranglerToken } from "./src/rest-bucket.ts";
import { CACHE_IMMUTABLE, PUBLIC_BUCKET, engineWasmKey, listKeys } from "./src/storage.ts";
import { DINODREAMER_ORIGIN } from "./src/site-location.ts";

const GALLERY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(GALLERY, "..");
const WORKTREE = resolve(REPOSITORY, "..", "dinodreamer-public-deploy");
const ARGS = process.argv.slice(2);
// A revision other than main deploys a known-good commit while main is mid-change.
const REVISION = ARGS.find((arg) => !arg.startsWith("--")) ?? "main";
const CHECK_WITHOUT_GPU = ARGS.includes("--without-gpu");
// The reviewed runtime package's full SHA-256, built from the qualified engine revision.
const REVIEWED_ENGINE_SHA256 = ARGS.find((arg) => arg.startsWith("--engine-sha256="))?.split("=")[1] ?? null;
if (REVIEWED_ENGINE_SHA256 !== null && !/^[0-9a-f]{64}$/.test(REVIEWED_ENGINE_SHA256)) {
  throw new Error(`--engine-sha256 must be 64 lowercase hex digits, not ${REVIEWED_ENGINE_SHA256}`);
}
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

function checkoutMain(): string {
  if (!existsSync(WORKTREE)) run("git", ["worktree", "add", "--detach", WORKTREE, REVISION], REPOSITORY);
  else run("git", ["checkout", "--detach", REVISION], WORKTREE);
  return run("git", ["rev-parse", "HEAD"], WORKTREE).trim();
}

/**
 * With --engine-sha256: the engine this deploy built is the reviewed runtime package, byte for
 * byte. The same source and command can still give other bytes (another toolchain, another path
 * in a panic message); then the reviewed package is not the one that would ship, and that needs
 * reconciling by hand, not a deploy.
 */
function checkQualifiedEngine(wasm: Uint8Array): void {
  const built = createHash("sha256").update(wasm).digest("hex");
  if (REVIEWED_ENGINE_SHA256 === null) {
    console.log(`Engine built: sha256 ${built} (no reviewed SHA-256 given)`);
    return;
  }
  if (built !== REVIEWED_ENGINE_SHA256) {
    throw new Error(
      `the engine built at ${REVISION} has sha256 ${built}, not the reviewed ${REVIEWED_ENGINE_SHA256}; nothing was uploaded or deployed`,
    );
  }
  console.log(`Engine built: sha256 ${built}, the reviewed runtime package`);
}

async function uploadEngine(wasm: Uint8Array, library: RestBucket): Promise<string> {
  const sha256 = createHash("sha256").update(wasm).digest("hex");
  const key = engineWasmKey(sha256, ENGINE_WASM);
  if ((await listKeys(library, key)).includes(key)) {
    console.log(`Engine already published: ${key}`);
  } else {
    await library.put(key, wasm, { httpMetadata: { contentType: "application/wasm", cacheControl: CACHE_IMMUTABLE } });
    console.log(`Published the engine: ${key} (${wasm.length} bytes, sha256 ${sha256})`);
  }
  return key;
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

const commit = checkoutMain();
run("wasm-pack", ["build", "--target", "web", "--release"], join(WORKTREE, "engine"));
const wasm = new Uint8Array(readFileSync(join(WORKTREE, "engine", "pkg", ENGINE_WASM)));
checkQualifiedEngine(wasm);
const library = new RestBucket(PUBLIC_BUCKET, wranglerToken(GALLERY));
const engineKey = await uploadEngine(wasm, library);

const app = join(WORKTREE, "app");
run("pnpm", ["install", "--frozen-lockfile"], app);
run("pnpm", ["build"], app, { ASSET_ENGINE_WASM: engineKey });
writeFileSync(join(app, "dist", ".assetsignore"), "# Served from the library bucket; see gallery/deploy.ts.\n*.wasm\n");

const gallery = join(WORKTREE, "gallery");
run("pnpm", ["install", "--frozen-lockfile"], gallery);
console.log(run("pnpm", ["exec", "wrangler", "deploy", "--message", `${REVISION} ${commit}`], gallery));
console.log(`Deployed ${REVISION} at ${commit} with engine ${engineKey}`);
// The .wasm is excluded from the static assets (.assetsignore above); the bucket serves it.
const assets = readdirSync(join(app, "dist", "assets")).filter((name) => !name.endsWith(".wasm"));
await waitForBuild(readFileSync(join(app, "dist", "index.html"), "utf8"), assets);
// A deploy that breaks /create or the gallery's checks fails loudly here.
execFileSync(process.execPath, [join(GALLERY, "check-deployment.ts"), PRODUCTION, ...(CHECK_WITHOUT_GPU ? ["--without-gpu"] : [])], { stdio: "inherit" });
