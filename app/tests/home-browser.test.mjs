// Run against `pnpm develop:fixtures`: node --test tests/home-browser.test.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, devices, webkit } from "../../gallery/node_modules/playwright-core/index.mjs";

const desktop = await chromium.launch({
  headless: true,
  ...(process.env.SHELL_BROWSER_EXECUTABLE ? { executablePath: process.env.SHELL_BROWSER_EXECUTABLE } : { channel: "chromium-headless-shell" }),
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
});
const mobile = await webkit.launch({ headless: true });
after(async () => { await desktop.close(); await mobile.close(); });
const base = process.env.SHELL_TEST_BASE_URL ?? "http://127.0.0.1:5179";

async function home(browser, options, run) {
  const page = await browser.newPage(options);
  try {
    // Exercise scrolling without starting an automaton on the host GPU.
    await page.addInitScript(() => { delete Navigator.prototype.gpu; });
    await page.goto(base);
    await page.locator(".home-down").waitFor();
    await run(page);
  } finally { await page.close(); }
}

for (const reducedMotion of ["no-preference", "reduce"]) {
  test(`a short wheel gesture scrolls part of the entrance with ${reducedMotion} motion`, () => home(desktop, {
    viewport: { width: 1440, height: 900 }, reducedMotion,
  }, async (page) => {
    const properties = page.locator('.home-beat[data-beat="properties"]');
    const top = await properties.evaluate((node) => node.getBoundingClientRect().top + scrollY);
    await page.mouse.move(350, 600);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => scrollY > 0);
    assert.ok(await page.evaluate(() => scrollY) < top / 2);
    assert.equal(await page.locator(".home").getAttribute("data-beat"), "entrance");
    await page.keyboard.press("PageDown");
    await page.waitForFunction(() => document.querySelector(".home").dataset.beat === "properties");
  }));
}

for (const width of [320, 360, 390, 430]) {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    test(`iPhone WebKit follows native scroll at ${width}px with ${reducedMotion} motion`, () => home(mobile, {
      ...devices["iPhone 13"], viewport: { width, height: 844 }, reducedMotion,
    }, async (page) => {
      await page.locator(".home-down").tap();
      const properties = page.locator('.home-beat[data-beat="properties"]');
      await page.waitForFunction(() => {
        const section = document.querySelector('.home-beat[data-beat="properties"]');
        const aligned = Math.abs(section.getBoundingClientRect().top - 64) < 4;
        return aligned && document.querySelector(".home").dataset.beat === "properties";
      });
      const initialY = await properties.evaluate(() => scrollY);
      await page.evaluate(() => scrollBy({ top: 24, behavior: "instant" }));
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - initialY - 24) <= 2);
      for (const beat of ["collection", "train", "keep"]) {
        const section = `.home-beat[data-beat="${beat}"]`;
        await page.locator(section).evaluate((node) => node.scrollIntoView({ behavior: "instant" }));
        await page.waitForFunction((expected) => document.querySelector(".home").dataset.beat === expected, beat);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }));
  }
}
