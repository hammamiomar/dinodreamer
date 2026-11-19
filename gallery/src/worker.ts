// The one Cloudflare Worker of the public app. Static assets (app/dist) are served by the
// assets binding. API, owner and public page routes reach this code first (wrangler.jsonc).
//
//   POST /api/submissions   store a pending submission in the private bucket, return { id }:
//                           a canvas, or with kind=material a format-4 material file.
//                           Order: per-IP limit, closed without the Turnstile secret (503), the
//                           form's rules (400), Turnstile (403), store.
//                           The form is checked first, so a refused form does not spend the token.
//   GET  /api/gallery       the published index from the public bucket, cached for a minute
//   GET  /api/materials     the published materials index (material-review.ts), cached for a minute
//   GET  /api/materials/<id>/material.json | poster.png   a current file or an exact revision
//   GET  /api/basis-groups  the owner's names for the basis groups (basis-group-names.ts), cached for a minute
//   GET  /assets/*          a file missing from the current build (404)
//   /admin, /admin/*        the owner page and its API, behind Cloudflare Access (admin.ts)
//   GET  public pages      the app's index.html with the page's title, description, canonical address and shared
//                           preview media (link-preview.ts), and its reader text (reader-text.ts)
//   GET  other addresses   the same index.html with status 404; the app shows its unknown-page view

import { isOwnerPath, ownerRequest, type OwnerEnv } from "./admin.ts";
import { EMPTY_INDEX } from "./gallery-index.ts";
import { CACHE_IMMUTABLE, CACHE_INDEX, INDEX_KEY, INDEX_MAX_AGE_SECONDS, jsonResponse, submissionId, type Bucket } from "./storage.ts";
import { readCreationForm, readForm, readMaterialForm, storeSubmission, type ReleaseBlocks } from "./submission.ts";
import { readMaterials, storeMaterialSubmission } from "./material-review.ts";
import { storedNames } from "./basis-group-names.ts";
import { isMaterialEntryId, isMaterialFileRevision, materialKey, versionedMaterialKey, MATERIAL_FILES, type MaterialFileName } from "../../app/src/features/gallery/material-index.ts";
import { verifyTurnstile } from "./turnstile.ts";
import { routePreview, topPageOf, withPreviewTags } from "./link-preview.ts";
import { readerText, withReaderText } from "./reader-text.ts";
import { canonicalPathname } from "../../app/src/app/route-paths.ts";

export interface Env extends OwnerEnv {
  SUBMISSIONS: Bucket;
  LIBRARY: Bucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Workers rate limiting binding, keyed by client IP. */
  SUBMISSION_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Turnstile secret key (a Worker secret). Submissions are closed when it is unset. */
  TURNSTILE_SECRET?: string;
}

/** Read a release's block count from its manifest on the public bucket (releases/<name>.json). */
function publishedReleaseBlocks(library: Bucket): ReleaseBlocks {
  return async (release) => {
    const stored = await library.get(`releases/${release}.json`);
    if (stored === null) return null;
    const manifest = JSON.parse(await stored.text()) as { model?: { blocks?: unknown } };
    return typeof manifest.model?.blocks === "number" ? manifest.model.blocks : null;
  };
}

async function submit(request: Request, env: Env): Promise<Response> {
  const clientIp = request.headers.get("cf-connecting-ip");
  if (!(await env.SUBMISSION_LIMIT.limit({ key: clientIp ?? "unknown" })).success) {
    return jsonResponse({ error: "too many submissions; try again in a minute" }, 429);
  }
  // Without the secret there is no human check, so nothing is stored.
  if (!env.TURNSTILE_SECRET) return jsonResponse({ error: "submissions are closed: the human check is not configured" }, 503);
  const read = await readForm(request);
  if (!read.ok) return jsonResponse({ error: read.error }, read.status);
  const material = read.form.get("kind") === "material";
  const result = material ? await readMaterialForm(read.form) : await readCreationForm(read.form, publishedReleaseBlocks(env.LIBRARY));
  if (!result.ok) return jsonResponse({ error: result.error, ...("problems" in result && result.problems ? { problems: result.problems } : {}) }, result.status);
  const human = await verifyTurnstile(result.turnstileToken, env.TURNSTILE_SECRET, clientIp);
  if (!human.ok) return jsonResponse({ error: human.error }, human.status);
  const now = new Date();
  const id = submissionId(now, crypto.getRandomValues(new Uint8Array(4)));
  if ("file" in result.submission) await storeMaterialSubmission(env.SUBMISSIONS, id, result.submission, now);
  else await storeSubmission(env.SUBMISSIONS, id, result.submission, now);
  return jsonResponse({ id }, 201);
}

async function gallery(env: Env): Promise<Response> {
  const stored = await env.LIBRARY.get(INDEX_KEY);
  const body = stored === null ? JSON.stringify(EMPTY_INDEX) : await stored.text();
  return new Response(body, { headers: { "content-type": "application/json", "cache-control": CACHE_INDEX } });
}

/** Public app pages and their basis panels share one media pair. Other paths remain static assets. */
const PREVIEW_ROUTE = /^\/(?:(?:index|automata|train|picture|how|create)(?:\/basis\/(\d{1,5}))?|basis\/(\d{1,5})|canvas|gallery|saved)?\/?$/;

