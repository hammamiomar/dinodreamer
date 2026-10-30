// Route check of the materials site, after a deploy or on a production-style local build:
//   node check-routes.ts <base URL> [--browser <chromium>] [--materials <expected count>] [--software]
//
// --software uses SwiftShader for playback and skips training, which is much slower on the CPU.
//   1. GET /api/materials answers the published index (with --materials, that many entries).
//   2. /admin and /admin/api/materials are closed to a stranger: the local owner of `wrangler dev`
//      is admitted (200), production answers with Cloudflare Access's sign-in redirect.
//   3. Each route loads without a page error, a console error or a failed request, and Explore draws
//      its block clouds: HTTP 200 alone does not establish that their format can be decoded.
//   4. With materials published: block 12002 lists its materials, and the home and the Playground each
//      show a canvas whose picture changes within two seconds (a material growing).
//   5. Without --software: Grow on block 12002 reaches update 40 with the dictionary reader loaded
//      (32 parts from the library bucket), then stops.
// A failed check prints FAIL and the run exits 1.

import { chromium, type Locator, type Page } from "playwright-core";
import { platform } from "node:os";
import { parseArgs } from "node:util";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { browser: { type: "string" }, materials: { type: "string" }, software: { type: "boolean", default: false } },
});
const BASE = (positionals[0] ?? "https://dinodreamer.computervision.vision").replace(/\/$/, "");
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE);
const ROUTES = ["/", "/index", "/basis/12002", "/automata", "/train?block=12002", "/how", "/canvas"];
const GROW_UPDATES = 40;
const GROW_MS = 240_000;
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);

async function checkApi(): Promise<number> {
  const response = await fetch(`${BASE}/api/materials`);
  const entries = response.ok ? ((await response.json()) as { entries?: unknown[] }).entries : undefined;
  const count = Array.isArray(entries) ? entries.length : -1;
  const expected = options.materials === undefined ? null : Number(options.materials);
  check("GET /api/materials answers the index", count >= 0 && (expected === null || count === expected), `HTTP ${response.status}, ${count} entries`);
  for (const path of ["/admin", "/admin/api/materials"]) {
    const answer = await fetch(`${BASE}${path}`, { redirect: "manual" });
    const location = answer.headers.get("location") ?? "";
    const closed = LOCAL ? answer.status === 200 : answer.status >= 300 && answer.status < 400 && /\.cloudflareaccess\.com\//.test(location);
    check(`${path} is the owner's only`, closed, `HTTP ${answer.status}${location ? ` to ${new URL(location).host}` : ""}`);
  }
  return count;
}

/** Two pictures of the canvas two seconds apart differ: something is growing on it. */
async function checkGrowing(name: string, canvas: Locator): Promise<void> {
  try {
    await canvas.waitFor({ timeout: 60_000 });
    const first = await canvas.screenshot();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    check(name, !first.equals(await canvas.screenshot()));
  } catch (error) {
    check(name, false, String(error).split("\n")[0]);
  }
}

async function checkGrow(page: Page): Promise<void> {
  await page.goto(`${BASE}/train?block=12002`);
  const panel = page.locator(".grow-panel");
  await panel.getByRole("button", { name: "Train", exact: true }).click({ timeout: 60_000 });
  const reached = await page.waitForFunction((target) => {
    const text = document.querySelector(".grow-panel")?.textContent ?? "";
    const update = Number(/Optimizer update ([\d,]+)/.exec(text)?.[1]?.replaceAll(",", "") ?? 0);
    return update >= target && !text.includes("Loading the image analyzer") ? text : false;
  }, GROW_UPDATES, { timeout: GROW_MS }).then((handle) => handle.jsonValue() as Promise<string>).catch(() => null);
  const text = (await panel.textContent()) ?? "";
  check(`Train reaches optimizer update ${GROW_UPDATES} with the image analyzer loaded`, reached !== null, text.replace(/\s+/g, " ").slice(0, 160));
  const stop = panel.getByRole("button", { name: "Stop" });
  if (await stop.count()) await stop.click();
}

const count = await checkApi();
const VULKAN = ["--enable-gpu", "--enable-unsafe-webgpu", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-vulkan-surface"];
const SOFTWARE = ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader", "--use-angle=swiftshader"];
const linux = platform() === "linux";
const browser = await chromium.launch({
  ...(options.browser ? { executablePath: options.browser } : { channel: "chrome" }),
  headless: true,
  args: options.software ? SOFTWARE : linux ? VULKAN : [],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`HTTP ${response.status()} ${response.url()}`); });
  for (const route of ROUTES) {
    problems.length = 0;
    await page.goto(`${BASE}${route}`, { waitUntil: "load" });
    await page.waitForTimeout(4_000);
    check(`${route} loads cleanly`, problems.length === 0, problems.slice(0, 3).join(" | "));
    if (route === "/index") {
      const failed = await page.getByText("This response plot could not be loaded.").count();
      const cards = await page.locator(".atlas-cloud-card").count();
      check("the Index draws its response plots", failed === 0 && cards > 0, `${cards} cards, ${failed} response plots not loaded`);
    }
    if (route === "/") {
      const adapter = await page.evaluate(async () => {
        const info = (await navigator.gpu?.requestAdapter())?.info;
        return info ? `${info.vendor} ${info.architecture}` : null;
      });
      check("this browser has WebGPU", adapter !== null, adapter ?? "no adapter");
    }
  }
  if (count > 0) {
    await page.goto(`${BASE}/`);
    await checkGrowing("the home runs an automaton", page.locator(".home-field canvas").first());
    await page.goto(`${BASE}/basis/12002`);
    const tiles = await page.locator(".look-material").first().waitFor({ timeout: 60_000 }).then(() => page.locator(".look-material").count(), () => 0);
    check("basis group 12002 lists its automata", tiles > 0, `${tiles} tiles`);
    await page.goto(`${BASE}/automata`);
    await checkGrowing("Automata runs an automaton", page.locator(".material-stage canvas").first());
  } else {
    results.push("SKIP automaton playback: no automaton is published yet");
  }
  if (options.software) results.push("SKIP Train: software WebGPU");
  else await checkGrow(page).catch((error) => check("Train reaches an optimizer update", false, String(error).split("\n")[0]));
} finally {
  await browser.close();
}
console.log(`${BASE}\n${results.join("\n")}`);
process.exitCode = results.some((line) => line.startsWith("FAIL")) ? 1 : 0;
