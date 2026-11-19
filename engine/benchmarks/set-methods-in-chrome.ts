// The set methods in Chrome's WebGPU, through the engine's WebAssembly entry points as the Train
// worker calls them: prepare a target set from the library's preview PNGs (decoded in the engine),
// then train each method from one seed in alternating turns.
// It reports the set's preparation time and summary, each method's first-update terms and the median
// time per update with its median per-index ratio to the first method:
//
//   node benchmarks/set-methods-in-chrome.ts --set tools/fixtures/target-set-12002-pole-3x3.json \
//     --previews <folder of <imageId>.png> --output <report.json> <fixture>...
//
// It needs `pnpm build:engine` (pkg/) and local/release assets. The fixtures give the
// requests; the first is the reference. Chrome runs headless with its own GPU process. With
// `--profile <prefix>` it then records a CPU profile of `--profile-updates` more updates of each method,
// `<prefix>-<n>-<method>.cpuprofile`; `--batch 1` overrides every request's batch; `--ladder-rule
// <rule.json>` (of grow_recipe_train) reads that rule on the live grid (seed 9317) across the reading
// tick ladder with `figure_own_loss`, against the set of the run with its method and layers, and times it; `--package pkg-profile` serves a build that keeps function names
// (CARGO_PROFILE_RELEASE_STRIP=false wasm-pack build --target web --release --out-dir pkg-profile).
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ENCODER = "model/dinov3-vitb16-pretrain-lvd1689m";
const DICTIONARY = "model/monet-dtd-seed9-20261004-pass-003";
const CONTENT_TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };

interface Options {
  set: string; previews: string; output: string; rounds: number; updates: number; fixtures: string[];
  packageFolder: string; profile: string | null; profileUpdates: number; batch: number | null; ladderRule: string | null;
}

function parseOptions(values: string[]): Options {
  const named = (name: string, fallback?: string) => {
    const index = values.indexOf(name);
    if (index >= 0) return values[index + 1];
    if (fallback === undefined) throw new Error(`${name} is required`);
    return fallback;
  };
  const fixtures = values.filter((value, index) => value.endsWith(".json") && !values[index - 1]?.startsWith("--"));
  return {
    set: named("--set"), previews: named("--previews"), output: named("--output"),
    rounds: Number(named("--rounds", "5")), updates: Number(named("--updates", "10")), fixtures,
    batch: named("--batch", "") ? Number(named("--batch", "")) : null, ladderRule: named("--ladder-rule", "") || null, packageFolder: named("--package", "pkg"), profile: named("--profile", "") || null, profileUpdates: Number(named("--profile-updates", "6")),
  };
}

/** Serve the engine package, the local release and the previews; the page itself is inline. */
async function serve(root: string, packageFolder: string, previews: string, page: string) {
  const folders: Record<string, string> = {
    "/pkg/": resolve(root, packageFolder), "/release/": resolve(root, "local/release"), "/previews/": resolve(previews),
  };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.writeHead(200, { "Content-Type": "text/html" }).end(page);
      return;
    }
    const prefix = Object.keys(folders).find((candidate) => path.startsWith(candidate));
    const file = prefix ? resolve(folders[prefix], decodeURIComponent(path.slice(prefix.length))) : "";
    if (!prefix || !file.startsWith(folders[prefix] + sep)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local server address");
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise<void>((done) => server.close(() => done())) };
}

/** Runs in the page: load the model, prepare the set twice (the first compiles the kernels), train in turns. */
async function measure(input: {
  encoder: string; dictionary: string; block: number; requests: Record<string, unknown>[];
  pictures: { source: number; patch: number }[]; rounds: number; updates: number;
}) {
  const engineModule = await import("/pkg/dinodreamer_engine.js" as string);
  await engineModule.default();
  const bytes = async (path: string) => new Uint8Array(await (await fetch(path)).arrayBuffer());
  const engine = await engineModule.BrowserEngine.create();
  engine.load_stem(await bytes(`/release/${input.encoder}/encoder-stem.safetensors`));
  for (let layer = 0; layer < 12; layer++) {
    engine.load_layer(layer, await bytes(`/release/${input.encoder}/encoder-layer-${String(layer).padStart(2, "0")}.safetensors`));
  }
  engine.load_calibration(await bytes(`/release/${input.dictionary}/calibration.safetensors`));
  engine.load_frame(input.block, await bytes(`/release/${input.dictionary}/blocks/${String(input.block).padStart(5, "0")}.safetensors`));
  const pngs = await Promise.all(input.pictures.map((picture) => bytes(`/previews/${picture.source}.png`)));
  const patches = new Uint32Array(input.pictures.map((picture) => picture.patch));
  const runs = [];
  for (const fixtureRequest of input.requests) {
    // A request without a method is basis-group mean matching, as every request before the set methods.
    const request: Record<string, unknown> = { method: "basis-group-mean", ...fixtureRequest };
    const json = JSON.stringify(request);
    let set = null;
    const preparationMs: number[] = [];
    if (request.method !== "basis-group-mean") {
      for (let attempt = 0; attempt < 2; attempt++) {
        const started = performance.now();
        set = await engine.prepare_figure_set(json, pngs, patches);
        preparationMs.push(performance.now() - started);
      }
    }
    const training = set ? engine.create_figure_on_set(json, set) : engine.create_figure(json);
    runs.push({ request, set: set ? JSON.parse(set.summary()) : null, preparedSet: set, preparationMs, training, first: null as unknown, seconds: [] as number[],
      dispatches: [] as number[], steps: [] as number[] });
  }
  for (let round = 0; round < input.rounds; round++) {
    for (const run of runs) {
      for (let update = 0; update < input.updates; update++) {
        const counts = (globalThis as Record<string, unknown>).webgpuCounts as { dispatches: number };
        const dispatchesBefore = counts.dispatches;
        const started = performance.now();
        const record = JSON.parse(await engine.figure_update(run.training));
        if (run.first === null) run.first = record;
        if (round > 0) {
          run.seconds.push((performance.now() - started) / 1000);
          run.dispatches.push(counts.dispatches - dispatchesBefore);
          run.steps.push(record.plan.steps);
        }
      }
    }
  }
  // Kept for the profile's updates (`profiledUpdates`).
  (globalThis as Record<string, unknown>).setMethodsState = {
    engine, trainings: runs.map((run) => run.training), sets: runs.map((run) => run.preparedSet), requests: runs.map((run) => run.request),
  };
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const reference = runs[0].seconds;
  return runs.map((run) => ({
    method: run.request.method, layers: run.request.layers ?? [], set: run.set, preparationMs: run.preparationMs, firstUpdate: run.first,
    medianSecondsPerUpdate: median(run.seconds), medianRatioToReference: median(run.seconds.map((time, index) => time / reference[index])),
    updatesMeasured: run.seconds.length, seconds: run.seconds, dispatches: run.dispatches, steps: run.steps,
  }));
}

