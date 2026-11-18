// Deployment check: pnpm run check:deployment [base URL] [--without-gpu] (default https://dinodreamer.computervision.vision)
//
// It uses headless Chrome with WebGPU and a fresh profile, as a first-time visitor would.
//   1. GET /api/gallery answers an entries list.
//   2. A submission with block 16384 is refused: the release has 16,384 blocks (0 … 16383).
//      A valid submission without a Turnstile token is refused with 403, so nothing is stored.
//      A file that the build does not have under /assets/ answers 404, not index.html.
//   3. /create: a first visit shows "Load the model" in place of Run, and nothing of the
//      engine downloads before the press. The press loads the engine and runs; with
//      nothing enabled, the run is refused ("Nothing to optimize").
//   4. With TV smoothness on (weight 1), one Step reaches step 1. The engine .wasm comes
//      from the library bucket (app/<content hash>/), not from the Worker.
// Any failed request, page error or console error fails the check. Deploy runs it last.
//
// --without-gpu is for a time when a research job holds this Mac's GPU: a second GPU user
// slows it and can corrupt its results. Chrome runs with the GPU disabled and the app with
// the fake engine (?engine=fake), which loads no .wasm. Explore's cards with their clouds, the
// block page and a block panel with its provenance record come first. Then 3 and 4 run on the fake
// engine, which has no download gate: a Step with nothing enabled is refused at once. Run
// the full check when the GPU is free: only it loads the engine.

import { chromium, type Page } from "playwright-core";
import { CELLS, OPTIMIZER_DEFAULT, type Recipe } from "../app/src/recipe.ts";

const ARGS = process.argv.slice(2);
const WITHOUT_GPU = ARGS.includes("--without-gpu");
const BASE = (ARGS.find((arg) => !arg.startsWith("--")) ?? "https://dinodreamer.computervision.vision").replace(/\/$/, "");
const ENGINE_WASM = /\/app\/[0-9a-f]{16}\/dinodreamer_engine_bg\.wasm$/;
const ENGINE_READY_MS = 180_000;
const STEP_MS = 120_000;
// Library files on a first visit, through the CDN.
const PAGE_MS = 60_000;
// A patch block with a published provenance record (table 0b11859663634baf, 13,086 tokens).
const PROVENANCE_BLOCK = 815;
// A 1 × 1 PNG; the Worker checks only the signature and the size.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (character) => character.charCodeAt(0),
);

const started = Date.now();
function log(message: string): void {
  console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function recipeWithBlock(block: number): Recipe {
  const token = { imageId: 7, role: "patch" as const, slot: 141 };
  const area = Array.from({ length: CELLS }, (_, cell) => cell === 136 ? 100 : 0);
  return {
    format: 7,
    release: "pass-003",
    seed: 1,
    requests: [
      {
        id: 1,
        block,
        respondLike: {
          enabled: true, weight: 0.3, source: token, code: [1, 0, 0], target: { kind: "point" }, radius: 1, where: area, alsoBlocks: [],
        },
        lookLike: { enabled: false, weight: 1, references: [], where: area },
      },
    ],
    protect: Array.from({ length: CELLS }, () => false),
    rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: false, weight: 0 } },
    motion: { zoomPerUpdate: 0 },
    optimizer: { ...OPTIMIZER_DEFAULT },
  };
}

/** POST a submission without a Turnstile token; the deployment check only sends submissions that must be refused. */
async function submitWithoutToken(recipe: Recipe): Promise<{ status: number; body: { id?: string; error?: string } }> {
  const form = new FormData();
  form.append("image", new Blob([PNG], { type: "image/png" }), "image.png");
  form.append("recipe", new Blob([JSON.stringify(recipe)], { type: "application/json" }), "recipe.json");
  form.append("title", "deployment check: must be refused");
  const response = await fetch(`${BASE}/api/submissions`, { method: "POST", body: form });
  return { status: response.status, body: (await response.json()) as { id?: string; error?: string } };
}

