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

async function finishTravel(page) {
  // The pager owns a 640 ms animation, even after the rounded scroll offset settles.
  await page.waitForTimeout(680);
}

async function positions(page) {
  return page.evaluate(() => ({ y: window.scrollY, beat: document.querySelector(".home").dataset.beat }));
}

for (const reducedMotion of ["no-preference", "reduce"]) {
  test(`a continuous wheel stream advances one section with ${reducedMotion} motion`, () => home(desktop, {
    viewport: { width: 1440, height: 900 }, reducedMotion,
  }, async (page) => {
    const stops = await page.locator(".home-beat").evaluateAll((sections) => sections.map((section) => section.getBoundingClientRect().top + window.scrollY));
    await page.mouse.move(350, 600);
    const events = [];
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        events.push(page.mouse.wheel(0, 40));
        if (events.length === 100) {
          clearInterval(interval);
          resolve();
        }
      }, 20);
    });
    await Promise.all(events);
    await page.waitForFunction((top) => Math.abs(window.scrollY - top) < 2, stops[0], { timeout: 2000 });
    await finishTravel(page);
    assert.equal((await positions(page)).beat, "model");
    await page.keyboard.press("PageDown");
    await page.waitForFunction((top) => Math.abs(window.scrollY - top) < 2, stops[1], { timeout: 2000 });
    await page.waitForFunction(() => document.querySelector(".home")?.dataset.beat === "basis");
  }));
}

for (const width of [320, 360, 390, 430]) {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    test(`iPhone WebKit advances through readable sections at ${width}px with ${reducedMotion} motion`, () => home(mobile, {
      ...devices["iPhone 13"], viewport: { width, height: 844 }, reducedMotion,
    }, async (page) => {
      await page.locator(".home-down").tap();
      await page.waitForFunction(() => document.querySelector(".home")?.dataset.beat === "model");
      // Wait for the bounded section animation to finish before the next gesture.
      await page.waitForFunction(() => {
        const top = document.querySelector('.home-beat[data-beat="model"]').getBoundingClientRect().top;
        return Math.abs(top - innerHeight * 0.6) < 2;
      });
      await finishTravel(page);
      let before = await positions(page);
      for (let gesture = 0; gesture < 8 && before.beat !== "end"; gesture++) {
        // Playwright exposes taps, but no native WebKit swipe. Send the same
        // touch events the pager receives, then observe its actual document scroll.
        await page.evaluate(() => {
          const target = document.querySelector(".home-words");
          for (const [type, y] of [["touchstart", 700], ["touchmove", 500], ["touchend", null]]) {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, "touches", { value: y === null ? [] : [{ clientX: 200, clientY: y }] });
            target.dispatchEvent(event);
          }
        });
        await page.waitForFunction((previous) => window.scrollY - previous > 50, before.y, { timeout: 2000 });
        await finishTravel(page);
        before = await positions(page);
      }
      assert.equal(before.beat, "end");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }));
  }
}
