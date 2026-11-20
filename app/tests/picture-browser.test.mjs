// Your picture (/picture) with ?engine=fake: the reader answers with How's recorded reading of its
// hibiscus (app/src/reader/recorded-reader.ts), so no model loads. The basis groups' records and
// library pictures come through the runner's remote-library proxy.
// Run through run-browser-tests.mjs; SHELL_BROWSER_EXECUTABLE selects its Chromium shell.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "../../gallery/node_modules/playwright-core/index.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.SHELL_BROWSER_EXECUTABLE ? { executablePath: process.env.SHELL_BROWSER_EXECUTABLE } : { channel: "chromium-headless-shell" }),
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
});
after(() => browser.close());
const base = process.env.SHELL_TEST_BASE_URL ?? "http://127.0.0.1:5179";
// Any picture will do: the recorded reader does not read the pixels.
const picture = resolve(import.meta.dirname, "../public/how/training/automaton-4009/picture-256.png");

test("Your picture lists its basis groups under one column head, and a chosen patch lists its groups", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${base}/index?engine=fake`);
    await page.locator(".picture-entry input").setInputFiles(picture);
    await page.waitForURL(/\/picture\?engine=fake$/);
    const rows = page.locator(".picture-group-list > .picture-group");
    await rows.first().waitFor({ timeout: 30000 });

    // The column head names every row's squares, weaker to stronger.
    assert.deepEqual(
      await page.locator(".picture-columns").evaluate((head) => [...head.children].map((child) => child.textContent.trim())),
      ["Your picture", "weakerstronger", "Level 1", "Level 2", "Level 3", "Level 4"],
    );

    // A row: your square and the library picture of your level share that level's colour, and the level's name sits under your square.
    const row = rows.first();
    await row.locator(".picture-group-yours[data-marked]").waitFor({ timeout: 30000 });
    const marked = row.locator(".picture-group-level[data-marked]");
    assert.equal(await marked.count(), 1);
    const band = Number(await marked.getAttribute("data-band"));
    assert.equal(await row.locator(".picture-group-yours-level").textContent(), `Level ${band + 1}`);
    const outline = (element) => getComputedStyle(element).outlineColor;
    assert.equal(await row.locator(".picture-group-yours").evaluate(outline), await marked.evaluate(outline));

    // A patch chosen on the map lists the 32 groups selected there; Show all returns to the ranked list.
    const ranked = await rows.count();
    const map = await page.locator(".picture-figure .patch-map").boundingBox();
    await page.mouse.click(map.x + map.width * 0.5 + 4, map.y + map.height * 0.5 + 4);
    const title = page.locator("#picture-groups-title");
    await page.waitForFunction(() => /^Basis groups at patch \d+, \d+$/.test(document.querySelector("#picture-groups-title")?.textContent ?? ""));
    assert.equal(await rows.count(), 32);
    await page.getByRole("button", { name: "Show all" }).click();
    assert.equal(await title.textContent(), "Basis groups in your picture");
    assert.equal(await rows.count(), ranked);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
