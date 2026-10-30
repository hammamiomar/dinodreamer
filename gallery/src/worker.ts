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
//   GET  /api/materials/<id>/material.json | poster.png   a published material's file, immutable
//   GET  /assets/*          the build's file, or 404 when the current build does not have it
//   /admin, /admin/*        the owner page and its API, behind Cloudflare Access (admin.ts)
//   GET  public pages      the app's index.html with shared preview media (link-preview.ts)

import ownerPage from "./admin-page.html";
import { isOwnerPath, ownerRequest, type OwnerEnv } from "./admin.ts";
import { EMPTY_INDEX } from "./gallery-index.ts";
import { CACHE_IMMUTABLE, CACHE_INDEX, INDEX_KEY, submissionId, type Bucket } from "./storage.ts";
import { readCreationForm, readForm, readMaterialForm, storeSubmission, type ReleaseBlocks } from "./submission.ts";
import { readMaterials, storeMaterialSubmission } from "./material-review.ts";
import { isMaterialEntryId, materialKey, MATERIAL_FILES, type MaterialFileName } from "../../app/src/features/gallery/material-index.ts";
import { verifyTurnstile } from "./turnstile.ts";
import { routePreview, withPreviewTags } from "./link-preview.ts";
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

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/** A release's block count from its manifest on the public bucket (releases/<name>.json, about 4 KB). */
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
    return json({ error: "too many submissions; try again in a minute" }, 429);
  }
  // Without the secret there is no human check, so nothing is stored.
  if (!env.TURNSTILE_SECRET) return json({ error: "submissions are closed: the human check is not configured" }, 503);
  const read = await readForm(request);
  if (!read.ok) return json({ error: read.error }, read.status);
  const material = read.form.get("kind") === "material";
  const result = material ? await readMaterialForm(read.form) : await readCreationForm(read.form, publishedReleaseBlocks(env.LIBRARY));
  if (!result.ok) return json({ error: result.error, ...("problems" in result && result.problems ? { problems: result.problems } : {}) }, result.status);
  const human = await verifyTurnstile(result.turnstileToken, env.TURNSTILE_SECRET, clientIp);
  if (!human.ok) return json({ error: human.error }, human.status);
  const now = new Date();
  const id = submissionId(now, crypto.getRandomValues(new Uint8Array(4)));
  if ("file" in result.submission) await storeMaterialSubmission(env.SUBMISSIONS, id, result.submission, now);
  else await storeSubmission(env.SUBMISSIONS, id, result.submission, now);
  return json({ id }, 201);
}

/**
 * A file of the app build. A deploy replaces every hashed file under /assets/, and the
 * static assets answer a path they lack with index.html (single-page fallback). A tab
 * opened before the deploy would then run HTML as its lazy chunk or engine worker and
 * fail with a MIME error. A build puts no HTML under /assets/, so an
 * HTML answer here means the file is gone: answer 404, uncached, so the app can tell.
 */
async function buildFile(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (!response.headers.get("content-type")?.startsWith("text/html")) return response;
  return new Response("not in this build of the app; reload the page\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

async function gallery(env: Env): Promise<Response> {
  const stored = await env.LIBRARY.get(INDEX_KEY);
  const body = stored === null ? JSON.stringify(EMPTY_INDEX) : await stored.text();
  return new Response(body, { headers: { "content-type": "application/json", "cache-control": CACHE_INDEX } });
}

/** Public app pages and their basis panels share one media pair. Other paths remain static assets. */
const PREVIEW_ROUTE = /^\/(?:(?:index|automata|train|picture|how|create)(?:\/basis\/(\d{1,5}))?|basis\/(\d{1,5})|canvas|gallery|saved)?\/?$/;

/**
 * The app's index.html with the Open Graph and Twitter tags of its route. Link unfurlers run no
 * JavaScript, so the tags must be in the HTML. The fixed media pair needs no gallery reads or
 * storage-existence checks. Fetching "/" also prevents Static Assets redirecting /index to /.
 */
async function previewPage(request: Request, env: Env, block: number | null): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  if (!page.ok || !page.headers.get("content-type")?.startsWith("text/html")) return page;
  const url = new URL(request.url);
  const preview = routePreview(block, `${url.origin}${url.pathname}${url.search}`, env.ASSET_BASE_URL);
  // The body changes, so the static file's validators no longer describe it.
  const headers = new Headers(page.headers);
  headers.delete("content-length");
  headers.delete("etag");
  const body = request.method === "HEAD" ? null : withPreviewTags(await page.text(), preview);
  return new Response(body, { status: 200, headers });
}

async function materials(env: Env): Promise<Response> {
  return new Response(JSON.stringify(await readMaterials(env.LIBRARY)), { headers: { "content-type": "application/json", "cache-control": CACHE_INDEX } });
}

/** A published material's file or poster from the public bucket; immutable once approved. */
async function materialFile(env: Env, id: string, file: string): Promise<Response> {
  if (!isMaterialEntryId(id) || !MATERIAL_FILES.includes(file as MaterialFileName)) return json({ error: "not found" }, 404);
  const stored = await env.LIBRARY.get(materialKey(id, file as MaterialFileName));
  if (stored === null) return json({ error: "not found" }, 404);
  const type = file === "poster.png" ? "image/png" : "application/json";
  return new Response(await stored.arrayBuffer(), { headers: { "content-type": type, "cache-control": CACHE_IMMUTABLE } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const canonical = canonicalPathname(pathname);
    if (canonical !== pathname) {
      url.pathname = canonical;
      return Response.redirect(url.href, request.method === "GET" || request.method === "HEAD" ? 301 : 308);
    }
    if (isOwnerPath(pathname)) return ownerRequest(request, env, ownerPage);
    if (pathname === "/api/submissions") {
      return request.method === "POST" ? submit(request, env) : json({ error: "use POST" }, 405, { allow: "POST" });
    }
    if (pathname === "/api/gallery") {
      return request.method === "GET" ? gallery(env) : json({ error: "use GET" }, 405, { allow: "GET" });
    }
    if (pathname === "/api/materials") {
      return request.method === "GET" ? materials(env) : json({ error: "use GET" }, 405, { allow: "GET" });
    }
    const published = pathname.match(/^\/api\/materials\/([^/]+)\/([^/]+)$/);
    if (published !== null && request.method === "GET") return materialFile(env, published[1]!, published[2]!);
    if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    if (pathname.startsWith("/assets/")) return buildFile(request, env);
    const shared = request.method === "GET" || request.method === "HEAD" ? pathname.match(PREVIEW_ROUTE) : null;
    if (shared !== null) {
      const block = shared[1] ?? shared[2];
      return previewPage(request, env, block === undefined ? null : Number(block));
    }
    return env.ASSETS.fetch(request);
  },
};
