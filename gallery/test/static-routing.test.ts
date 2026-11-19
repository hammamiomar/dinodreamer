import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_readConfig } from "wrangler";
import { expect, it } from "vitest";

// Fetch sets Sec-Fetch-Mode itself. Send browser navigation headers through the HTTP listener.
function requestWithMode(url: URL, mode = "cors"): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "Sec-Fetch-Mode": mode } }, resolve).on("error", reject);
  });
}

// A marker identifies requests that reach application code. The Worker tests cover its responses.
it("serves current build files directly and sends stale files, owner pages and previews to the Worker", async () => {
  const config = unstable_readConfig({ config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) });
  const assets = config.assets!;
  const directory = mkdtempSync(join(tmpdir(), "dinodreamer-static-routing-"));
  const current = ["/assets/index-12345678.js", "/assets/style-12345678.css", "/assets/engine.worker-12345678.js"];
  const recording = "/how/recorded/manifest.json";
  // Matching files must never conceal the owner check or the preview tags.
  const files = [...current, recording, "/admin/index.html", "/how/index.html", "/index.html"];
  for (const path of files) {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path);
  }
  copyFileSync(new URL("../../app/public/_headers", import.meta.url), join(directory, "_headers"));
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch(request) { return new Response("Worker " + request.headers.get("Sec-Fetch-Mode")); } };',
    compatibilityDate: config.compatibility_date!,
    compatibilityFlags: config.compatibility_flags,
    cf: false,
    telemetry: { enabled: false },
    assets: {
      directory,
      binding: assets.binding,
      run_worker_first: assets.run_worker_first,
      routerConfig: { has_user_worker: true },
      assetConfig: { not_found_handling: assets.not_found_handling, html_handling: assets.html_handling },
    },
  }));
  try {
    const local = await runtime.ready;
    for (const path of current) {
      const response = await requestWithMode(new URL(path, local));
      expect(response.statusCode, path).toBe(200);
      expect(await text(response), path).toBe(path);
      expect(response.headers["cache-control"], path).toBe("public, max-age=31536000, immutable");
    }
    const manifest = await requestWithMode(new URL(recording, local));
    expect(await text(manifest)).toBe(recording);
    expect(manifest.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");

    for (const path of ["/assets/page-removed0.js", "/assets/engine.worker-removed0.js", "/admin/", "/how/", "/basis/12"]) {
      for (const mode of ["cors", "navigate"]) {
        const response = await requestWithMode(new URL(path, local), mode);
        expect(await text(response), path).toBe(`Worker ${mode}`);
      }
    }
  } finally {
    await runtime.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