/**
 * The app's index.html with its route's title, description, canonical address, Open Graph and Twitter tags,
 * and its reader text. Link unfurlers, AI agents and some crawlers run no JavaScript, so all of it must be in
 * the HTML. The words are fixed (site-words.ts) and the media pair is fixed, so no gallery read or
 * storage-existence check is needed. Fetching "/" also prevents Static Assets redirecting /index to /.
 */
async function previewPage(request: Request, env: Env, block: number | null): Promise<Response> {
  const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  if (!shell.ok || !shell.headers.get("content-type")?.startsWith("text/html")) return shell;
  const url = new URL(request.url);
  const page = topPageOf(url.pathname.split("/")[1] ?? "");
  const preview = routePreview(page, block, `${url.origin}${url.pathname}${url.search}`, env.ASSET_BASE_URL);
  // The body changes, so the static file's validators no longer describe it.
  const headers = new Headers(shell.headers);
  headers.delete("content-length");
  headers.delete("etag");
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const tagged = withPreviewTags(await shell.text(), preview);
  const body = withReaderText(tagged, readerText(page, block), page === "home" && block === null);
  return new Response(body, { status: 200, headers });
}

interface WorkerContext {
  waitUntil(operation: Promise<unknown>): void;
}

/** The public index has one expiry across the edge and browser. Owner operations read the bucket directly. */
async function materials(url: URL, library: Bucket, context?: WorkerContext): Promise<Response> {
  const key = new URL("/api/materials", url).href;
  const cache = (globalThis.caches as (CacheStorage & { default?: Cache }) | undefined)?.default;
  const cached = await cache?.match(key);
  if (cached) return cached;

  const expires = new Date(Date.now() + INDEX_MAX_AGE_SECONDS * 1000).toUTCString();
  const response = new Response(JSON.stringify(await readMaterials(library)), {
    headers: { "content-type": "application/json", "cache-control": "public, must-revalidate", expires },
  });
  if (cache && context) context.waitUntil(cache.put(key, response.clone()));
  return response;
}

async function basisGroupNames(env: Env): Promise<Response> {
  return new Response(JSON.stringify(await storedNames(env.LIBRARY)), { headers: { "content-type": "application/json", "cache-control": CACHE_INDEX } });
}

/** Local gallery reads can select an exact revision. Older links resolve to the current files. */
async function materialFile(env: Env, id: string, file: string, revision: string | null): Promise<Response> {
  if (!isMaterialEntryId(id) || !MATERIAL_FILES.includes(file as MaterialFileName)) return jsonResponse({ error: "not found" }, 404);
  if (revision !== null && !isMaterialFileRevision(revision)) return jsonResponse({ error: "not found" }, 404);
  const key = revision === null ? materialKey(id, file as MaterialFileName) : versionedMaterialKey(id, revision, file as MaterialFileName);
  const stored = await env.LIBRARY.get(key);
  if (stored === null) return jsonResponse({ error: "not found" }, 404);
  const type = file === "poster.png" ? "image/png" : "application/json";
  return new Response(await stored.arrayBuffer(), { headers: { "content-type": type, "cache-control": revision === null ? CACHE_INDEX : CACHE_IMMUTABLE } });
}

const worker = {
  async fetch(request: Request, env: Env, context?: WorkerContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const canonical = canonicalPathname(pathname);
    if (canonical !== pathname) {
      url.pathname = canonical;
      return Response.redirect(url.href, request.method === "GET" || request.method === "HEAD" ? 301 : 308);
    }
    if (isOwnerPath(pathname)) return ownerRequest(request, env);
    if (pathname === "/api/submissions") {
      return request.method === "POST" ? submit(request, env) : jsonResponse({ error: "use POST" }, 405, { allow: "POST" });
    }
    if (pathname === "/api/gallery") {
      return request.method === "GET" ? gallery(env) : jsonResponse({ error: "use GET" }, 405, { allow: "GET" });
    }
    if (pathname === "/api/materials") {
      return request.method === "GET" ? materials(url, env.LIBRARY, context) : jsonResponse({ error: "use GET" }, 405, { allow: "GET" });
    }
    if (pathname === "/api/basis-groups") {
      return request.method === "GET" ? basisGroupNames(env) : jsonResponse({ error: "use GET" }, 405, { allow: "GET" });
    }
    const published = pathname.match(/^\/api\/materials\/([^/]+)\/([^/]+)$/);
    if (published !== null) {
      return request.method === "GET"
        ? materialFile(env, published[1]!, published[2]!, url.searchParams.get("revision"))
        : jsonResponse({ error: "use GET" }, 405, { allow: "GET" });
    }
    if (pathname.startsWith("/api/")) return jsonResponse({ error: "not found" }, 404);
    // Existing build files bypass this Worker. A stale tab can request a file from an earlier build.
    if (pathname.startsWith("/assets/")) {
      return new Response(request.method === "HEAD" ? null : "File missing from this build. Reload the page.\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
    const shared = pathname.match(PREVIEW_ROUTE);
    if (shared !== null) {
      const block = shared[1] ?? shared[2];
      return previewPage(request, env, block === undefined ? null : Number(block));
    }
    // The client router displays its unknown-page view. The status tells crawlers that the address names no page,
    // so they do not index it as a copy of the home (a "soft 404"). Keep the asset service's page validators.
    const unknown = await env.ASSETS.fetch(new Request(new URL("/", url), request));
    return new Response(unknown.body, { status: 404, headers: unknown.headers });
  },
};

export default worker;
