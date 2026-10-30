import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptions, withTimeout } from "../benchmarks/options.ts";
import {
  compareReports,
  statistics,
  summarize,
} from "../benchmarks/report.ts";
import type { Report } from "../benchmarks/report.ts";
import { runMeasurements } from "../benchmarks/measurements.ts";
import type { BrowserResult, Request } from "../benchmarks/protocol.ts";

test("benchmark options default to headless with an explicit workload", () => {
  const options = parseOptions([]);
  assert.equal(options.headed, false);
  assert.equal(options.settings.warmup, 5);
  assert.equal(options.settings.steps, 20);
  assert.equal(options.settings.profileSteps, 5);
  assert.equal(
    parseOptions(["--headed", "--label", "baseline-a"]).headed,
    true,
  );
  for (const args of [
    ["--steps", "0"],
    ["--steps", "NaN"],
    ["--steps"],
    ["--unknown", "x"],
    ["--label", "../escape"],
  ]) {
    assert.throws(() => parseOptions(args));
  }
});

test("statistics use a median and nearest-rank p90, not a minimum speed claim", () => {
  assert.deepEqual(statistics([40, 10, 30, 20]), {
    count: 4,
    median: 25,
    p90: 40,
    minimum: 10,
    maximum: 40,
  });
  assert.throws(() => statistics([]));
  assert.throws(() => statistics([NaN]));
  assert.throws(() => statistics([-1]));
});

test("timeouts reject and normal errors propagate", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 100), 7);
  await assert.rejects(withTimeout(new Promise(() => {}), 5), /timed out/);
  await assert.rejects(
    withTimeout(Promise.reject(new Error("device lost")), 100),
    /device lost/,
  );
});

function report(): Report {
  const sample = {
    step: 5,
    worker_ms: 100,
    round_trip_ms: 101,
    before: null,
    after: null,
  };
  const mode = {
    first: sample,
    warmup: [sample],
    samples: [sample],
    final: { step: 6, loss: 0.2 },
  };
  const capabilities = {
    adapter: {
      name: "GPU",
      vendor: 1,
      device: 1,
      device_type: "Other",
      driver: "",
      driver_info: "",
      backend: "BrowserWebGpu",
      is_fallback: false,
    },
    features: "TIMESTAMP_QUERY",
    timestamps: true,
    shader_f16: true,
    limits: {},
    precision: { weights: "fp32" },
    features_build: { fusion: false, autotune: false },
  };
  return {
    schema: 1,
    label: "test",
    createdAt: "2026-10-09",
    build: { revision: "abc", dirty: false, changes: "", mode: "release" },
    environment: {
      browserVersion: "154",
      headless: true,
      platform: "darwin",
      arch: "arm64",
      gpuDevices: [],
      gpuFeatures: {},
    },
    events: [],
    requests: [],
    errors: [],
    browser: {
      settings: parseOptions([]).settings,
      qualification: {
        passed: true,
        checks: [],
        profile_equivalence: "checked",
      },
      performanceLoad: {
        capabilities,
        manifestId: "model",
        targetPath: "block100",
        optimizer: { step: 0.0125, levelRates: [4, 2.83, 2, 1.41, 1], robustView: true },
        cacheHits: 14,
        startup: { total_ms: 1, wasm_ms: 1, device_ms: 0, assets_ms: 0 },
        networkRequests: 0,
        networkBytes: 0,
      },
      modes: { compute: mode, frame: mode },
    },
  };
}

test("report comparison rejects device, precision and failed qualification mismatches", () => {
  const a = report();
  const b = report();
  assert.match(compareReports(a, b).join("\n"), /1\.000×/);
  b.environment.headless = false;
  assert.match(compareReports(a, b)[0], /not ranked.*browser\/device/);
  b.environment.headless = true;
  b.browser!.performanceLoad!.capabilities.precision.weights = "fp16";
  assert.match(compareReports(a, b)[0], /different precision/);
  b.browser!.qualification!.passed = false;
  assert.match(compareReports(a, b)[0], /did not pass qualification/);
});