async function checkGalleryApi(): Promise<void> {
  const gallery = await fetch(`${BASE}/api/gallery`);
  const index = (await gallery.json()) as { entries?: unknown };
  const entries = Array.isArray(index.entries) ? index.entries : null;
  check(gallery.ok && entries !== null, `GET /api/gallery answered ${gallery.status} without an entries list`);
  const outside = await submitWithoutToken(recipeWithBlock(16384));
  check(outside.status === 400 && (outside.body.error ?? "").includes("outside the basis collection"), `block 16384 was not refused: ${outside.status} ${JSON.stringify(outside.body)}`);
  // The form rules pass, so only Turnstile can refuse it. A Worker without TURNSTILE_SECRET refuses every
  // submission with 503 ("submissions are closed"), the block-16384 check above included.
  const tokenless = await submitWithoutToken(recipeWithBlock(6));
  check(tokenless.status === 403, `a valid submission without a Turnstile token was not refused: ${tokenless.status} ${JSON.stringify(tokenless.body)}`);
  log(`gallery: ${entries?.length} published entries; block 16384 refused (400); no Turnstile token refused (403)`);
}

/** A tab from an earlier build asks for files a deploy removed; they must fail as 404, not run index.html. */
async function checkMissingBuildFile(): Promise<void> {
  const missing = await fetch(`${BASE}/assets/engine.worker-smoke000.js`);
  const type = missing.headers.get("content-type") ?? "";
  check(missing.status === 404 && !type.includes("html"), `a file missing from the build answered ${missing.status} ${type}`);
  log("a file missing from /assets/ answers 404");
}

async function stepCounter(page: Page): Promise<string> {
  return page.locator(".transport-step").innerText();
}

/** Steps 3 and 4 on the real engine: the fresh profile has never loaded the model, so Canvas asks first. */
async function checkCreate(page: Page): Promise<void> {
  await page.goto(`${BASE}/create`, { waitUntil: "domcontentloaded" });
  check(await page.evaluate(() => "gpu" in navigator), "this Chrome has no WebGPU");
  // The gate: app/src/features/editor/run/model-download.ts.
  const load = page.getByRole("button", { name: "Load the model", exact: true });
  await load.waitFor({ timeout: PAGE_MS });
  check(engine === null, "the engine .wasm was requested before Load the model");
  await load.click();
  await page.getByText(/refused: Nothing to optimize/).waitFor({ timeout: ENGINE_READY_MS });
  log(`Load the model loaded the engine (${await stepCounter(page)}); a run with nothing enabled is refused`);
  await stepWithSmoothness(page);
}

/** Steps 3 and 4 on the fake engine, which has no download gate (e33ea66): Step works at once. */
async function checkCreateWithFakeEngine(page: Page): Promise<void> {
  await page.goto(`${BASE}/create?engine=fake`, { waitUntil: "domcontentloaded" });
  const step = page.getByRole("button", { name: "Step", exact: true });
  await step.click({ timeout: PAGE_MS });
  await page.getByText(/refused: Nothing to optimize/).waitFor({ timeout: PAGE_MS });
  check((await page.getByRole("button", { name: "Load the model" }).count()) === 0, "the fake engine asks to load the model");
  log("fake engine: no Load the model; a Step with nothing enabled is refused");
  await stepWithSmoothness(page);
}

/** Step 4: TV smoothness on at weight 1, then one Step reaches step 1. */
async function stepWithSmoothness(page: Page): Promise<void> {
  // The names are TERM_TEXT.tv.name in app/src/features/editor/presentation.ts.
  await page.getByRole("switch", { name: "Smoothness", exact: true }).click();
  const weight = page.getByRole("spinbutton", { name: "Smoothness weight" });
  await weight.fill("1");
  await weight.press("Enter");
  const clicked = Date.now();
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await page.locator(".transport-step").filter({ hasText: /^step 1$/ }).waitFor({ timeout: STEP_MS });
  // Includes installing the changed recipe before the update, and the page's polling.
  log(`one Step with TV smoothness reached step 1 in ${((Date.now() - clicked) / 1000).toFixed(2)} s after the click`);
}

