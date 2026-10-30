// One focused browser regression for mobile How's scroll ownership.
// Run against a built app or the development server:
// node check-how-scroll.ts <base URL> [--browser <headless Chromium>] [--engine webkit]
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { chromium, webkit, type Page } from "playwright-core";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { browser: { type: "string" }, engine: { type: "string", default: "chromium" } },
});
assert.ok(options.engine === "chromium" || options.engine === "webkit", "Use chromium or webkit.");
const base = (positionals[0] ?? "http://127.0.0.1:5270").replace(/\/$/, "");
const browser = options.engine === "webkit"
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ headless: true, executablePath: options.browser, args: ["--disable-gpu"] });

/** Read the actual scroll owners, including descendants that can silently capture a gesture. */
async function scrollState(page: Page) {
  return page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>(".how, .how *")];
    const verticalOwners = elements.filter(element =>
      ["auto", "scroll"].includes(getComputedStyle(element).overflowY)
      && element.scrollHeight > element.clientHeight + 1,
    ).map(element => element.className);
    return {
      documentTop: window.scrollY,
      verticalOwners,
      internalOffsets: elements.filter(element => element.scrollTop !== 0).map(element => element.className),
    };
  });
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const touch = options.engine === "chromium" ? await context.newCDPSession(page) : null;
  for (const section of ["attention", "selection", "glossary"]) {
    await page.goto(`${base}/how#${section}`);
    await page.locator(".how-card h2").waitFor();
    if (section === "selection") {
      await page.waitForFunction(() => document.querySelectorAll(".how-response-bars button").length === 32);
    }
    assert.deepEqual((await scrollState(page)).verticalOwners, [], `${section}: a nested vertical scroll remains`);

    // Start in the explanation, then pass its top and reach the architecture without a handoff.
    await page.locator(".how-section-words").evaluate(element => {
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 160);
    });
    await page.waitForTimeout(100);
    assert.ok((await scrollState(page)).documentTop > 0, `${section}: the document must scroll`);
    for (let gesture = 0; gesture < 20 && (await scrollState(page)).documentTop > 0; gesture++) {
      const previous = await scrollState(page);
      if (touch) {
        await touch.send("Input.synthesizeScrollGesture", {
          x: 190, y: 300, yDistance: 350, speed: 650, gestureSourceType: "touch",
        });
      } else {
        // Playwright does not provide touch scrolling or wheel input for mobile WebKit.
        await page.keyboard.press("PageUp");
        await page.waitForTimeout(150);
      }
      const current = await scrollState(page);
      assert.ok(current.documentTop < previous.documentTop, `${section}: upward input stopped inside the page`);
      assert.deepEqual(current.internalOffsets, [], `${section}: an inner component consumed the scroll`);
    }
    assert.equal((await scrollState(page)).documentTop, 0, `${section}: the visual must remain reachable`);
    assert.equal(await page.locator(".frame-header").evaluate(element => element.getBoundingClientRect().top), 0);
    console.log(`PASS ${section}: one document scroll from reading to visualization (${options.engine})`);
  }
} finally {
  await browser.close();
}
