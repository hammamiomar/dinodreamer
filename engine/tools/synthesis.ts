// Run one recipe through the app's real synthesis client in Chrome and record what it reports.
//
//   node tools/synthesis.ts --steps 20 [--recipe tools/fixtures/evidence-recipe.json]
//        [--assets https://library.computervision.vision] [--label name] [--headed] [--edits]
//        [--replay [--run | --switch N1,N2] [--reseed S] [--restore S]] [--seed n] [--prepare N]
//        [--engine-wasm app/<sha256>/dinodreamer_engine_bg.wasm]
//
// It starts the app's Vite dev server, imports app/src/synthesis/client.ts in the page and
// drives it with protocol commands: load, apply, then step × N. With --edits it instead
// runs and applies a sequence of edited recipes during the run, then checks what the
// worker acknowledged (EDITS below). With --lose-device it crashes Chrome's GPU process
// during a run and checks that the worker fails explicitly instead of hanging. With --replay
// it steps N times, restarts from the same seed, steps N times again, and compares the two
// runs' frame losses and the pixels of the last frame (the image after N − 1 updates); the
// SHA-256 of each run's pixels compares sessions. With --run the two runs use run and pause,
// as the editor does, instead of single steps. With --switch N1,N2 the first run runs until N1
// updates are done, pauses and steps to N; the second does the same with N2. A replay also
// saves the first run's last frame as pixels.rgba (256 × 256 × 4 bytes) next to the report,
// so two engine builds can be compared on the same seed. With --reseed S each run re-seeds
// cells (4..8, 4..8) with seed 7 after S updates (the Noise brush), so the replay covers the
// run sequence's re-seed event. With --restore S each run first restores a stored picture (the
// preview of the recipe's first Look like reference) as saved after S updates (Open, D4), checks
// that the measurement after it shows the picture exactly, and steps on from S.
// With --prepare N it times the preparation of a new request with N Look like references
// (block 1000's strong examples, read from the library): from the apply to the first frame of
// the new revision, cold (previews not in the Cache API), warm (a new worker in the same page:
// previews cached, encodes again) and hot (the same request with its area moved: neither).
// The worker's phases split it: the recipe, the previews' download, each encode, the update.
// --engine-wasm names an engine .wasm in the library bucket (the key the deploy publishes);
// the worker then loads it instead of engine/pkg's, as the deployed app does. The JS glue
// still comes from engine/pkg, so build that from the same engine source.
// Build the engine first (pnpm build:engine).
// Reports go to local/bench/<time>-synthesis-<label>/report.json.

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = resolve(root, "../app");
const PORT = 5199;

const { values } = parseArgs({
  options: {
    steps: { type: "string", default: "20" },
    recipe: { type: "string", default: "tools/fixtures/evidence-recipe.json" },
    assets: { type: "string", default: "https://library.computervision.vision" },
    label: { type: "string", default: "run" },
    headed: { type: "boolean", default: false },
    edits: { type: "boolean", default: false },
    replay: { type: "boolean", default: false },
    run: { type: "boolean", default: false },
    switch: { type: "string" },
    seed: { type: "string" },
    "lose-device": { type: "boolean", default: false },
    prepare: { type: "string" },
    reseed: { type: "string" },
    restore: { type: "string" },
    "engine-wasm": { type: "string" },
  },
});
const steps = Number(values.steps);
if (!Number.isInteger(steps) || steps < 1) throw new Error("--steps must be a positive integer");
const recipe = JSON.parse(await readFile(resolve(root, values.recipe!), "utf8"));
if (values.seed !== undefined) recipe.seed = Number(values.seed);
/** Updates each replay run makes in run mode before it pauses and continues with single steps. */
const runFirst = values.switch ? values.switch.split(",").map(Number) : values.run ? [steps, steps] : [0, 0];
if (runFirst.length !== 2 || runFirst.some((count) => !Number.isInteger(count) || count < 0 || count > steps)) {
  throw new Error("--switch takes two update counts between 0 and --steps, for example 194,197");
}
/** The update count after which each replay run re-seeds a block of cells; single steps reach it exactly. */
const reseedAt = values.reseed === undefined ? undefined : Number(values.reseed);
if (reseedAt !== undefined && (!Number.isInteger(reseedAt) || reseedAt >= steps || runFirst.some((count) => count > reseedAt))) {
  throw new Error("--reseed S needs 0 ≤ S < --steps, after any run (--run or --switch counts at most S)");
}
/** Open (D4): a stored PNG and the step it was saved at, restored at the start of each replay run. */
async function storedPicture(step: number): Promise<{ png: number[]; step: number }> {
  if (!Number.isInteger(step) || step < 0 || runFirst.some((count) => count > 0)) {
    throw new Error("--restore S needs S ≥ 0 and single steps (no --run or --switch)");
  }
  const manifest = await (await fetch(`${values.assets}/releases/pass-003.json`)).json();
  const imageId = recipe.requests.find((request: any) => request.lookLike.enabled).lookLike.references[0].token.imageId;
  const response = await fetch(`${values.assets}/web/v2/assets/${manifest.library.asset_id}/previews/${imageId}.png`);
  if (!response.ok) throw new Error(`The stored picture could not be read (${response.status}).`);
  return { png: Array.from(new Uint8Array(await response.arrayBuffer())), step };
}
const restore = values.restore === undefined ? undefined : await storedPicture(Number(values.restore));