/** Explore's cards and clouds, the block page and the block panel of PROVENANCE_BLOCK, on the fake engine. */
async function checkLibraryPages(page: Page): Promise<void> {
  // Index cards must decode and draw their block clouds; HTTP 200 alone does not establish that.
  await page.goto(`${BASE}/index?engine=fake`, { waitUntil: "domcontentloaded" });
  const cards = page.locator(".atlas-cloud-card");
  await cards.first().waitFor({ timeout: PAGE_MS });
  await page.waitForTimeout(5_000);
  const failed = await page.getByText("This response plot could not be loaded.").count();
  check(failed === 0, `${failed} of the Index's ${await cards.count()} cards could not load their response plot`);
  log(`Index: ${await cards.count()} cards, every response plot loaded`);

  await page.goto(`${BASE}/basis/${PROVENANCE_BLOCK}?engine=fake`, { waitUntil: "domcontentloaded" });
  await page.locator("#look-cloud-title").waitFor({ timeout: PAGE_MS });
  log(`basis group ${PROVENANCE_BLOCK}, Inspect: its response plot section`);

  // The panel over the Image editor is the one basis group panel (0d266563: the editor's older block
  // panel and its provenance bar left), with the group's response plot section.
  await page.goto(`${BASE}/create/basis/${PROVENANCE_BLOCK}?role=patch&engine=fake`, { waitUntil: "domcontentloaded" });
  await page.getByRole("dialog", { name: `Basis group ${PROVENANCE_BLOCK}`, exact: true }).waitFor({ timeout: PAGE_MS });
  await page.locator("dialog #look-cloud-title").waitFor({ timeout: PAGE_MS });
  log(`block ${PROVENANCE_BLOCK} panel over Create: the basis group panel with its response plot section`);
}

const problems: string[] = [];
let engine: { url: URL; status: number; type: string } | null = null;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: WITHOUT_GPU ? ["--disable-gpu"] : [] });
try {
  await checkGalleryApi();
  await checkMissingBuildFile();
  const context = await browser.newContext();
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (ENGINE_WASM.test(url.pathname)) engine = { url, status: response.status(), type: response.headers()["content-type"] ?? "" };
    if (response.status() >= 400) problems.push(`HTTP ${response.status()} ${response.url()}`);
  });
  context.on("requestfailed", (request) => problems.push(`failed ${request.url()}: ${request.failure()?.errorText}`));
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error: ${message.text()}`);
  });
  const loaded = () => engine as { url: URL; status: number; type: string } | null;
  if (WITHOUT_GPU) {
    await checkLibraryPages(page);
    await checkCreateWithFakeEngine(page);
    check(loaded() === null, `the fake engine requested the engine .wasm: ${loaded()?.url}`);
  } else {
    await checkCreate(page);
    const wasm = loaded();
    check(wasm !== null, "the engine .wasm was never requested");
    const source = `${wasm!.status} ${wasm!.type} ${wasm!.url}`;
    check(wasm!.status === 200 && wasm!.type === "application/wasm" && wasm!.url.host !== new URL(BASE).host, `engine not loaded from the bucket: ${source}`);
    log(`engine: ${source}`);
  }
  check(problems.length === 0, `problems during the check:\n  ${problems.join("\n  ")}`);
  log(`deployment check passed for ${BASE}${WITHOUT_GPU ? " without the GPU; the engine is not checked" : ""}`);
} catch (error) {
  console.error(`DEPLOYMENT CHECK FAILED for ${BASE}: ${error instanceof Error ? error.message : String(error)}`);
  if (problems.length > 0) console.error(`  also: ${problems.join("\n  ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
