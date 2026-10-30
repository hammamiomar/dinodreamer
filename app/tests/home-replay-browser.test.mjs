// Run against develop:remote. WebGPU runs on SwiftShader, never the host GPU.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../../gallery/node_modules/playwright-core/index.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.SHELL_BROWSER_EXECUTABLE ? { executablePath: process.env.SHELL_BROWSER_EXECUTABLE } : { channel: "chromium-headless-shell" }),
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
});
after(() => browser.close());
const base = process.env.SHELL_TEST_BASE_URL ?? "http://127.0.0.1:5180";

test("recorded grids resume at their tick and match the poster and CPU update", async () => {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  try {
    await page.goto(base);
    const result = await page.evaluate(async () => {
      const { loadAutomatonState, AUTOMATON_RECORD_FOLDER } = await import("/src/features/how/automaton-record.ts");
      const { fetchPublishedMaterial } = await import("/src/features/gallery/material-gallery.ts");
      const { createFigureReplay } = await import("/src/replay/figure-replay.ts");
      const { FIGURE_SHADERS } = await import("/src/replay/figure-shaders.ts");
      const { referencePyramidStep, startState, COARSE_NOISE_KEY } = await import("/src/replay/figure-reference.ts");
      const record = await loadAutomatonState();
      const material = await fetchPublishedMaterial(record.replay.definition);
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
        // A small grid exercises both buffers and the recorded fire-mask tick cheaply.
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
    console.log("Recorded state:", result);
  } finally { await page.close(); }
});

for (const width of [390, 1440]) {
  test(`fast training-to-end scrolling starts from tick 600 without hidden updates at ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(() => {
        window.recordedQueues = [];
        const writeBuffer = GPUQueue.prototype.writeBuffer;
        GPUQueue.prototype.writeBuffer = function(buffer, offset, data, ...rest) {
          let record = window.recordedQueues.find((item) => item.queue === this);
          if (buffer.label === "figure state 0") {
            if (!record) { record = { queue: this, ticks: [] }; window.recordedQueues.push(record); }
          }
          if (record && buffer.label === "figure ticks") {
            const bytes = ArrayBuffer.isView(data) ? data.buffer : data;
            record.ticks.push({ tick: new Uint32Array(bytes)[2], beat: document.querySelector(".home")?.dataset.beat, time: performance.now() });
          }
          return writeBuffer.call(this, buffer, offset, data, ...rest);
        };
      });
      await page.goto(base);
      const field = page.locator(".home-layer").last().locator(".home-field");
      await field.locator("canvas").waitFor({ state: "attached" });
      await page.waitForFunction(() => document.querySelector(".home-layer:last-child .home-field")?.hasAttribute("data-live"));
      assert.equal(await page.evaluate(() => window.recordedQueues.length), 1);
      assert.equal(await page.evaluate(() => window.recordedQueues[0].ticks.length), 0);
      await page.evaluate(() => document.querySelector('.home-beat[data-beat="automaton"]').scrollIntoView());
      await page.waitForFunction(() => document.querySelector(".home").dataset.beat === "automaton");
      assert.equal(await page.evaluate(() => window.recordedQueues[0].ticks.length), 0);
      const started = await page.evaluate(() => { document.querySelector(".home-end").scrollIntoView(); return performance.now(); });
      await page.waitForFunction(() => window.recordedQueues[0].ticks.length >= 2);
      const ticks = await page.evaluate(() => window.recordedQueues[0].ticks.slice(0, 2));
      assert.deepEqual(ticks.map(({ tick, beat }) => ({ tick, beat })), [{ tick: 600, beat: "end" }, { tick: 601, beat: "end" }]);
      assert.equal(await field.getAttribute("data-live"), "true");
      assert.match(await field.evaluate((element) => element.style.backgroundImage), /picture-128\.png/);
      await page.evaluate(() => document.querySelector('.home-beat[data-beat="automaton"]').scrollIntoView());
      await page.waitForFunction(() => document.querySelector(".home").dataset.beat === "automaton");
      // Allow an update already submitted at the transition to finish, then verify the pause.
      await page.waitForTimeout(200);
      const paused = await page.evaluate(() => window.recordedQueues[0].ticks.length);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.recordedQueues[0].ticks.length), paused);
      assert.deepEqual(errors, []);
      console.log(`${width}px first update after a direct scroll: ${(ticks[0].time - started).toFixed(1)} ms; no catch-up updates`);
    } finally { await page.close(); }
  });
}

for (const mode of ["reduced motion", "no WebGPU"]) {
  test(`${mode} keeps the matching poster and does not fetch recorded grids`, async () => {
    const page = await browser.newPage({ reducedMotion: mode === "reduced motion" ? "reduce" : "no-preference" });
    const grids = [];
    page.on("request", (request) => { if (/grid-(fine|coarse)-600/.test(request.url())) grids.push(request.url()); });
    try {
      if (mode === "no WebGPU") await page.addInitScript(() => { delete Navigator.prototype.gpu; });
      await page.goto(base);
      await page.locator(".home-layer:last-child .home-field").waitFor({ state: "attached" });
      await page.evaluate(() => document.querySelector(".home-end").scrollIntoView());
      await page.waitForFunction(() => document.querySelector(".home").dataset.beat === "end");
      assert.equal(await page.locator(".home-layer:last-child canvas").count(), 0);
      assert.deepEqual(grids, []);
    } finally { await page.close(); }
  });
}