/** Runs in the page after `measure`: `count` more updates of one run. */
async function profiledUpdates(input: { index: number; count: number }) {
  const state = (globalThis as Record<string, unknown>).setMethodsState as { engine: { figure_update(training: unknown): Promise<string> }; trainings: unknown[] };
  for (let update = 0; update < input.count; update++) await state.engine.figure_update(state.trainings[input.index]);
}

/** Runs in the page after `measure`: a saved rule on the live grid, read at the ladder with `figure_own_loss`. */
async function ownLossLadder(input: { request: Record<string, unknown>; values: number[]; ladder: number[] }) {
  const state = (globalThis as Record<string, unknown>).setMethodsState as {
    engine: Record<string, (...values: unknown[]) => any>; sets: unknown[]; requests: Record<string, unknown>[];
  };
  const sameLayers = (request: Record<string, unknown>) => JSON.stringify(request.layers ?? []) === JSON.stringify(input.request.layers ?? []);
  const index = state.requests.findIndex((request) => request.method === input.request.method && sameLayers(request));
  if (index < 0 || !state.sets[index]) throw new Error("No run prepared a set for the ladder rule's method and layers");
  const grid = state.engine.create_figure_grid(9317, input.request.rule, input.request.start);
  grid.set_rule(new Float32Array(input.values));
  const readings = [];
  for (const tick of input.ladder) {
    await grid.advance(tick - grid.tick());
    const started = performance.now();
    const loss = await state.engine.figure_own_loss(grid, JSON.stringify(input.request), state.sets[index]);
    readings.push({ tick, loss, ms: performance.now() - started });
  }
  return readings;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const set = JSON.parse(await readFile(resolve(options.set), "utf8"));
  const requests = await Promise.all(options.fixtures.map(async (path) => {
    const request = JSON.parse(await readFile(resolve(path), "utf8")).request;
    return options.batch ? { ...request, batch: options.batch } : request;
  }));
  if (requests.some((request) => request.block !== set.block)) throw new Error("Every request must be the set's basis group's");
  const server = await serve(root, options.packageFolder, options.previews, "<!doctype html><meta charset=utf-8><title>Set methods</title>");
  const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage();
    // Count every compute dispatch before the engine loads; each measured update records its own count.
    await page.addInitScript(() => {
      const counts = { dispatches: 0 };
      (globalThis as Record<string, unknown>).webgpuCounts = counts;
      const prototype = GPUComputePassEncoder.prototype;
      const dispatch = prototype.dispatchWorkgroups;
      prototype.dispatchWorkgroups = function (...values: Parameters<typeof dispatch>) {
        counts.dispatches += 1;
        return dispatch.apply(this, values);
      };
    });
    page.on("console", (message) => console.error(`page: ${message.text()}`));
    await page.goto(server.url);
    const runs = await page.evaluate(measure, {
      encoder: ENCODER, dictionary: DICTIONARY, block: set.block, requests, pictures: set.pictures, rounds: options.rounds, updates: options.updates,
    });
    const report = { browser: browser.version(), set: options.set, rounds: options.rounds, updatesPerRound: options.updates, runs };
    await writeFile(resolve(options.output), JSON.stringify(report, null, 1) + "\n");
    if (options.ladderRule) {
      const rule = JSON.parse(await readFile(resolve(options.ladderRule), "utf8"));
      const ladder = [100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000];
      const readings = await page.evaluate(ownLossLadder, { request: rule.request, values: rule.values, ladder });
      await writeFile(resolve(options.output.replace(/\.json$/, "-own-loss-ladder.json")), JSON.stringify({ rule: options.ladderRule, readings }, null, 1) + "\n");
      console.log(JSON.stringify(readings));
    }
    if (options.profile) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      for (const [index, run] of runs.entries()) {
        await cdp.send("Profiler.start");
        await page.evaluate(profiledUpdates, { index, count: options.profileUpdates });
        const { profile } = await cdp.send("Profiler.stop");
        const name = `${options.profile}-${index}-${run.method}${(run.layers as string[]).length ? `-${(run.layers as string[]).length}-layers` : ""}.cpuprofile`;
        await writeFile(resolve(name), JSON.stringify(profile));
      }
    }
    console.log(JSON.stringify(runs.map(({ method, layers, preparationMs, medianSecondsPerUpdate, medianRatioToReference }) =>
      ({ method, layers, preparationMs, medianSecondsPerUpdate, medianRatioToReference }))));
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
