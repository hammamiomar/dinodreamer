// Owner-page regressions with local API responses; no review action reaches the server.
// node check-admin-page.ts <local Worker URL> [--browser <headless Chromium>]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium, type Route } from "playwright-core";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { browser: { type: "string" } },
});
const base = positionals[0] ?? "http://127.0.0.1:8794";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "Use a local Worker.");
const browser = await chromium.launch({
  headless: true,
  executablePath: options.browser,
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
});
const material = JSON.parse(readFileSync(new URL("seed/materials/block-4009-figure-strongest-mean-seed-0.material.json", import.meta.url), "utf8"));
const poster = Buffer.from(material.preview.split(",")[1], "base64");
const entry = {
  id: "20261029-120000-a1b2c3d4", title: "Owner review fixture", credit: "Fixture",
  release: "pass-003", submittedAt: "2026-10-29T12:00:00Z", publishedAt: "2026-10-29T12:00:00Z",
  state: "pending", blocks: [4009],
};

try {
  for (const width of [320, 390, 430, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("clipboard refused"); } } });
    });
    let releaseMaterials!: (route: Route) => void;
    const waitingMaterials = new Promise<Route>((resolve) => { releaseMaterials = resolve; });
    let slow = true;
    let failed = false;
    await page.route("**/admin/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/materials")) {
        if (slow) { releaseMaterials(route); return; }
        if (failed) return route.fulfill({ status: 503, json: { error: "temporary failure" } });
        return route.fulfill({ json: { pending: [], published: [], hidden: [] } });
      }
      if (path.endsWith("/entries")) return route.fulfill({ json: { owner: "owner@example.test", pending: [entry], published: [entry], hidden: [] } });
      if (path.endsWith("/purge")) return route.fulfill({ json: { cdnPurge: { prefix: "library.example.test/gallery/fixture/", place: "CDN settings" } } });
      if (path.endsWith(".png") || path.endsWith(".webp")) return route.fulfill({ body: poster, contentType: "image/png" });
      throw new Error(`Unexpected owner request: ${path}`);
    });
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    const held = await waitingMaterials;
    assert.equal(await page.locator("main button:enabled:visible").count(), 0, "Actions must wait for both lists");
    slow = false;
    await held.fulfill({ json: { pending: [], published: [], hidden: [] } });
    await page.waitForFunction(() => document.querySelector("#pending button")?.matches(":enabled"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px overflow`);
    assert.equal(await page.getByText("Nothing hidden.", { exact: true }).count(), 1);
    if (width < 500) assert.ok((await page.locator(".actions button").first().boundingBox())!.height >= 44, "Touch targets need 44px height");

    await page.getByRole("button", { name: "Reject", exact: true }).click();
    assert.equal(await page.locator("#confirm-cancel").evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#confirm").evaluate((node) => (node as HTMLDialogElement).open), false);

    await page.getByRole("button", { name: "Purge", exact: true }).click();
    await page.locator("#confirm-yes").focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Copy the prefix" }).click();
    await page.waitForFunction(() => document.querySelector('[data-kind="error"]') !== null);
    assert.deepEqual(errors, [], "Rejected clipboard promises must be handled");
    failed = true;
    await page.reload({ waitUntil: "networkidle" });
    assert.match(await page.locator("#notices").innerText(), /The lists did not load: temporary failure/);
    assert.deepEqual(errors, []);
    console.log(`PASS owner page ${width}px: slow loading, empty/error lists, touch targets, dialog keyboard, clipboard failure, overflow`);
    await context.close();
  }
} finally {
  await browser.close();
}
