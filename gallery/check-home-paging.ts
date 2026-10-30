// Regression for Home overshooting a section and correcting backward.
// node check-home-paging.ts <base URL> [--browser <headless Chromium>] [--engine webkit]
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

declare global {
  interface Window {
    homeScrollTrace: { active: boolean; samples: number[] };
  }
}

async function openHome(page: Page) {
  await page.goto(`${base}/`);
  await page.locator(".home").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

/** Check every rendered position, not just the final alignment after a corrective animation. */
async function checkTravel(page: Page, target: number, input: () => Promise<void>) {
  const from = await page.evaluate(() => {
    window.homeScrollTrace = { active: true, samples: [window.scrollY] };
    const sample = () => {
      window.homeScrollTrace.samples.push(window.scrollY);
      if (window.homeScrollTrace.active) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    return window.scrollY;
  });
  await input();
  await page.waitForTimeout(1100);
  const samples = await page.evaluate(() => {
    window.homeScrollTrace.active = false;
    return window.homeScrollTrace.samples;
  });
  const direction = Math.sign(target - from);
  assert.ok(Math.abs(samples.at(-1)! - target) <= 1, `Expected ${target}; stopped at ${samples.at(-1)}`);
  for (const [index, top] of samples.entries()) {
    assert.ok(top >= Math.min(from, target) - 1 && top <= Math.max(from, target) + 1, `Overshot ${target} at ${top}`);
    if (index) assert.ok(direction * (top - samples[index - 1]!) >= -1, `Reversed near ${top}`);
  }
}

try {
  for (const width of [390, 900, 1440]) {
    const mobile = width === 390;
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    await openHome(page);
    const firstStop = await page.evaluate(() => {
      const section = document.querySelector(".home-beat")!.getBoundingClientRect();
      const panel = innerWidth < 1024 ? document.querySelector(".home-panel")!.getBoundingClientRect().height : 0;
      const entranceEnd = Math.max(...[...document.querySelector(".home-entrance")!.children].map(child => child.getBoundingClientRect().bottom));
      if (entranceEnd > innerHeight + 1) return Math.min(entranceEnd - innerHeight, (innerHeight - panel) * 0.8);
      return section.top + scrollY - panel;
    });
    const touch = mobile && options.engine === "chromium" ? await context.newCDPSession(page) : null;
    await checkTravel(page, firstStop, async () => {
      if (touch) {
        await touch.send("Input.synthesizeScrollGesture", { x: 190, y: 730, yDistance: -650, speed: 1600, gestureSourceType: "touch" });
      } else if (mobile) {
        // Playwright cannot send native touch-scroll or wheel input to mobile WebKit.
        await page.keyboard.press("PageDown");
      } else {
        await page.mouse.move(180, 700);
        await page.mouse.wheel(0, 1200);
        // Momentum lasts longer than the page animation, including sub-threshold final events.
        for (let event = 0; event < 70; event++) {
          await page.waitForTimeout(20);
          await page.mouse.wheel(0, 1);
        }
      }
    });
    await checkTravel(page, 0, async () => {
      if (touch) {
        await touch.send("Input.synthesizeScrollGesture", { x: 190, y: 570, yDistance: 350, speed: 1300, gestureSourceType: "touch" });
      } else if (mobile) {
        await page.keyboard.press("PageUp");
      } else {
        await page.mouse.wheel(0, -1200);
      }
    });

    // A scrollbar or focus move between sections must not start a delayed corrective snap.
    await page.evaluate(top => window.scrollTo(0, top), firstStop * 0.7);
    const manualTop = await page.evaluate(() => scrollY);
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => scrollY), manualTop, "Manual scrolling was corrected after release");
    await checkTravel(page, firstStop, async () => { await page.keyboard.press("PageDown"); });
    console.log(`PASS ${width}px ${options.engine}: bounded forward/reverse travel, one destination per gesture, no delayed correction`);
    await context.close();
  }

  // Short screens need reading stops. Collect the exposed intervals of every paragraph and link.
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  await openHome(page);
  const visible = new Map<number, { start: number; end: number }>();
  for (let turn = 0; turn < 40; turn++) {
    const state = await page.evaluate(() => {
      const panel = document.querySelector(".home-panel")!.getBoundingClientRect().bottom;
      const text = [...document.querySelectorAll<HTMLElement>(".home-entrance > *, .home-beat-words > *")].map(element => {
        const box = element.getBoundingClientRect();
        return { start: Math.max(0, panel - box.top), end: Math.min(box.height, innerHeight - box.top), height: box.height };
      });
      return { top: scrollY, maximum: document.documentElement.scrollHeight - innerHeight, text };
    });
    state.text.forEach((range, index) => {
      if (range.end <= range.start) return;
      const previous = visible.get(index);
      assert.ok(!previous || range.start <= previous.end + 1, `Unread gap in text ${index}`);
      visible.set(index, { start: Math.min(previous?.start ?? Infinity, range.start), end: Math.max(previous?.end ?? 0, range.end) });
    });
    if (Math.abs(state.maximum - state.top) <= 1) {
      state.text.forEach((range, index) => {
        assert.ok(visible.has(index), `Text ${index} was skipped`);
        assert.ok(visible.get(index)!.start <= 1 && visible.get(index)!.end >= range.height - 1, `Text ${index} was not fully reachable`);
      });
      break;
    }
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(30);
    assert.ok(await page.evaluate(() => scrollY) > state.top, "Paging stopped before the footer");
    assert.ok(turn < 39, "Did not reach the footer");
  }
  const end = await page.evaluate(() => scrollY);
  await page.keyboard.press("Shift+Space");
  assert.ok(await page.evaluate(() => scrollY) < end, "Shift+Space must page backward");
  console.log(`PASS 320px ${options.engine}: all text reachable, footer accessible, reduced motion and reverse keyboard input`);
} finally {
  await browser.close();
}
