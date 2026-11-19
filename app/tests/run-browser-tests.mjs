// Run against this checkout's routes and a known gallery entry. Vite serves the recorded
// pictures and grids locally. Its remote-library proxy reads the pinned model release.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { layoutViewports } from "./how-layout-viewports.mjs";
import { createServer } from "vite";
import { materialEntry } from "../src/features/gallery/material-index.ts";

const id = "block-4009-figure-pyramid-strongest-seed-0";
const root = resolve(import.meta.dirname, "..");
const definition = await readFile(resolve(root, "../gallery/seed/materials", id + ".material.json"));
const poster = await readFile(resolve(root, "public/how/training/automaton-4009/picture-128.png"));
const entry = materialEntry(id, JSON.parse(definition), { title: "Hibiscus", credit: "" }, "2026-11-18");
const responses = new Map([
  ["/api/materials", ["application/json", JSON.stringify({ entries: [{ ...entry, featured: true }] })]],
  ["/api/materials/" + id + "/material.json", ["application/json", definition]],
  ["/api/materials/" + id + "/poster.png", ["image/png", poster]],
]);
const tasks = process.argv.slice(2);
const ownerTest = tasks.some((task) => task.endsWith("owner-browser.test.mjs"));
let appUrl;
let ownerWorker;
if (ownerTest) {
  const { startOwnerWorker } = await import("./owner-worker-fixture.mjs");
  ownerWorker = await startOwnerWorker(definition, () => appUrl);
  process.env.GALLERY_WORKER = ownerWorker.url;
}
const server = await createServer({
  root,
  mode: "remote",
  cacheDir: process.env.BROWSER_TEST_CACHE,
  server: { host: "127.0.0.1", port: 0, watch: null },
  plugins: [
    {
      name: "browser-test-gallery",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const answer = responses.get(req.url?.split("?")[0]);
          if (!answer) return next();
          res.setHeader("Content-Type", answer[0]);
          res.end(answer[1]);
        });
      },
    },
  ],
});
try {
  await server.listen();
  const url = server.resolvedUrls.local[0].replace(/\/$/, "");
  appUrl = url;
  if (!tasks.length) throw new Error("Supply browser test files.");
  const elapsed = {};
  for (const task of tasks) {
    const [name, viewport = ""] = task.split("#");
    const filename = name.replace(/^app\/tests\//, "");
    if (!/^[\w-]+-browser\.test\.mjs$/.test(filename)) throw new Error("Unknown browser test " + name);
    if (
      viewport &&
      (filename !== "how-layout-browser.test.mjs" ||
        !layoutViewports.some((size) => size.width + "-" + size.height === viewport))
    ) {
      throw new Error("Unknown layout viewport " + task);
    }
    const start = performance.now();
    const tests = spawn(process.execPath, ["--test", resolve(import.meta.dirname, filename)], {
      stdio: "inherit",
      env: {
        ...process.env,
        SHELL_TEST_BASE_URL: url,
        SHELL_GALLERY_TEST_BASE_URL: url,
        HOW_LAYOUT_VIEWPORTS: viewport,
      },
    });
    const code = await new Promise((done, fail) => {
      tests.once("error", fail);
      tests.once("exit", (value) => done(value ?? 1));
    });
    if (code !== 0) {
      process.exitCode = code;
      break;
    }
    elapsed[task] = Math.round(performance.now() - start);
  }
  if (process.env.TEST_DURATION_FILE && !process.exitCode) {
    await writeFile(process.env.TEST_DURATION_FILE, JSON.stringify(elapsed) + "\n");
  }
} finally {
  ownerWorker?.close();
  await server.close();
}
