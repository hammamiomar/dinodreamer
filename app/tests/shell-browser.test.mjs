// Run against `pnpm develop:fixtures`: node --test tests/shell-browser.test.mjs.
// Set SHELL_TEST_BASE_URL for another local server; SHELL_BROWSER_EXECUTABLE selects its Chromium shell.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../../gallery/node_modules/playwright-core/index.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.SHELL_BROWSER_EXECUTABLE ? { executablePath: process.env.SHELL_BROWSER_EXECUTABLE } : { channel: "chromium-headless-shell" }),
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
});
after(() => browser.close());
const base = process.env.SHELL_TEST_BASE_URL ?? "http://127.0.0.1:5179";
async function inPage(run) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  try { await run(page); } finally { await page.close(); }
}
const harness = (scenario) => `${base}/tests/ui-state-harness.html?case=${scenario}`;

test("a changed media query reports its current match without a resize", () => inPage(async (page) => {
  await page.goto(harness("media"));
  await page.getByRole("button", { name: "Change query" }).click();
  await page.waitForFunction(() => document.querySelector("output")?.textContent === "true", null, { timeout: 2000, polling: 50 });
}));

test("instant finishes an in-progress value transition", () => inPage(async (page) => {
  await page.goto(harness("moving"));
  await page.getByRole("button", { name: "Move", exact: true }).waitFor();
  // Hold animation frames so a failure cannot pass merely because 240 ms elapsed.
  await page.evaluate(() => { window.requestAnimationFrame = () => 1; });
  await page.getByRole("button", { name: "Move", exact: true }).evaluate((button) => button.click());
  await page.getByRole("button", { name: "Finish now" }).evaluate((button) => button.click());
  await page.waitForFunction(() => document.querySelector("output")?.textContent === "100", null, { timeout: 2000, polling: 50 });
}));

test("synchronous load failures remain in their views", () => inPage(async (page) => {
  await page.goto(harness("loading"));
  await page.locator("#loaded").waitFor();
  assert.equal(await page.locator("#loaded").textContent(), "Load failed");
  assert.equal(await page.locator("#sourced").textContent(), "Source failed");
}));

test("an old save cannot mark a new creation as saved", () => inPage(async (page) => {
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.releaseEncoding = () => encode.apply(this, args);
    };
  });
  await page.goto(harness("autosave"));
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "saving");
  await page.getByRole("button", { name: "New creation" }).click();
  await page.evaluate(() => window.releaseEncoding());
  await page.waitForFunction(() => document.querySelector("#completed")?.textContent === "1");
  assert.equal(await page.locator("#status").textContent(), "unsaved");
}));

test("a failed How training record reports its error", () => inPage(async (page) => {
  await page.route("**/how/training/featurizer-passes.json", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto(`${base}/how#basis-training`);
  await page.getByRole("alert").filter({ hasText: "503" }).waitFor({ timeout: 5000 });
  assert.equal(await page.getByRole("slider", { name: "Pass", exact: true }).count(), 0);
}));

test("a failed growth recording shows the exported picture", () => inPage(async (page) => {
  await page.route("**/how/visualization/*.mp4", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto(`${base}/how#visualization`);
  await page.waitForFunction(() => [...document.querySelectorAll(".how-painted video")].length === 2
    && [...document.querySelectorAll(".how-painted video")].every((video) => video.error));
  assert.equal(await page.locator(".how-painted[data-growing]").count(), 0);
}));

test("a failed attention layer reports its error even when another layer is selected", () => inPage(async (page) => {
  await page.route("**/how/recorded/**/attention-01.bin", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto(`${base}/how#attention`);
  await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some((node) => node.textContent.includes("503")), null, { timeout: 4000 });
}));

// These views need the published automaton. Use develop:remote and set
// SHELL_GALLERY_TEST_BASE_URL to that server to include the gallery-dependent checks.
for (const [section, pattern] of [
  ["signal", "**/story/story.json"],
  ["updates", "**/story/story.json"],
  ["local-global", "**/how/training/automaton-4009/attention-12.bin"],
]) {
  test(`a failed ${section} record reports its error`, { skip: !process.env.SHELL_GALLERY_TEST_BASE_URL }, () => inPage(async (page) => {
    let requested = false;
    await page.route(pattern, (route) => {
      requested = true;
      return route.fulfill({ status: 503, body: "unavailable" });
    });
    await page.goto(`${process.env.SHELL_GALLERY_TEST_BASE_URL}/how#${section}`);
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some((node) => node.textContent.includes("503")), null, { timeout: 5000 });
    assert.ok(requested);
  }));
}

for (const reason of ["no WebGPU", "loading"]) {
  test(`Home disables regrowing while it shows a still for ${reason}`, () => inPage(async (page) => {
    if (reason === "no WebGPU") await page.addInitScript(() => { delete Navigator.prototype.gpu; });
    // The entrance shows only the essay's automata (home-material.ts, ENTRANCE_AUTOMATA), so the index offers two of them.
    const entries = [["2088-guided-all-noise-seed-0", 2088], ["12240-plain-all-noise-seed-0", 12240]].map(([id, block]) => ({
      id, title: "Test automaton", credit: "", publishedAt: "2026-10-29", materialId: id,
      block, recipe: "test", band: "strongest", strength: 2, winnerFraction: 1, fired: true,
      side: 128, seed: 1, tick: 600, engine: "e", trainerCommit: "t", layout: "figure-16-96-torus-v1",
      start: "noise", pixelsPerCell: 1, featured: true,
    }));
    await page.route("**/api/materials", (route) => route.fulfill({ json: { entries } }));
    // Leave material requests pending to exercise the loading state.
    await page.route("**/api/materials/*/material.json", () => {});
    await page.goto(base);
    const reset = page.getByRole("button", { name: "Grow it again", exact: true });
    await reset.waitFor();
    assert.ok(await reset.isDisabled());
  }));
}

for (const width of [320, 360, 390, 430, 1440]) {
  test(`attention controls and axis labels fit at ${width}px`, () => inPage(async (page) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/how#attention`);
    await page.locator(".how-bars-axis").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const pane = document.querySelector(".how-attention-side").getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(".how-bars-axis span:last-child"));
      const label = range.getBoundingClientRect();
      range.selectNodeContents(document.querySelector(".how-attention-side .slider-value"));
      return { labelFits: label.right <= pane.right + 1, valueLines: range.getClientRects().length };
    });
    assert.ok(layout.labelFits);
    assert.equal(layout.valueLines, 1);
  }));
}
