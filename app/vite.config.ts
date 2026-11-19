import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { extname, join, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { loadEnv, searchForWorkspaceRoot } from "vite";
import { defineConfig, type Plugin } from "vitest/config";
import unitTestPatterns from "../ci/unit-test-patterns.ts";

const FIXTURE_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".bin": "application/octet-stream",
};

/** Resolve a request inside a development asset directory. */
export function localAssetPath(root: string, requestUrl: string): string | null {
  try {
    const directory = resolve(root);
    const path = resolve(join(directory, decodeURIComponent(requestUrl.split("?")[0])));
    return path.startsWith(directory + sep) ? path : null;
  } catch {
    return null;
  }
}

/** Serve the small fixture release only in development; these files are not production assets. */
function serveFixtures(): Plugin {
  const root = join(import.meta.dirname, "fixtures");
  return {
    name: "serve-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/fixtures", async (request, response, next) => {
        // Let Vite transform JSON module imports.
        if (new URL(request.url ?? "/", "http://localhost").searchParams.has("import")) return next();
        const path = localAssetPath(root, request.url ?? "/");
        if (path === null) {
          response.statusCode = 400;
          response.end("Invalid asset path");
          return;
        }
        try {
          const body = await readFile(path);
          response.setHeader("Content-Type", FIXTURE_TYPES[extname(path)] ?? "application/octet-stream");
          response.end(body);
        } catch {
          // A file the fixture release lacks answers 404, as the bucket does; the SPA fallback would answer index.html.
          response.statusCode = 404;
          response.end("not in the fixture release");
        }
      });
    },
  };
}

/**
 * `LIBRARY_OVERLAY=<dir> pnpm develop:remote`: a file under <dir>, at its bucket path,
 * answers before the public bucket. So a table that is not published yet (the
 * provenance table, with the manifest that names it) can be browsed over the
 * real library. Dev server only; without the variable nothing changes.
 */
function serveLibraryOverlay(): Plugin {
  const roots = [process.env.ATLAS_ASSETS, process.env.READER_ASSETS, process.env.LIBRARY_OVERLAY]
    .filter((path): path is string => Boolean(path)).map((path) => resolve(path));
  return {
    name: "serve-library-overlay",
    apply: "serve",
    configureServer(server) {
      if (!roots.length) return;
      // Plugin middleware runs before Vite's proxy, so a missing file falls through to the bucket.
      server.middlewares.use("/remote-library", async (request, response, next) => {
        for (const root of roots) {
          const path = localAssetPath(root, request.url ?? "/");
          if (path === null) {
            response.statusCode = 400;
            response.end("Invalid asset path");
            return;
          }
          try {
            const body = await readFile(path);
            response.setHeader("Content-Type", FIXTURE_TYPES[extname(path)] ?? "application/octet-stream");
            response.setHeader("Cache-Control", "no-cache");
            response.end(body);
            return;
          } catch { /* Try the next local source, then the public bucket. */ }
        }
        next();
      });
      for (const root of roots) server.config.logger.info(`  library overlay: ${root} answers before the bucket`);
    },
  };
}

/** The public bucket named in app/.env, whatever the current mode overrides. */
const PUBLIC_LIBRARY_URL = loadEnv("production", import.meta.dirname, "ASSET_").ASSET_BASE_URL;

// Keep the build's source revision with newly grown files, including local dirty builds.
let buildRevision = "unversioned";
try {
  buildRevision = execFileSync("git", ["describe", "--always", "--dirty", "--abbrev=40"], {
    cwd: import.meta.dirname,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch { /* A source archive can still build without Git metadata. */ }

export default defineConfig(({ isPreview }) => ({
  define: { "import.meta.env.VITE_BUILD_REVISION": JSON.stringify(buildRevision) },
  plugins: [react(), serveFixtures(), serveLibraryOverlay()],
  server: {
    // The engine package is linked from ../engine/pkg, outside the app root.
    fs: { allow: [searchForWorkspaceRoot(import.meta.dirname), "../engine/pkg"] },
    // `pnpm develop:remote` reads the public bucket through the dev server, so it
    // works from localhost before the bucket's CORS rule admits that origin.
    proxy: {
      "/remote-library": {
        target: PUBLIC_LIBRARY_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/remote-library/, ""),
      },
      // GALLERY_WORKER=http://127.0.0.1:8791 sends /api to a local `wrangler dev` of gallery/,
      // so the dev server reads and submits the local material gallery. Unset, /api is not served.
      ...(process.env.GALLERY_WORKER ? { "/api": { target: process.env.GALLERY_WORKER, changeOrigin: true } } : {}),
      // The Worker gates the owner HTML and serves its built assets and API. The Worker takes a POST only
      // from its own origin (gallery/src/admin.ts), so this server's own pages post with the Worker's
      // origin; a request from any other origin keeps its Origin and is refused.
      ...(process.env.GALLERY_WORKER ? {
        // In development the Worker document names the local build. Preview already serves dist.
        ...(!isPreview ? { "/assets/": { bypass: (request: { url?: string }) => `/dist${request.url}` } } : {}),
        "^/admin(?:[/?]|$)": {
          autoRewrite: true,
          target: process.env.GALLERY_WORKER,
          changeOrigin: true,
          configure: (proxy) => proxy.on("proxyReq", (request, incoming) => {
            if (incoming.headers.origin === `http://${incoming.headers.host}`) request.setHeader("origin", process.env.GALLERY_WORKER!);
          }),
        },
      } : {}),
    },
  },
  // ASSET_BASE_URL and ASSET_RELEASE name the public release.
  envPrefix: ["VITE_", "ASSET_"],
  worker: { format: "es" },
  test: {
    include: unitTestPatterns.app,
    environment: "node",
    passWithNoTests: true,
  },
}));