const reseed = {
  cells: Array.from({ length: 256 }, (_, cell) => Math.floor(cell / 16) >= 4 && Math.floor(cell / 16) < 8 && cell % 16 >= 4 && cell % 16 < 8),
  seed: 7,
};

interface Edit {
  name: string;
  revision: number;
  recipe: any;
  /** Expected acknowledgement; a rejected edit must leave the previous recipe running. */
  outcome: "applied" | "rejected";
  resetAdam: boolean;
  rebased: boolean;
}

/** Edits applied during a run, each with the acknowledgement the protocol requires. */
function edits(): Edit[] {
  const list: Edit[] = [];
  let current = recipe;
  const add = (name: string, change: (next: any) => void, resetAdam: boolean, rebased: boolean) => {
    current = structuredClone(current);
    change(current);
    list.push({ name, revision: list.length + 2, recipe: current, outcome: "applied", resetAdam, rebased });
  };
  const reject = (name: string, change: (next: any) => void) => {
    const next = structuredClone(current);
    change(next);
    list.push({ name, revision: list.length + 2, recipe: next, outcome: "rejected", resetAdam: false, rebased: false });
  };
  add("add a cell to request 1's Respond like area", (next) => (next.requests[0].respondLike.where[5 * 16 + 11] = true), true, false);
  add("remove a cell from request 1's Look like area", (next) => (next.requests[0].lookLike.where[7 * 16 + 12] = false), true, false);
  add("protect one more cell", (next) => (next.protect[15 * 16 + 15] = true), true, true);
  add("seed only", (next) => (next.seed = 7), false, false);
  add("zoom 0.01 per update (motion only)", (next) => (next.motion.zoomPerUpdate = 0.01), false, false);
  // Two rejected edits that also change TV: the previous TV must stay. Since recipe.ts checks
  // request ids and slots, validateRecipe refuses both before the engine sees them.
  const disabledCopy = (next: any, id: number, slot: number) => {
    const request = structuredClone(next.requests[2]);
    request.id = id;
    request.respondLike.enabled = false;
    request.respondLike.source.slot = slot;
    return request;
  };
  reject("TV change with request id −1", (next) => {
    next.rules.tv.weight = 0.5;
    next.requests.push(disabledCopy(next, -1, 2));
  });
  reject("TV change with a probe slot outside the grid", (next) => {
    next.rules.tv.weight = 0.5;
    next.requests.push(disabledCopy(next, 4, 999));
  });
  add("disable request 2 Respond like", (next) => (next.requests[1].respondLike.enabled = false), true, false);
  add("probe only: request 2 code while disabled", (next) => (next.requests[1].respondLike.code = [1, 2, 3]), false, false);
  add("request 1 Look like weight", (next) => (next.requests[0].lookLike.weight = 0.5), true, false);
  // The last edit is applied with a pause right behind it; it encodes a new reference.
  add(
    "add a reference to request 1 Look like",
    (next) =>
      next.requests[0].lookLike.references.push({
        token: { imageId: 3106516868104010, role: "patch", slot: 94 },
        source: Array.from({ length: 256 }, (_, cell) => Math.abs(Math.floor(cell / 16) - 5) <= 1 && Math.abs((cell % 16) - 9) <= 1),
      }),
    true,
    false,
  );
  return list;
}

