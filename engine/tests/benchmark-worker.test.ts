import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";

test("the benchmark worker installs the fixture optimizer unchanged", async () => {
  const specs = JSON.parse(readFileSync(new URL("../tools/fixtures/evidence-specs.json", import.meta.url), "utf8"));
  const recipe = JSON.parse(readFileSync(new URL("../tools/fixtures/evidence-recipe.json", import.meta.url), "utf8"));
  let installed: unknown;
  const engine = {
    harness_capabilities_json: () => JSON.stringify({ adapter: { is_fallback: false } }),
    load_stem() {}, load_layer() {}, load_calibration() {}, load_frame() {},
    references_to_encode: () => [],
    install: (text: string) => { installed = JSON.parse(text); },
    harness_complete: async () => {},
  };
  const replies: { id?: number; error?: string; result?: { optimizer?: unknown } }[] = [];
  const worker = { onmessage: null as null | ((event: unknown) => Promise<void>), postMessage: (reply: object) => replies.push(reply) };
  const values = {
    self: worker,
    location: { href: "http://localhost/worker.js" },
    fetch: async (url: URL) => new Response(JSON.stringify(url.pathname.endsWith("evidence-specs.json") ? specs : recipe)),
    benchmarkTest: {
      BrowserEngine: { create: async () => engine },
      AssetLoader: class {
        cacheHits = 0;
        networkRequests = 0;
        networkBytes = 0;
        async open() {}
        async bytes() { return new Uint8Array(); }
      },
    },
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, values);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith("/pkg-harness/dinodreamer_engine")) return { url: "test:engine", shortCircuit: true };
      if (specifier.endsWith("/synthesis/assets")) return { url: "test:assets", shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === "test:engine") return {
        format: "module", shortCircuit: true,
        source: "export const BrowserEngine = globalThis.benchmarkTest.BrowserEngine; export default async function init() {}",
      };
      if (url === "test:assets") return {
        format: "module", shortCircuit: true,
        source: `export const AssetLoader = globalThis.benchmarkTest.AssetLoader;
          export const fetchModelRelease = async () => ({ release: "fixture", encoder: ["stem", "layer"], calibration: "calibration" });
          export const blockPath = () => "block"; export const previewPath = () => "preview";`,
      };
      return nextLoad(url, context);
    },
  });
  try {
    await import("../benchmarks/worker.ts");
    await worker.onmessage!({ data: { id: 1, request: { type: "load", releaseUrl: "http://localhost/", settings: { seed: 17 } } } });
    assert.equal(replies.find((reply) => reply.id === 1)?.error, undefined);
    assert.deepEqual(installed, {
      objective: specs.objective,
      probes: specs.probes,
      optimizer: specs.optimizer,
      editable: recipe.protect.map((protectedCell: boolean) => !protectedCell),
      seed: 17,
    });
    assert.deepEqual(replies.find((reply) => reply.id === 1)?.result?.optimizer, specs.optimizer);
  } finally {
    hooks.deregister();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