test("report comparison requires matching recorded optimizer settings", () => {
  const a = report();
  const b = report();
  b.browser!.performanceLoad!.optimizer!.robustView = false;
  assert.match(compareReports(a, b)[0], /not ranked.*different optimizer/);
  delete a.browser!.performanceLoad!.optimizer;
  delete b.browser!.performanceLoad!.optimizer;
  assert.match(compareReports(a, b)[0], /not ranked.*missing optimizer metadata/);
  assert.match(summarize(a), /First update:/);
});

test("incomplete runs still produce a useful summary", () => {
  const partial = report();
  partial.browser = undefined;
  partial.errors.push("Worker crashed");
  partial.events.push({
    type: "check",
    check: {
      name: "first check",
      shape: [1],
      relative_rms: 0,
      max_absolute: 0,
      tolerance: 1e-5,
      passed: true,
    },
  });
  assert.match(summarize(partial), /Worker crashed/);
  assert.match(
    summarize(partial),
    /Qualification: incomplete; recorded checks: 1/,
  );
  assert.match(summarize(partial), /not the exact peak/);
});

test("frame breakdown uses the same median and supports a partially measured run", () => {
  const partial = report();
  partial.browser!.frameBreakdown = [10, 30].map((milliseconds) => ({
    waitFirst: false,
    submission_ms: milliseconds,
    gpu_wait_ms: milliseconds,
    readback_ms: milliseconds,
    conversion_ms: milliseconds,
    total_ms: milliseconds,
  }));
  const summary = summarize(partial);
  assert.match(summary, /at once, as in step\(\) \| 20\.0 ms/);
  assert.doesNotMatch(summary, /after the GPU queue is done/);
});

test("missing timestamps retains compute and frame tests without calling the profiler", async () => {
  const settings = { ...parseOptions([]).settings, warmup: 1, steps: 2 };
  const result: BrowserResult = { settings, modes: {} };
  const requests: Request[] = [];
  let updates = 0;
  await runMeasurements(
    {
      async call<T>(request: Request): Promise<T> {
        requests.push(request);
        if (request.type === "restart") {
          updates = 0;
          return null as T;
        }
        if (request.type === "measure")
          return { step: updates, loss: 0.1 } as T;
        if (request.type === "products") return [] as T;
        if (request.type === "frame-breakdown") return { waitFirst: request.waitFirst } as T;
        if (request.type === "step") {
          assert.notEqual(request.mode, "profile");
          const step = updates++;
          return {
            step,
            worker_ms: 1,
            before: null,
            after: null,
            frame:
              request.mode === "frame"
                ? {
                    step,
                    loss: 0.1,
                    views: 2,
                    pixels: new Uint8ClampedArray(4 * 256 * 256),
                  }
                : undefined,
          } as T;
        }
        throw new Error("Loading does not belong inside a measurement loop");
      },
    },
    settings,
    false,
    result,
    () => {},
  );
  assert.equal(result.modes.compute?.samples.length, 2);
  assert.equal(result.modes.frame?.samples.length, 2);
  assert.equal(result.modes.profile, undefined);
  assert.match(result.profileUnavailable!, /No timestamp-query/);
  assert.deepEqual(result.products, []);
  assert.equal(
    requests.filter((request) => request.type === "restart").length,
    2,
  );
});

test("a frame-delivery failure preserves completed compute measurements", async () => {
  const settings = { ...parseOptions([]).settings, warmup: 1, steps: 1 };
  const result: BrowserResult = { settings, modes: {} };
  let updates = 0;
  await assert.rejects(
    runMeasurements(
      {
        async call<T>(request: Request): Promise<T> {
          if (request.type === "restart") {
            updates = 0;
            return null as T;
          }
          if (request.type === "measure")
            return { step: updates, loss: 0.1 } as T;
          if (request.type === "step")
            return {
              step: updates++,
              worker_ms: 1,
              before: null,
              after: null,
            } as T;
          throw new Error("Unexpected request");
        },
      },
      settings,
      false,
      result,
      () => {},
    ),
    /did not deliver preview pixels/,
  );
  assert.equal(result.modes.compute?.samples.length, 1);
  assert.equal(result.modes.frame, undefined);
});