/** The recipe with request 4 added, whose Look like has `count` references; then the same with its area moved. */
async function withReferences(base: any, count: number): Promise<any[]> {
  const manifest = await (await fetch(`${values.assets}/releases/pass-003.json`)).json();
  const block = await (await fetch(`${values.assets}/web/v2/readouts/${manifest.library.publication_id}/blocks/1000.json`)).json();
  const used = new Set(base.requests.flatMap((request: any) => request.lookLike.references.map((reference: any) => reference.token.imageId)));
  const entries: any[] = [];
  for (const entry of block.entries) {
    if (entry.band === "strong" && entry.role === "patch" && !used.has(entry.image_id) && !entries.some((other) => other.image_id === entry.image_id)) entries.push(entry);
  }
  if (entries.length < count) throw new Error(`Block 1000 has only ${entries.length} usable strong examples`);
  /** The 3 × 3 cells around a patch position, clipped to the grid. */
  const window = (position: number) =>
    Array.from({ length: 256 }, (_, cell) => Math.abs(Math.floor(cell / 16) - Math.floor(position / 16)) <= 1 && Math.abs((cell % 16) - (position % 16)) <= 1);
  const references = entries.slice(0, count).map((entry) => ({ token: { imageId: entry.image_id, role: "patch", slot: entry.slot }, source: window(entry.position) }));
  /** The new request; its Look like area is the 3 × 3 cells around `centre`. */
  const request = (centre: number) => ({
    id: 4,
    block: 1000,
    respondLike: { ...structuredClone(base.requests[1].respondLike), enabled: false, where: window(centre) },
    lookLike: { enabled: true, weight: 1, references, where: window(centre) },
  });
  // The second recipe moves the area only: the same references, nothing to download or encode.
  return [119, 121].map((centre) => ({ ...structuredClone(base), requests: [...structuredClone(base.requests), request(centre)] }));
}
const prepare = values.prepare === undefined ? undefined : await withReferences(recipe, Number(values.prepare));

const engineWasm = values["engine-wasm"];
const vite = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  cwd: app,
  // The worker reads ASSET_ENGINE_WASM relative to app/.env's ASSET_BASE_URL.
  env: { ...process.env, ...(engineWasm ? { ASSET_ENGINE_WASM: engineWasm } : {}) },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise<void>((done, fail) => {
  vite.stdout!.on("data", (chunk: Buffer) => chunk.toString().includes("Local:") && done());
  vite.once("exit", (code) => fail(new Error(`Vite exited with ${code}`)));
});

