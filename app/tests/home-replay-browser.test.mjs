// Run against develop:remote. WebGPU runs on SwiftShader, never the host GPU.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../../gallery/node_modules/playwright-core/index.mjs";

// Linux needs a software presentation surface as well as a software compute adapter.
const linux = process.platform === "linux";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SHELL_BROWSER_EXECUTABLE ? { executablePath: process.env.SHELL_BROWSER_EXECUTABLE } : { channel: linux ? "chromium" : "chromium-headless-shell" }),
  args: [
    "--enable-unsafe-webgpu", "--use-angle=swiftshader",
    ...(linux ? ["--use-vulkan=swiftshader", "--enable-features=Vulkan", "--disable-vulkan-surface"] : []),
  ],
});
after(() => browser.close());
const base = process.env.SHELL_TEST_BASE_URL ?? "http://127.0.0.1:5180";

test("recorded grids resume at their tick and match the poster and CPU update", async () => {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  try {
    await page.goto(base);
    const result = await page.evaluate(async () => {
      const { loadAutomatonState, AUTOMATON_RECORD_FOLDER } = await import("/src/features/how/automaton-record.ts");
      const { fetchPublishedMaterialById } = await import("/src/features/gallery/material-gallery.ts");
      const { createFigureReplay } = await import("/src/replay/figure-replay.ts");
      const { FIGURE_SHADERS } = await import("/src/replay/figure-shaders.ts");
      const { referencePyramidStep, startState, COARSE_NOISE_KEY } = await import("/src/replay/figure-reference.ts");
      const record = await loadAutomatonState();
      const material = await fetchPublishedMaterialById(record.replay.definition);
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter || !`${adapter.info.architecture} ${adapter.info.description}`.toLowerCase().includes("swiftshader")) throw new Error("Expected CPU SwiftShader.");
      const device = await adapter.requestDevice();
      const maximumDifference = (a, b) => a.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - b[index])), 0);
      const rule = { values: material.values, fireRate: record.replay.fireRate };
      let replay;
      try {
        replay = await createFigureReplay({ device, side: 128, seed: record.replay.seed,
          initialState: { tick: 600, fine: record.fine.state, coarse: record.coarse.state } }, rule, FIGURE_SHADERS);
        const restored = Math.max(maximumDifference(await replay.readState(), record.fine.state), maximumDifference(await replay.readCoarseState(), record.coarse.state));
        const picture = new Image();
        picture.src = `${AUTOMATON_RECORD_FOLDER}picture-128.png`;
        await picture.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 128;
        const context = canvas.getContext("2d");
        context.drawImage(picture, 0, 0);
        const posterDifference = maximumDifference(await replay.readPixels(), context.getImageData(0, 0, 128, 128).data);
        replay.dispose();
        let expected = { fine: record.fine.state.slice(0, 8 * 8 * 16), coarse: record.coarse.state.slice(0, 4 * 4 * 16) };
        replay = await createFigureReplay({ device, side: 8, seed: record.replay.seed, initialState: { tick: 600, ...expected } }, rule, FIGURE_SHADERS);
        const errors = [];
        for (let tick = 600; tick < 603; tick++) {
          expected = referencePyramidStep(expected.fine, expected.coarse, rule.values, 8, record.replay.seed, tick, rule.fireRate);
          await replay.advance(1);
          errors.push(Math.max(maximumDifference(await replay.readState(), expected.fine), maximumDifference(await replay.readCoarseState(), expected.coarse)));
        }
        const resumedTick = replay.tick;
        replay.reseed(17);
        const reset = Math.max(maximumDifference(await replay.readState(), startState(8, 17)), maximumDifference(await replay.readCoarseState(), startState(4, 17, 0, COARSE_NOISE_KEY)));
        return { restored, posterDifference, errors, resumedTick, reset, resetTick: replay.tick };
      } finally { replay?.dispose(); device.destroy(); }
    });
    assert.equal(result.restored, 0);
    assert.ok(result.posterDifference <= 1, JSON.stringify(result));
    assert.ok(result.errors.every((error) => error < 0.0001), JSON.stringify(result));
    assert.equal(result.resumedTick, 603);
    assert.equal(result.reset, 0);
    assert.equal(result.resetTick, 0);
  } finally { await page.close(); }
});

for (const width of [390, 1440]) {
  test(`stage automata run when their section is active and pause when scrolled away at ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(() => {
        window.bufferTicks = new Map();
        const writeBuffer = GPUQueue.prototype.writeBuffer;
        GPUQueue.prototype.writeBuffer = function (buffer, offset, data, ...rest) {
          if (buffer.label === "figure ticks") {
            const beat = document.querySelector(".home")?.dataset.beat;
            const entry = window.bufferTicks.get(buffer) ?? { firstBeat: beat, count: 0 };
            entry.count += 1;
            window.bufferTicks.set(buffer, entry);
          }
          return writeBuffer.call(this, buffer, offset, data, ...rest);
        };
      });
      await page.goto(base);
      await page.locator('.home-beat[data-beat="properties"]').waitFor({ state: "attached" });
      await page.evaluate(() => document.querySelector('.home-beat[data-beat="properties"]').scrollIntoView());
      await page.waitForFunction(() => document.querySelector(".home")?.dataset.beat === "properties");
      await page.waitForFunction(() => document.querySelector(".home-properties-automaton .home-field")?.hasAttribute("data-live"));
      await page.waitForFunction(() => [...window.bufferTicks.values()].some((item) => item.firstBeat === "properties" && item.count >= 1));

      // Scroll away to collection and verify the properties stage's own replay stops advancing.
      await page.evaluate(() => document.querySelector('.home-beat[data-beat="collection"]').scrollIntoView());
      await page.waitForFunction(() => document.querySelector(".home")?.dataset.beat === "collection");
      await page.waitForTimeout(250);
      const countAtPause = await page.evaluate(() =>
        [...window.bufferTicks.values()].filter((item) => item.firstBeat === "properties").reduce((sum, item) => sum + item.count, 0),
      );
      assert.ok(countAtPause >= 1);
      await page.waitForTimeout(250);
      const countAfterWait = await page.evaluate(() =>
        [...window.bufferTicks.values()].filter((item) => item.firstBeat === "properties").reduce((sum, item) => sum + item.count, 0),
      );
      assert.equal(countAfterWait, countAtPause);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test("an untouched entrance downloads none of the cloud records below it", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const below = [];
  page.on("request", (request) => {
    if (/atlas-clouds-3d\/.*\.bin/.test(request.url())) below.push(new URL(request.url()).pathname);
  });
  try {
    await page.goto(base);
    await page.locator(".home-down").waitFor();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    assert.deepEqual(below, []);

    await page.evaluate(() => document.querySelector('.home-beat[data-beat="properties"]').scrollIntoView());
    await page.waitForFunction(() => document.querySelector(".home")?.dataset.beat === "properties");
    await page.waitForFunction(() => document.querySelectorAll(".home-properties .home-patch-picture img").length > 0);
    assert.ok(below.length > 0);
  } finally { await page.close(); }
});

test("no WebGPU keeps still posters without starting WebGPU canvases", async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => { delete Navigator.prototype.gpu; });
    await page.goto(base);
    await page.locator(".home-down").waitFor();
    await page.evaluate(() => document.querySelector('.home-beat[data-beat="keep"]').scrollIntoView());
    await page.waitForFunction(() => document.querySelector(".home")?.dataset.beat === "keep");
    assert.equal(await page.locator(".home-field canvas").count(), 0);
  } finally { await page.close(); }
});
