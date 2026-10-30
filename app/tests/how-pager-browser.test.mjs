// Run against develop:remote. All browser windows are headless.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, devices, webkit } from "../../gallery/node_modules/playwright-core/index.mjs";

const desktop = await chromium.launch({
  headless: true,
  ...(process.env.SHELL_BROWSER_EXECUTABLE ? { executablePath: process.env.SHELL_BROWSER_EXECUTABLE } : { channel: "chromium-headless-shell" }),
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
});
const mobile = await webkit.launch({ headless: true });
after(async () => { await desktop.close(); await mobile.close(); });
const base = process.env.SHELL_TEST_BASE_URL ?? "http://127.0.0.1:5180";
const evidence = process.env.HOW_PAGER_EVIDENCE;
const sections = ["overview", "patches", "attention", "basis-place", "selection", "cloud", "rebuild", "basis-training", "visualization", "cells", "scales", "signal", "updates", "local-global", "results", "glossary"];
const chapters = [
  ["Overview", 1], ["The vision transformer", 2], ["The block sparse featurizer", 5],
  ["The automaton", 6], ["Results", 1], ["Glossary", 1],
];
const positions = chapters.flatMap(([title, length]) => Array.from({ length }, (_, index) => `${title} · ${index + 1} of ${length}`));

async function section(page, id) {
  await page.locator(`.how[data-section="${id}"]`).waitFor();
}

for (const width of [320, 390, 430]) {
  for (const [browserName, browser] of [["Chromium", desktop], ["WebKit", mobile]]) {
    test(`${browserName} phone pager follows all steps, chapters and keyboard controls at ${width}px`, async () => {
      const page = await browser.newPage({ ...devices["iPhone 13"], viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.addInitScript(() => { delete Navigator.prototype.gpu; });
        await page.goto(`${base}/how`);
        const pager = page.locator(".how-chapter-pager");
        const previous = pager.getByRole("button", { name: "Previous step", exact: true });
        const next = pager.getByRole("button", { name: "Next step", exact: true });
        assert.ok(await previous.isDisabled());
        for (let index = 0; index < sections.length; index++) {
          await section(page, sections[index]);
          await pager.getByRole("combobox", { name: positions[index], exact: true }).waitFor();
          assert.equal(await page.locator(".how-back").count(), 1);
          assert.equal(await page.locator(".how-moves .primary").count(), index === sections.length - 1 ? 0 : 1);
          assert.equal(await page.getByRole("button", { name: /Scroll architecture/ }).count(), 0);
          assert.ok(await pager.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const position = element.querySelector(".how-chapter-position").getBoundingClientRect();
            return document.documentElement.scrollWidth <= innerWidth && position.width > 0 && position.left >= box.left && position.right <= box.right;
          }));
          if (evidence && ["basis-place", "signal"].includes(sections[index])) {
            await mkdir(evidence, { recursive: true });
            await page.screenshot({ path: `${evidence}/${browserName}-${width}-${sections[index]}.png` });
          }
          if (index < sections.length - 1) await next.tap();
        }
        assert.ok(await next.isDisabled());
        await previous.press("Enter");
        await section(page, "results");
        await previous.press("Space");
        await section(page, "local-global");
        assert.equal(await previous.evaluate((button) => document.activeElement === button), true);
        // WebKit uses Option-Tab to include buttons when full keyboard access is off.
        await page.keyboard.press(browserName === "WebKit" ? "Alt+Tab" : "Tab");
        const picker = pager.getByRole("combobox", { name: "The automaton · 6 of 6", exact: true });
        assert.equal(await picker.evaluate((select) => document.activeElement === select), true);
        assert.equal(await page.locator(".how-chapter-select").evaluate((label) => getComputedStyle(label).outlineStyle), "solid");
        await page.keyboard.press(browserName === "WebKit" ? "Alt+Tab" : "Tab");
        assert.equal(await next.evaluate((button) => document.activeElement === button), true);
        await picker.tap();
        assert.equal(await picker.evaluate((select) => document.activeElement === select), true);
        await page.keyboard.press("Escape");
        await picker.selectOption("basis");
        await section(page, "basis-place");
        await page.locator(".how-moves").scrollIntoViewIfNeeded();
        assert.ok(await pager.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight;
        }), "the pager stays in view beside the explanation");
        await previous.press("Enter");
        await section(page, "attention");
        assert.match(await pager.ariaSnapshot(), /button "Previous step"/);
        assert.match(await pager.ariaSnapshot(), /combobox "The vision transformer · 2 of 2"/);
        assert.match(await pager.ariaSnapshot(), /button "Next step"/);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  }
}

for (const width of [320, 390, 430]) {
  test(`the map keeps native touch scrolling and its position bar at ${width}px`, async () => {
    const page = await desktop.newPage({ ...devices["iPhone 13"], viewport: { width, height: 900 }, reducedMotion: "reduce" });
    try {
      await page.goto(`${base}/how#signal`);
      await section(page, "signal");
      const map = page.locator(".how-map-box");
      await page.waitForFunction(() => document.querySelector(".how-map-navigation").dataset.overflow === "true");
      assert.equal(await page.locator(".how-map-progress").isVisible(), true);
      await map.evaluate((element) => { element.scrollLeft = 0; });
      const bounds = await map.boundingBox();
      const protocol = await page.context().newCDPSession(page);
      const x = bounds.x + bounds.width - 24;
      const y = bounds.y + bounds.height / 2;
      await protocol.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let index = 1; index <= 8; index++) {
        await protocol.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - index * 24, y }] });
        await page.waitForTimeout(20);
      }
      await protocol.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForFunction(() => document.querySelector(".how-map-box").scrollLeft > 50);
      await page.waitForFunction(() => Number(document.querySelector(".how-map-navigation").style.getPropertyValue("--map-position")) > 0);
      assert.equal(await page.getByRole("button", { name: /Scroll architecture/ }).count(), 0);
    } finally { await page.close(); }
  });

}

test("desktop retains chapter tabs and bottom navigation without the phone pager", async () => {
  const page = await desktop.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  try {
    await page.goto(`${base}/how#signal`);
    await section(page, "signal");
    assert.equal(await page.locator(".how-chapter-pager").isVisible(), false);
    assert.equal(await page.locator(".how-acts").isVisible(), true);
    assert.equal(await page.locator(".how-moves").isVisible(), true);
  } finally { await page.close(); }
});