process.once("exit", () => vite.kill());
const browser = await chromium.launch({ channel: "chrome", headless: !values.headed });
try {
  const page = await browser.newPage();
  const console: string[] = [];
  page.on("console", (message) => {
    console.push(`${message.type()}: ${message.text()}`);
    if (message.type() === "error") process.stderr.write(`page console error: ${message.text()}\n`);
  });
  page.on("pageerror", (error) => process.stderr.write(`page error: ${error.message}\n`));
  // An empty page on Vite's origin, not the app: edits to app/ by others must not make
  // Vite reload the page mid-run. Modules and the worker still come from Vite.
  await page.route(`http://127.0.0.1:${PORT}/bench.html`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>synthesis bench</title>" }),
  );
  await page.goto(`http://127.0.0.1:${PORT}/bench.html`);
  const started = Date.now();
  const events = await page.evaluate(
    async ({ recipe, steps, assets, edits, loseDevice, replay, runFirst, prepare, reseedAt, reseed, restore }) => {
      // A browser path served by Vite, not a module this script resolves.
      const clientPath = "/src/synthesis/client.ts";
      const { createSynthesisClient } = await import(clientPath);
      let client = createSynthesisClient();
      const log: unknown[] = [];
      let waiters: { test: (event: any) => boolean; done: (event: any) => void }[] = [];
      let onFrame: ((frame: any) => void) | undefined;
      const handle = (event: any) => {
        if (event.type === "frame") onFrame?.(event);
        const kept = { ...event, at: performance.now() };
        if ("pixels" in kept) kept.pixels = kept.pixels.length; // Keep the report small.
        if (kept.type === "measurement") {
          kept.codes = kept.codes.map((code: any) => ({
            requestId: code.requestId,
            slots: Array.from(code.slots),
            meanError: code.errors.reduce((sum: number, error: number) => sum + error, 0) / code.errors.length,
          }));
        }
        log.push(kept);
        waiters = waiters.filter((waiter) => (waiter.test(event) ? (waiter.done(event), false) : true));
        if (event.type === "error" && event.fatal) waiters.forEach((waiter) => waiter.done(event));
      };
      client.subscribe(handle);
      const next = (test: (event: any) => boolean) => new Promise<any>((done) => waiters.push({ test, done }));
      client.send({ type: "load", release: { baseUrl: assets, manifestPath: "releases/pass-003.json" } });
      const loaded = await next((event) => event.type === "phase" && (event.phase === "ready" || event.phase === "failed"));
      // A fatal error answers every waiter; the worker then ignores everything but dispose.
      if (loaded.phase === "failed" || loaded.type === "error") return log;
      if (edits.length) {
        // Without a recipe, run and step must be refused explicitly.
        client.send({ type: "run" });
        await next((event) => event.type === "refused" && event.command === "run");
        client.send({ type: "step" });
        await next((event) => event.type === "refused" && event.command === "step");
      }
      client.send({ type: "apply", revision: 1, recipe });
      const applied = await next((event) => event.type === "applied" || event.type === "rejected");
      if (applied.type !== "applied") return log; // Rejected, or a fatal error.
      if (prepare) {
        const mark = (name: string) => log.push({ type: "marker", name, at: performance.now() });
        /** Apply, then step: the first frame of the new revision ends the preparation. */
        const time = async (label: string, revision: number, next_recipe: any) => {
          mark(`${label}:apply`);
          client.send({ type: "apply", revision, recipe: next_recipe });
          client.send({ type: "step" });
          const answer = await next((event) => event.type === "applied" || event.type === "rejected");
          if (answer.type !== "applied") throw new Error(`${label}: ${answer.message}`);
          await next((event) => event.type === "frame" && event.revision === revision);
          mark(`${label}:frame`);
        };
        client.send({ type: "step" });
        await next((event) => event.type === "frame");
        await time("cold", 2, prepare[0]);
        await time("hot", 3, prepare[1]);
        // A new worker in the same page: the previews are in the Cache API, the engine is new.
        client.dispose();
        client = createSynthesisClient();
        client.subscribe(handle);
        client.send({ type: "load", release: { baseUrl: assets, manifestPath: "releases/pass-003.json" } });
        await next((event) => event.type === "phase" && event.phase === "ready");
        client.send({ type: "apply", revision: 1, recipe });
        await next((event) => event.type === "applied");
        client.send({ type: "step" });
        await next((event) => event.type === "frame");
        await time("warm", 2, prepare[0]);
        client.dispose();
        return log;
      }
      if (loseDevice) {
        // Keep the client and log alive for the second phase, after the GPU process crashes.
        (window as any).synthesisLog = log;
        client.send({ type: "run" });
        await next((event) => event.type === "frame");
        await next((event) => event.type === "frame");
        return log;
      }
      if (edits.length) {
        const mark = (name: string) => log.push({ type: "marker", name, at: performance.now() });
        client.send({ type: "run" });
        client.send({ type: "apply", revision: 1, recipe });
        await next((event) => event.type === "applied");
        client.send({ type: "run" });
        let revision = 1;
        for (const edit of edits.slice(0, -1)) {
          await next((event) => event.type === "frame");
          client.send({ type: "apply", revision: edit.revision, recipe: edit.recipe });
          const answer = await next((event) => event.type === "applied" || event.type === "rejected");
          if (answer.type === "applied") revision = edit.revision;
          await next((event) => event.type === "frame" && event.revision === revision);
        }
        // Pause sent right behind an apply: no update may follow the pause's acknowledgement.
        const last = edits.at(-1)!;
        await next((event) => event.type === "frame");
        mark("pause-after-apply");
        client.send({ type: "apply", revision: last.revision, recipe: last.recipe });
        client.send({ type: "pause" });
        await next((event) => event.type === "applied" && event.revision === last.revision);
        await new Promise((done) => setTimeout(done, 6000));
        mark("run-again");
        client.send({ type: "run" });
        await next((event) => event.type === "frame" && event.revision === last.revision);
        client.send({ type: "pause" });
        await next((event) => event.type === "phase" && event.phase === "paused");
        client.dispose();
        return log;
      }
      if (replay) {
        // The applied seed's run, then a restart to the same seed in the same session.
        const runs = [];
        for (const pass of [0, 1]) {
          if (pass === 1) {
            client.send({ type: "restart", seed: recipe.seed });
            await next((event) => event.type === "restarted");
          }
          const losses: number[] = [];
          let pixels: number[] = [];
          // A restored run starts at the picture's step; its frames are counted from there.
          const first = restore?.step ?? 0;
          let completed = first;
          let restoredDifferences: number | undefined;
          if (restore) {
            const png = new Uint8Array(restore.png);
            client.send({ type: "restore", picture: png, step: restore.step });
            const answer = await next((event) => event.type === "restored" || event.type === "refused");
            if (answer.type === "refused") throw new Error(`restore: ${answer.message}`);
            const measured = await next((event) => event.type === "measurement");
            // The picture as stored: decoded without colour management, as the engine decodes it.
            const bitmap = await createImageBitmap(new Blob([png], { type: "image/png" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
            const canvas = new OffscreenCanvas(256, 256);
            const context = canvas.getContext("2d")!;
            context.drawImage(bitmap, 0, 0);
            const stored = context.getImageData(0, 0, 256, 256).data;
            restoredDifferences = 0;
            for (let index = 0; index < stored.length; index++) {
              if (index % 4 !== 3 && stored[index] !== measured.pixels[index]) restoredDifferences++;
            }
          }
          onFrame = (frame) => {
            losses[frame.step - first] = frame.loss;
            if (frame.step === first + steps - 1) pixels = Array.from(frame.pixels);
            completed = frame.step + 1;
          };
          if (runFirst[pass] > 0) {
            client.send({ type: "run" });
            await next((event) => event.type === "frame" && event.step + 1 >= runFirst[pass]);
            client.send({ type: "pause" });
            await next((event) => event.type === "phase" && event.phase === "paused");
          }
          const pausedAfter = completed;
          while (completed < first + steps) {
            if (completed === reseedAt) {
              client.send({ type: "reseed", cells: reseed.cells, seed: reseed.seed });
              await next((event) => event.type === "reseeded");
              await next((event) => event.type === "measurement");
            }
            client.send({ type: "step" });
            const frame = await next((event) => event.type === "frame");
            await next((event) => event.type === "measurement" && event.step === frame.step + 1);
          }
          onFrame = undefined;
          runs.push({ losses: losses.slice(0, steps), pixels, pausedAfter, restoredDifferences });
        }
        log.push({ type: "replay", runs });
        client.dispose();
        return log;
      }
      for (let step = 0; step < steps; step++) {
        client.send({ type: "step" });
        const frame = await next((event) => event.type === "frame" || (event.type === "phase" && event.message));
        if (frame.type === "phase") break;
        // A step ends with a measurement of the updated image.
        await next((event) => event.type === "measurement" && event.step === frame.step + 1);
      }
      client.dispose();
      return log;
    },
    {
      recipe,
      steps,
      assets: values.assets!,
      edits: values.edits ? edits() : [],
      loseDevice: values["lose-device"]!,
      replay: values.replay!,
      runFirst,
      prepare,
      reseedAt,
      reseed,
      restore,
    },
  );
  if (values["lose-device"]) {
    const crashedAt = Date.now();
    await (await browser.newBrowserCDPSession()).send("Browser.crashGpuProcess");
    const outcome = await page
      .waitForFunction(() => (window as any).synthesisLog.some((event: any) => event.type === "phase" && event.phase === "failed"), null, {
        timeout: 60_000,
      })
      .then(() => "failed explicitly")
      .catch(() => "no failure reported within 60 s");
    const after = await page.evaluate(() => (window as any).synthesisLog.slice(-6));
    process.stdout.write(`${JSON.stringify({ deviceLoss: outcome, secondsAfterCrash: (Date.now() - crashedAt) / 1000, lastEvents: after }, null, 2)}\n`);
  }
  const frames = (events as any[]).filter((event) => event.type === "frame");
  const measurements = (events as any[]).filter((event) => event.type === "measurement");
  const replay = values.replay ? replayChecks(events as any[]) : undefined;
  const summary = {
    label: values.label,
    steps: frames.length,
    firstLoss: frames[0]?.loss,
    lastLoss: frames.at(-1)?.loss,
    firstMeasured: measurements[0]?.terms,
    lastMeasured: measurements.at(-1)?.terms,
    medianStepMs: frames.map((frame) => frame.elapsedMs).sort((a, b) => a - b)[Math.floor(frames.length / 2)],
    gpuPoolMiB: frames
      .filter((frame) => frame.gpu)
      .map((frame) => ({ step: frame.step, used: frame.gpu.usedBytes / 2 ** 20, reserved: frame.gpu.reservedBytes / 2 ** 20 }))
      .filter((_, index, all) => index === 0 || index === all.length - 1 || index % 20 === 0),
    wallSeconds: (Date.now() - started) / 1000,
    errors: (events as any[]).filter((event) => event.type === "error" || event.type === "rejected"),
    edits: values.edits ? editChecks(events as any[], frames) : undefined,
    replay: replay?.summary,
    prepare: prepare ? preparationTimes(events as any[]) : undefined,
  };
  const output = resolve(root, "local/bench", `${new Date().toISOString().replace(/[:.]/g, "-")}-synthesis-${values.label}`);
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "report.json"), JSON.stringify({ summary, events, console }, null, 2));
  if (replay?.pixels) await writeFile(resolve(output, "pixels.rgba"), Uint8Array.from(replay.pixels));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\nReport: ${output}/report.json\n`);
} finally {
  vite.kill();
  await browser.close().catch(() => undefined); // A crashed GPU process can take the browser with it.
}

/** Per preparation: apply to first frame, split at the worker's download and encode phases. */
function preparationTimes(events: any[]) {
  const at = (name: string) => events.findIndex((event) => event.type === "marker" && event.name === name);
  return ["cold", "warm", "hot"].map((label) => {
    const start = at(`${label}:apply`);
    const end = at(`${label}:frame`);
    if (start < 0 || end < 0) return { label, completed: false };
    const window = events.slice(start, end + 1);
    const phase = (pattern: RegExp) => window.filter((event) => event.type === "phase" && pattern.test(event.message ?? ""));
    const download = phase(/^Downloading/)[0];
    const encoding = phase(/^Encoding reference/);
    const applied = window.find((event) => event.type === "applied");
    const begin = events[start].at;
    const marks = [...encoding.map((event) => event.at), applied?.at];
    return {
      label,
      applyToFrameMs: events[end].at - begin,
      recipeMs: (download?.at ?? encoding[0]?.at ?? applied?.at) - begin,
      downloadMs: download ? (encoding[0]?.at ?? applied?.at) - download.at : 0,
      encodeMs: encoding.map((event, index) => marks[index + 1] - event.at),
      appliedToFrameMs: events[end].at - applied?.at,
    };
  });
}

/** Compare restarted runs and retain the first run's final pixels. */
function replayChecks(events: any[]) {
  const replay = events.find((event) => event.type === "replay");
  if (!replay) return { summary: { completed: false } }; // Load or apply failed: see errors.
  const [first, second] = replay.runs as { losses: number[]; pixels: number[]; pausedAfter: number; restoredDifferences?: number }[];
  const differences = first.pixels.map((value, index) => Math.abs(value - second.pixels[index]));
  const summary = {
    pausedAfter: [first.pausedAfter, second.pausedAfter],
    reseededAt: events.filter((event) => event.type === "reseeded").map((event) => event.step),
    restoredAt: events.filter((event) => event.type === "restored").map((event) => event.step),
    /** Per run, the RGB values of the measurement after the restore that differ from the stored picture. */
    restoredDifferences: [first.restoredDifferences, second.restoredDifferences],
    firstDifferentStep: first.losses.findIndex((loss, step) => loss !== second.losses[step]),
    largestLossDifference: Math.max(...first.losses.map((loss, step) => Math.abs(loss - second.losses[step]))),
    finalLosses: [first.losses.at(-1), second.losses.at(-1)],
    pixelValuesDifferent: differences.filter((difference) => difference > 0).length,
    largestPixelDifference: differences.reduce((largest, difference) => Math.max(largest, difference), 0),
    meanPixelDifference: differences.reduce((sum, difference) => sum + difference, 0) / differences.length,
    pixelHashes: [first, second].map((run) => createHash("sha256").update(Uint8Array.from(run.pixels)).digest("hex")),
    losses: [first.losses, second.losses],
  };
  delete replay.runs; // Keep the report small.
  return { summary, pixels: first.pixels };
}

/** Each edit's acknowledgement matches the protocol, and the run never restarted. */
function editChecks(events: any[], frames: any[]) {
  const list = edits();
  const checks = list.map((edit) => {
    const answer = events.find((event) => (event.type === "applied" || event.type === "rejected") && event.revision === edit.revision);
    const passed =
      edit.outcome === "rejected"
        ? answer?.type === "rejected"
        : answer?.type === "applied" && answer.resetAdam === edit.resetAdam && answer.rebased === edit.rebased;
    return { edit: edit.name, revision: edit.revision, passed, answer: answer && { type: answer.type, resetAdam: answer.resetAdam, rebased: answer.rebased, message: answer.message } };
  });
  // After a rejected edit, frames keep the last applied revision and the previous TV weight.
  const rejectedKeptState = list
    .filter((edit) => edit.outcome === "rejected")
    .every((edit) => {
      const rejectedAt = events.findIndex((event) => event.type === "rejected" && event.revision === edit.revision);
      const nextFrame = events.slice(rejectedAt).find((event) => event.type === "frame");
      const tv = nextFrame?.terms.find((term: any) => term.id === "rules:tv");
      const lastApplied = list.filter((other) => other.outcome === "applied" && other.revision < edit.revision).at(-1)?.revision ?? 1;
      return rejectedAt >= 0 && nextFrame?.revision === lastApplied && Math.abs(tv.weighted / tv.raw - recipe.rules.tv.weight) < 1e-6;
    });
  const refusedBeforeRecipe = ["run", "step"].every((command) =>
    events.findIndex((event) => event.type === "refused" && event.command === command) < events.findIndex((event) => event.type === "applied"),
  );
  // Pause sent right behind an apply: no frame between that pause and the next run.
  const pauseAt = events.findIndex((event) => event.type === "marker" && event.name === "pause-after-apply");
  const runAt = events.findIndex((event) => event.type === "marker" && event.name === "run-again");
  const window = events.slice(pauseAt, runAt);
  const framesAfterAck = window.slice(window.findIndex((event) => event.type === "phase" && event.phase === "paused")).filter((event) => event.type === "frame");
  const pausePriority = window.some((event) => event.type === "phase" && event.phase === "paused") && framesAfterAck.length === 0;
  const consecutive = frames.every((frame, index) => index === 0 || frame.step === frames[index - 1].step + 1);
  const preparingWhileRunning = events.some((event) => event.type === "phase" && event.phase === "preparing");
  return { checks, rejectedKeptState, refusedBeforeRecipe, pausePriority, consecutiveSteps: consecutive, preparingWhileRunning };
}
