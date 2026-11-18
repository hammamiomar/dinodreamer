// Run from the candidate worktree. Each invocation opens one headless browser under the Mac GPU lock.
// SITE_AUDIT_OUTPUT names the evidence directory. Modes and route arguments are listed in the report.
import { mkdir, writeFile, readFile, unlink, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

import { profileWebGPU } from "./profile-webgpu.mjs";

const playwright = join(process.cwd(), "gallery/node_modules/playwright-core/index.mjs");
const { chromium } = await import(pathToFileURL(playwright).href);

const [environment, mode, ...cases] = process.argv.slice(2);
const origins = {
  dev: "http://127.0.0.1:5264",
  worker: "http://127.0.0.1:8806",
  live: "https://dinodreamer.computervision.vision",
  prototype: "http://127.0.0.1:8807",
  model: "http://127.0.0.1:5276",
};
const base = origins[environment];
if (!base) throw new Error("Supply a server name from the origins table.");
const evidence =
  process.env.SITE_AUDIT_OUTPUT ??
  join(homedir(), "hambaLab/Lab/dinodreamer-evidence-archive/2026-11-18-site-audit");
const lock = "/tmp/dinodreamer-gpu.lock";
const owner = `audit-reza ${process.pid}, ${new Date().toISOString()}, estimated ${cases.length * 18 + 90}s, headless site audit ${environment} ${mode}\n`;
const executablePath = join(
  homedir(),
  "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const routes = {
  home: ["/", ".home-down"],
  index: ["/index", ".atlas-cloud-card a"],
  basis: ["/basis/12002", "dialog[open] .basis-panel-content"],
  wall: ["/automata", ".automata-deck-link, .playground-shelf button"],
  group: ["/automata?group=12002", ".automata-cell[aria-pressed=true], .playground-shelf button"],
  saved: ["/automata?group=yours", ".automata-group[data-saved], .playground-shelf"],
  train: ["/train", ".grow-panel .button.primary"],
  target: ["/train?block=12002", ".grow-panel button.primary:enabled"],
  how: ["/how", ".how-moves button.primary"],
  canvas: ["/canvas", ".landing a"],
  create: ["/create", ".create-page button"],
  picture: ["/picture", ".picture-empty a"],
  owner: ["/admin", "#owner:not(:empty)"],
  inventory: ["/admin/materials", ".owner-actions, .owner-summary"],
  curation: ["/admin/automata", ".automata-deck-link"],
  research: ["/admin/research", ".research-group-link"],
  catalogue: ["/admin/research/group/12002", ".research-card"],
  run: ["/admin/research/run/12002-cellular-dictionary-pole-noise-128", ".research-run"],
  missing: ["/absent-site-audit-page", ".not-found a"],
};
for (const parent of [
  "index",
  "automata",
  "train",
  "how",
  "create",
  "picture",
  "admin/materials",
  "admin/automata",
]) {
  routes[parent.replace("/", "-") + "-panel"] = [
    `/${parent}/basis/12002`,
    "dialog[open] .basis-panel-content",
  ];
}
for (const parent of ["index", "automata", "train", "how", "create", "picture", "admin/materials"]) {
  routes[parent.replace("/", "-") + "-old-panel"] = [
    `/${parent}/block/12002`,
    "dialog[open] .basis-panel-content",
  ];
}
Object.assign(routes, {
  galleryAlias: ["/gallery", ".landing a"],
  savedAlias: ["/saved", ".automata-group[data-saved]"],
  exploreAlias: ["/explore", ".atlas-cloud-card a"],
  blockAlias: ["/block/12002", "dialog[open] .basis-panel-content"],
  playgroundAlias: ["/playground", ".automata-deck-link"],
  growAlias: ["/grow", ".grow-panel .button.primary"],
  legacyMaterial: [
    "/automata?material=11438-given-set-t13-companions-pole-3x3-disc-plain-seed-0",
    ".automata-cell[aria-pressed=true]",
  ],
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Browser clocks use milliseconds since document navigation. API counts cover the page's main world.
function observePage({ selector, variant }) {
  performance.setResourceTimingBufferSize(5000);
  const observation = (window.auditObservation = {
    frames: [],
    tasks: [],
    clicks: [],
    milestones: {},
    buffers: 0,
    peakBuffers: 0,
    pipelines: 0,
    submits: 0,
    queueWaits: [],
    gpuHistory: [],
    devices: [],
    samples: [],
    errors: [],
  });
  new PerformanceObserver((list) => {
    for (const event of list.getEntries()) observation.tasks.push([event.startTime, event.duration]);
  }).observe({ type: "longtask", buffered: true });
  addEventListener(
    "click",
    (event) => {
      const link = event.target.closest?.("a,button");
      observation.clicks.push({
        at: performance.now(),
        event: event.timeStamp,
        path: location.pathname,
        target: link?.getAttribute("href") ?? link?.textContent?.slice(0, 35),
      });
    },
    true,
  );
  if (variant.includes("intent-plates")) {
    // Only the wall's plate reader observes the list item. A face observes its own span.
    const observe = IntersectionObserver.prototype.observe;
    IntersectionObserver.prototype.observe = function (element) {
      if (!element.matches(".automata-deck")) return observe.call(this, element);
      const admit = () => observe.call(this, element);
      element.addEventListener("pointerenter", admit, { once: true });
      element.addEventListener("focusin", admit, { once: true });
    };
  }
  const start = performance.now();
  let lastRecord = 0;
  const watch = (now) => {
    observation.frames.push(now);
    if (observation.milestones.ready == null && document.querySelector(selector))
      observation.milestones.ready = performance.now();
    const names = {
      firstFace: '.automata-deck-face[data-state="live"]',
      firstPlate: ".automata-deck-plate img",
      indexCard: ".atlas-cloud-card[data-ready=true] .atlas-cloud-area canvas",
      header: ".frame-header",
      group: ".automata-group:not([data-saved])",
      destination: window.auditDestination,
    };
    for (const [name, mark] of Object.entries(names)) {
      if (mark && !(name in observation.milestones) && document.querySelector(mark))
        observation.milestones[name] = performance.now();
    }
    if (now - lastRecord > 240) {
      observation.gpuHistory.push({
        at: now,
        buffers: observation.buffers,
        submits: observation.submits,
        faces: document.querySelectorAll('.automata-deck-face[data-state="live"]').length,
      });
      lastRecord = now;
    }
    if (now - start < 180000) requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
  if (!window.GPUDevice) return;
  const adapterRequest = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = function (descriptor) {
    observation.devices.push({
      at: performance.now(),
      vendor: this.info.vendor,
      architecture: this.info.architecture,
    });
    return adapterRequest.call(this, descriptor);
  };
  const originalAllocate = GPUDevice.prototype.createBuffer;
  const sizes = new WeakMap();
  GPUDevice.prototype.createBuffer = function (descriptor) {
    const buffer = originalAllocate.call(this, descriptor);
    sizes.set(buffer, buffer.size);
    observation.buffers += buffer.size;
    observation.peakBuffers = Math.max(observation.peakBuffers, observation.buffers);
    return buffer;
  };
  const originalDestroy = GPUBuffer.prototype.destroy;
  GPUBuffer.prototype.destroy = function () {
    observation.buffers -= sizes.get(this) ?? 0;
    sizes.delete(this);
    return originalDestroy.call(this);
  };
  for (const name of ["createComputePipelineAsync", "createRenderPipelineAsync"]) {
    const original = GPUDevice.prototype[name];
    GPUDevice.prototype[name] = function (...args) {
      observation.pipelines++;
      return original.apply(this, args);
    };
  }
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (...args) {
    observation.submits++;
    return submit.apply(this, args);
  };
  const wait = GPUQueue.prototype.onSubmittedWorkDone;
  GPUQueue.prototype.onSubmittedWorkDone = function () {
    const at = performance.now();
    const result = wait.call(this);
    result.then(
      () => observation.queueWaits.push([at, performance.now() - at]),
      () => {},
    );
    return result;
  };
  if (variant.includes("posters")) delete Navigator.prototype.gpu;
}
async function collect(browser, name, index) {
  const phone = mode === "phone";
  const variant = process.env.SITE_AUDIT_VARIANT ?? "standard";
  const startPage = {
    "picture-read": "index",
    paint: "create",
    journey: "how",
    navigation: "wall",
    interrupt: "wall",
    design: "wall",
    scroll: "wall",
    idle: "wall",
    phone: "wall",
    training: "target",
  };
  const [path, selector] = routes[startPage[mode] ?? name];
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: phone,
    isMobile: phone,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const requests = new Map();
  const events = [];
  const log = {
    environment,
    mode,
    name,
    index,
    variant,
    base,
    path,
    selector,
    userAgent: browser.version(),
    viewport: page.viewportSize(),
  };
  session.on("Network.requestWillBeSent", (event) => {
    requests.set(event.requestId, {
      url: event.request.url,
      type: event.type,
      at: event.timestamp,
      wall: event.wallTime,
      priority: event.request.initialPriority,
    });
  });
  session.on("Network.responseReceived", (event) =>
    Object.assign(requests.get(event.requestId) ?? {}, {
      status: event.response.status,
      protocol: event.response.protocol,
      timing: event.response.timing,
      responseAt: event.timestamp,
      disk: event.response.fromDiskCache,
    }),
  );
  session.on("Network.loadingFinished", (event) =>
    Object.assign(requests.get(event.requestId) ?? {}, {
      end: event.timestamp,
      bytes: event.encodedDataLength,
    }),
  );
  session.on("Network.loadingFailed", (event) =>
    Object.assign(requests.get(event.requestId) ?? {}, { error: event.errorText, end: event.timestamp }),
  );
  page.on("pageerror", (error) => events.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() === "error") events.push(msg.text().slice(0, 350));
  });
  await session.send("Network.enable");
  // No cache override. A fresh browser context has an empty HTTP cache and can reuse resources during a visit.
  await page.addInitScript(observePage, { selector, variant });
  if (mode === "gpu") await page.addInitScript(profileWebGPU);
  if (["training", "picture-read", "paint"].includes(mode))
    page.on("worker", (worker) => {
      worker
        .evaluate(profileWebGPU, mode === "picture-read" ? 1 : 16)
        .catch((error) => events.push(String(error)));
    });
  if (process.env.SITE_AUDIT_TRACE)
    await session.send("Tracing.start", {
      categories: "devtools.timeline,blink.user_timing,loading,disabled-by-default-devtools.timeline.frame",
      transferMode: "ReturnAsStream",
    });
  if (process.env.SITE_AUDIT_NETWORK === "4g") {
    log.network = "100ms latency, 4 Mbit/s down, 1 Mbit/s up";
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 100,
      downloadThroughput: 4e6 / 8,
      uploadThroughput: 1e6 / 8,
    });
  }
  const series = process.env.SITE_AUDIT_SERIES;
  const prefix = [environment, mode, name, variant, series, index]
    .filter((value) => value !== undefined)
    .join("-");
  const screenshot = (label) =>
    page.screenshot({ path: join(evidence, "screenshots", `${prefix}-${label}.png`), timeout: 12000 });
  try {
    await page.goto(base + path, { waitUntil: "commit", timeout: 30000 });
    await page
      .locator(selector)
      .first()
      .waitFor({ state: "attached", timeout: 12000 })
      .catch(() => {});
    if (mode === "journey") {
      await page.locator('.frame-nav a[href="/automata"]').click();
      await page.locator(".automata-deck-link").first().waitFor({ state: "attached" });
      await pause(350);
    }
    if (mode === "navigation" || mode === "journey" || mode === "interrupt") {
      if (mode === "interrupt") {
        await pause(400);
        await page.locator('.frame-nav a[href="/train"]').click();
        await pause(125);
      }
      await pause(Number(process.env.SITE_AUDIT_DELAY ?? 400));
      const destination = name === "train" ? ".grow-panel .button.primary" : ".atlas-cloud-card a";
      const link = page.locator(`.frame-nav a[href^="/${name}"]`).first();
      const box = await link.boundingBox();
      await page.evaluate((mark) => {
        window.auditDestination = mark;
        window.auditInput = performance.now();
      }, destination);
      // Send one real pointer press even when the renderer is busy. Avoid Playwright's actionability polling.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page
        .waitForFunction(() => window.auditObservation.milestones.destination != null, null, {
          timeout: 20000,
        })
        .catch(() => {});
      await pause(1600);
    } else if (mode === "design" || phone) {
      await screenshot("opening");
      await pause(3000);
      await screenshot("wall");
      if (!phone) {
        await page.locator(".automata-deck-link").first().hover();
        await pause(450);
        await screenshot("focus");
      }
      await page.locator(".automata-deck-link").first().click({ timeout: 12000 });
      await page.waitForSelector(".automata-group", { timeout: 12000 });
      await pause(2200);
      await screenshot("group");
      const choices = page.locator("button.automata-cell:not([aria-pressed=true])");
      if (await choices.count()) await choices.first().click({ timeout: 5000 });
      await pause(500);
      log.changedMaterial = page.url();
      if (!phone) {
        await page.goBack({ waitUntil: "commit" });
        await pause(800);
        log.backUrl = page.url();
      }
    } else if (mode === "index-count") {
      log.publication = await page.evaluate(async () => {
        const response = await fetch("/api/materials");
        const body = await response.text();
        const entries = JSON.parse(body).entries;
        return {
          entries: entries.length,
          groups: new Set(entries.map((entry) => entry.block)).size,
          jsonBytes: new TextEncoder().encode(body).length,
        };
      });
    } else if (mode === "idle") {
      await pause(9500);
      log.idle = await page.evaluate(async () => {
        const request = window.requestAnimationFrame;
        const first = performance.now();
        const submits = window.auditObservation.submits;
        let callbacks = 0;
        window.requestAnimationFrame = function (callback) {
          if (callback.name !== "watch") callbacks++;
          return request.call(window, callback);
        };
        await new Promise((resolve) => setTimeout(resolve, 2000));
        window.requestAnimationFrame = request;
        return {
          duration: performance.now() - first,
          callbacks,
          submits: window.auditObservation.submits - submits,
          faces: document.querySelectorAll(".automata-deck-face[data-state=live]").length,
          buffers: window.auditObservation.buffers,
        };
      });
    } else if (mode === "scroll") {
      await page.waitForSelector(".automata-deck-face[data-state=live]");
      log.positions = [];
      const record = async (label) =>
        log.positions.push(
          await page.evaluate((label) => {
            const faces = [...document.querySelectorAll(".automata-deck-face")];
            const visible = faces.filter((face) => {
              const rect = face.getBoundingClientRect();
              return rect.top < innerHeight && rect.bottom > 64;
            });
            return {
              label,
              at: performance.now(),
              y: scrollY,
              visible: visible.length,
              shown: visible.filter((x) => x.dataset.state === "live").length,
              opened: faces.filter((x) => x.dataset.state === "live").length,
              bytes: window.auditObservation.buffers,
              submits: window.auditObservation.submits,
            };
          }, label),
        );
      await record("start");
      for (const fraction of [0.26, 0.52, 0.78, 1]) {
        await page.evaluate(
          (fraction) =>
            window.scrollTo({
              top: fraction * (document.documentElement.scrollHeight - innerHeight),
              behavior: "instant",
            }),
          fraction,
        );
        await pause(130);
        await record("move");
      }
      for (const delay of [1500, 4000, 5000]) {
        await pause(delay);
        await record("hold");
      }
      await screenshot("bottom");
    } else if (["training", "picture-read", "paint"].includes(mode)) {
      if (!["dev", "model"].includes(environment))
        throw new Error("Model runs need the development server and its complete WASM.");
      const begin = Date.now();
      if (mode === "training") await page.locator(".grow-panel button.primary:enabled").click();
      if (mode === "picture-read")
        await page.locator(".picture-entry input").setInputFiles("app/public/apple-touch-icon.png");
      if (mode === "paint") {
        if (["smoothness", "weighted-smoothness"].includes(name)) {
          await page.getByRole("switch", { name: "Smoothness", exact: true }).click();
          if (name === "weighted-smoothness")
            await page.getByRole("spinbutton", { name: "Smoothness weight" }).fill("1");
        }
        await page.getByRole("button", { name: "Load the model", exact: true }).click();
      }
      log.working = [];
      while (Date.now() - begin < 115000) {
        const selector = { training: ".grow-panel", paint: ".transport", "picture-read": ".picture-page" }[
          mode
        ];
        const progress = (await page.locator(selector).innerText()).slice(-1400);
        log.working.push([Date.now() - begin, progress]);
        if (mode === "training" && /Optimizer update [1-9]/i.test(progress)) break;
        if (mode === "picture-read" && (await page.locator(".picture-block-open").count())) break;
        if (
          mode === "paint" &&
          Number(
            await page
              .locator(".transport-step b")
              .textContent({ timeout: 200 })
              .catch(() => 0),
          ) > 0
        )
          break;
        if (/could not|failed|not read|out of memory|play refused/i.test(progress)) break;
        await pause(1000);
      }
      if (mode === "training" && name === "background") {
        const trainingWorker = page.workers().find((worker) => worker.url().includes("grow.worker"));
        await page.locator('.frame-nav a[href^="/index"]').click();
        await page.locator(".train-tray").waitFor();
        const before = await page.locator(".train-tray").innerText();
        await pause(3000);
        log.background = {
          before,
          after: await page.locator(".train-tray").innerText(),
          sameWorker: page.workers().includes(trainingWorker),
          url: page.url(),
        };
        await page.locator(".train-tray-actions a").first().click();
        await page.locator(".grow-panel").waitFor();
        log.background.returned = await page.locator(".grow-panel").innerText();
      }
      log.workerProfiles = [];
      for (const worker of page.workers()) {
        log.workerProfiles.push({
          url: worker.url(),
          ...(await worker.evaluate(() => ({
            deviceProfile: globalThis.auditGPU,
            resources: performance.getEntriesByType("resource").map((entry) => entry.toJSON()),
          }))),
        });
      }
      const stop = page.getByRole("button", { name: mode === "paint" ? "Pause" : "Stop", exact: true });
      const dialogStop = page.locator("dialog[open]").getByRole("button", { name: "Stop", exact: true });
      if (await dialogStop.count()) await dialogStop.click();
      else if (await stop.count()) await stop.first().click({ timeout: 5000 });
    } else {
      await pause(mode === "gpu" ? 7500 : 3500);
    }
  } catch (error) {
    log.failure = String(error).slice(0, 700);
  }
  try {
    Object.assign(
      log,
      await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        body: document.body.innerText.slice(0, 2400),
        clock: performance.now(),
        origin: performance.timeOrigin,
        input: window.auditInput,
        paint: performance.getEntriesByType("paint").map((x) => [x.name, x.startTime]),
        navigation: performance.getEntriesByType("navigation")[0]?.toJSON(),
        observed: window.auditObservation,
        deviceProfile: window.auditGPU,
        elements: document.querySelectorAll("*").length,
        images: document.images.length,
        contextCanvases: document.querySelectorAll("canvas").length,
      })),
    );
  } catch (error) {
    log.collectionError = String(error);
  }
  log.requests = [...requests.values()];
  log.events = events;
  if (process.env.SITE_AUDIT_TRACE) {
    const complete = new Promise((resolve) => session.once("Tracing.tracingComplete", resolve));
    await session.send("Tracing.end");
    const { stream } = await complete;
    const chunks = [];
    for (;;) {
      const chunk = await session.send("IO.read", { handle: stream });
      chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
      if (chunk.eof) break;
    }
    await session.send("IO.close", { handle: stream });
    await writeFile(join(evidence, "traces", prefix + ".chrome.json.gz"), gzipSync(Buffer.concat(chunks)));
  }
  await writeFile(join(evidence, "traces", prefix + ".json.gz"), gzipSync(JSON.stringify(log)));
  console.log(
    prefix,
    JSON.stringify({
      ready: log.observed?.milestones,
      click: log.observed?.clicks,
      requests: requests.size,
      body: log.body?.slice(0, 92),
      failure: log.failure,
      errors: events.slice(0, 2),
    }),
  );
  await context.close();
}
await mkdir(join(evidence, "screenshots"), { recursive: true });
await mkdir(join(evidence, "traces"), { recursive: true });
await mkdir(lock);
let browser;
try {
  await writeFile(join(lock, "owner"), owner);
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--enable-unsafe-webgpu", "--enable-gpu"],
  });
  for (const [index, name] of cases.entries()) await collect(browser, name, index);
} finally {
  try {
    await browser?.close();
  } finally {
    if ((await readFile(join(lock, "owner"), "utf8")) === owner) {
      await unlink(join(lock, "owner"));
      await rmdir(lock);
    }
  }
}
