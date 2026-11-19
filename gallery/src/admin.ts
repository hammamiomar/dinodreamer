// Owner routes and review API behind Cloudflare Access (access.ts).
// Every request passes checkOwner first. Actions delegate directly to review.ts,
// material-review.ts, research.ts, and basis-group-names.ts without duplicating rules.
//
//   GET  /admin, /admin/, /admin/materials..., /admin/research...  redirect to /admin/automata
//   GET  /admin/automata, /admin/automata/basis/<n>                the owner Automata page (app/src/features/owner)
//   GET  /admin/api/entries                                        pending, shown, and hidden canvas entries
//   GET  /admin/api/pending/<id>/image.png                         pending canvas image from the private bucket
//   GET  /admin/api/gallery/<id>/thumbnail.webp                    shown or hidden canvas thumbnail from the public bucket
//   POST /admin/api/approve   { ids }                              publish pending canvas submissions in order
//   POST /admin/api/reject    { id }                               delete a pending canvas submission
//   POST /admin/api/hide      { id }                               remove a shown canvas entry from the index
//   POST /admin/api/restore   { id }                               return a hidden canvas entry to the index
//   POST /admin/api/purge     { id }                               permanently delete a shown or hidden canvas entry
//   GET  /admin/api/materials                                      pending, shown, and hidden automata
//   GET  /admin/api/materials/pending/<id>/poster.png              pending automaton poster from the private bucket
//   GET  /admin/api/materials/pending/<id>/material.json           pending automaton file for preview before approval
//   GET  /admin/api/materials/gallery/<id>/poster.png              shown or hidden automaton poster from the public bucket
//   POST /admin/api/materials/approve|reject|hide|restore|purge  { id }
//   POST /admin/api/materials/feature|unfeature  { id }            toggle the site featured mark; returns { entry }
//   POST /admin/api/materials/cell-picture|group-picture  { id }   choose a cell or group representative; returns { entries }
//   GET  /admin/api/research/manifest.json                         research run index from the private bucket
//   GET  /admin/api/research/runs/<id>/material.json | still-<tick>.png
//   POST /admin/api/research/show  { ids }                         publish research runs to Automata; returns { result, entries }
//   POST /admin/api/basis-groups/name  { block, name }             set or clear a basis group name; returns { names }
//
// POST requests require JSON and a matching Origin header so other sites cannot trigger actions
// with the owner's Access cookie. Run one owner action at a time because each action rewrites
// the published index.

import { checkOwner, type OwnerAccessEnv } from "./access.ts";
import { materialCdnPurge, PURGE_BY_PREFIX_PLACE, purgePrefix } from "./cdn-check.ts";
import { approveAll, galleryEntries, hide, pendingBlocks, purge, reject, restore } from "./review.ts";
import {
  approveMaterial, hideMaterial, materialEntries, pendingMaterialKey, purgeMaterial, restoreMaterial, setCellPicture, setGroupPicture, setMaterialFeatured,
} from "./material-review.ts";
import { isMaterialEntryId, materialKey } from "../../app/src/features/gallery/material-index.ts";
import { isResearchRunId, RESEARCH_MANIFEST_KEY, researchRunKey } from "../../app/src/features/research/research-runs.ts";
import { showStoredRuns } from "./research.ts";
import { setName } from "./basis-group-names.ts";
import { ConflictError, isSubmissionId, jsonResponse, pendingKey, publishedKey, type Bucket, type SubmissionMetadata } from "./storage.ts";
import { imagesThumbnail, type ImagesBinding } from "./thumbnail.ts";

export interface OwnerEnv extends OwnerAccessEnv {
  SUBMISSIONS: Bucket;
  LIBRARY: Bucket;
  IMAGES: ImagesBinding;
  /** Library CDN base URL (matches app/.env ASSET_BASE_URL); used to format CDN purge prefixes. */
  ASSET_BASE_URL: string;
  /** Static app bundle; /admin/automata serves its index.html. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** Maximum canvas submissions accepted by one approve request. */
const MAX_APPROVE = 200;
/** Maximum research runs accepted by one show request. */
const MAX_SHOW = 100;

export function isOwnerPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export async function ownerRequest(request: Request, env: OwnerEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const now = new Date();
  const { pathname } = new URL(request.url);
  const owner = await checkOwner(request, env, now, fetcher);
  if (!owner.ok) {
    return pathname.startsWith("/admin/api/") ? jsonResponse({ error: `owner access refused: ${owner.reason}` }, 403) : textPage(`Owner access refused: ${owner.reason}.\n`, 403);
  }
  if (pathname === "/admin" || pathname === "/admin/" || EARLIER_OWNER_PAGE.test(pathname)) {
    return request.method === "GET" ? Response.redirect(new URL("/admin/automata", request.url).toString(), 302) : jsonResponse({ error: "use GET" }, 405, { allow: "GET" });
  }
  if (OWNER_APP_PAGE.test(pathname)) {
    return request.method === "GET" ? appPage(request, env) : jsonResponse({ error: "use GET" }, 405, { allow: "GET" });
  }
  if (request.method === "GET") return ownerGet(pathname, env, owner.owner);
  if (request.method === "POST") return ownerPost(request, pathname, env, now);
  return jsonResponse({ error: "use GET or POST" }, 405, { allow: "GET, POST" });
}

/** Owner views rendered by the app router: the Automata view and its basis group panel. */
const OWNER_APP_PAGE = /^\/admin\/automata(?:\/basis\/\d{1,5})?$/;

/** Legacy owner paths that now redirect to /admin/automata. */
const EARLIER_OWNER_PAGE = /^\/admin\/(?:materials|research)(?:\/.*)?$/;

/**
 * Serve the app's index.html for /admin/automata so the owner view shares the same player
 * implementation and same-origin API calls as the rest of the app.
 */
async function appPage(request: Request, env: OwnerEnv): Promise<Response> {
  const index = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  if (!index.ok) return textPage(`The app build answered ${index.status} for its page.\n`, 502);
  return ownerPage(await index.text());
}

function ownerPage(page: string): Response {
  return new Response(page, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Prevent clickjacking, <base> hijacking, and embedded plugins on privileged owner pages.
      "content-security-policy": "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
      "x-robots-tag": "noindex",
    },
  });
}

async function ownerGet(pathname: string, env: OwnerEnv, owner: string): Promise<Response> {
  if (pathname === "/admin/api/materials") return jsonResponse(await materialEntries(env.SUBMISSIONS, env.LIBRARY));
  if (pathname === "/admin/api/research/manifest.json") return privateObject(env.SUBMISSIONS, RESEARCH_MANIFEST_KEY, "application/json");
  const researchFile = pathname.match(/^\/admin\/api\/research\/runs\/([^/]+)\/(material\.json|still-\d{4,5}\.png)$/);
  if (researchFile !== null && isResearchRunId(researchFile[1]!)) {
    return privateObject(env.SUBMISSIONS, researchRunKey(researchFile[1]!, researchFile[2]!), researchFile[2]!.endsWith(".png") ? "image/png" : "application/json");
  }
  const pendingPoster = pathname.match(/^\/admin\/api\/materials\/pending\/([^/]+)\/poster\.png$/);
  if (pendingPoster !== null && isSubmissionId(pendingPoster[1]!)) return privateObject(env.SUBMISSIONS, pendingMaterialKey(pendingPoster[1]!, "poster.png"), "image/png");
  const pendingFile = pathname.match(/^\/admin\/api\/materials\/pending\/([^/]+)\/material\.json$/);
  if (pendingFile !== null && isSubmissionId(pendingFile[1]!)) {
    return privateObject(env.SUBMISSIONS, pendingMaterialKey(pendingFile[1]!, "material.json"), "application/json");
  }
  const shownPoster = pathname.match(/^\/admin\/api\/materials\/gallery\/([^/]+)\/poster\.png$/);
  if (shownPoster !== null && isMaterialEntryId(shownPoster[1]!)) return privateObject(env.LIBRARY, materialKey(shownPoster[1]!, "poster.png"), "image/png");
  if (pathname === "/admin/api/entries") {
    const { pending, published, hidden } = await galleryEntries(env.SUBMISSIONS, env.LIBRARY);
    const inGallery = new Set([...published, ...hidden].map((entry) => entry.id));
    const rows = await Promise.all(pending.map((metadata) => pendingRow(env.SUBMISSIONS, metadata, inGallery)));
    return jsonResponse({ owner, pending: rows, published, hidden });
  }
  const pendingPicture = pathname.match(/^\/admin\/api\/pending\/([^/]+)\/image\.png$/);
  if (pendingPicture !== null && isSubmissionId(pendingPicture[1]!)) {
    return privateObject(env.SUBMISSIONS, pendingKey(pendingPicture[1]!, "image.png"), "image/png");
  }
  const thumbnail = pathname.match(/^\/admin\/api\/gallery\/([^/]+)\/thumbnail\.webp$/);
  if (thumbnail !== null && isSubmissionId(thumbnail[1]!)) {
    return privateObject(env.LIBRARY, publishedKey(thumbnail[1]!, "thumbnail.webp"), "image/webp");
  }
  return jsonResponse({ error: "not found" }, 404);
}

/**
 * Format a pending submission row. When the entry is already published or hidden, a previous
 * approval stopped during pending cleanup; approving again deletes the remaining pending files.
 */
async function pendingRow(submissions: Bucket, metadata: SubmissionMetadata, inGallery: Set<string>) {
  const state = inGallery.has(metadata.id) ? "cleanup unfinished" : "pending";
  const blocks = state === "pending" ? await pendingBlocks(submissions, metadata.id) : null;
  return { ...metadata, state, blocks };
}

/** Read a private owner object without caching. */
async function privateObject(bucket: Bucket, key: string, contentType: string): Promise<Response> {
  const stored = await bucket.get(key);
  if (stored === null) return jsonResponse({ error: `${key} does not exist` }, 404);
  return new Response(await stored.arrayBuffer(), { headers: { "content-type": contentType, "cache-control": "private, no-store" } });
}

async function ownerPost(request: Request, pathname: string, env: OwnerEnv, now: Date): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin) return jsonResponse({ error: "send actions from the owner page" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return jsonResponse({ error: "send JSON" }, 415);
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: "the body is not JSON" }, 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return jsonResponse({ error: "the body must be a JSON object" }, 400);
  const body = parsed as { id?: unknown; ids?: unknown; block?: unknown; name?: unknown };
  if (pathname === "/admin/api/basis-groups/name") {
    const { block, name } = body;
    if (!Number.isInteger(block) || typeof name !== "string") return jsonResponse({ error: "send a basis group's number and a name" }, 400);
    return run(async () => ({ names: await setName(env.LIBRARY, block as number, name) }));
  }
  if (pathname === "/admin/api/research/show") {
    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SHOW || !ids.every((id) => typeof id === "string" && isResearchRunId(id))) {
      return jsonResponse({ error: `ids must list 1 to ${MAX_SHOW} research run ids` }, 400);
    }
    return run(() => showStoredRuns(env.SUBMISSIONS, env.LIBRARY, ids as string[], now));
  }
  const materialAction = pathname.match(/^\/admin\/api\/materials\/(approve|reject|hide|restore|purge|feature|unfeature|cell-picture|group-picture)$/)?.[1];
  if (materialAction !== undefined) return materialPost(materialAction, body.id, env, now);
  const action = pathname.match(/^\/admin\/api\/(approve|reject|hide|restore|purge)$/)?.[1];
  if (action === undefined) return jsonResponse({ error: "not found" }, 404);
  if (action === "approve") {
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_APPROVE || !ids.every((id) => typeof id === "string" && isSubmissionId(id))) {
      return jsonResponse({ error: `ids must list 1 to ${MAX_APPROVE} submission ids` }, 400);
    }
    return run(async () => ({ entries: await approveAll(env.SUBMISSIONS, env.LIBRARY, ids, now, imagesThumbnail(env.IMAGES)) }));
  }
  const id = body.id;
  if (typeof id !== "string" || !isSubmissionId(id)) return jsonResponse({ error: "id must be a submission id, such as 20261011-153012-a1b2c3d4" }, 400);
  if (action === "reject") {
    return run(async () => {
      await reject(env.SUBMISSIONS, id);
      return { rejected: id };
    });
  }
  if (action === "hide") return run(async () => ({ hidden: await hide(env.SUBMISSIONS, env.LIBRARY, id, now) }));
  if (action === "restore") return run(async () => ({ restored: await restore(env.SUBMISSIONS, env.LIBRARY, id) }));
  return run(async () => {
    await purge(env.SUBMISSIONS, env.LIBRARY, id);
    // The CDN keeps cached copies for up to a year; the owner purges them by hand (cdn-check.ts).
    return { purged: id, cdnPurge: { place: PURGE_BY_PREFIX_PLACE, prefix: purgePrefix(env.ASSET_BASE_URL, id) } };
  });
}

/** Run one material review operation. Pending items use submission ids; published items may use slugs. */
function materialPost(action: string, id: unknown, env: OwnerEnv, now: Date): Promise<Response> {
  const pending = action === "approve" || action === "reject";
  if (typeof id !== "string" || !(pending ? isSubmissionId(id) : isMaterialEntryId(id))) return Promise.resolve(jsonResponse({ error: "id must name an automaton" }, 400));
  if (action === "approve") return run(async () => ({ entry: await approveMaterial(env.SUBMISSIONS, env.LIBRARY, id, now) }));
  if (action === "reject") return run(async () => { await reject(env.SUBMISSIONS, id); return { rejected: id }; });
  if (action === "hide") return run(async () => ({ hidden: await hideMaterial(env.SUBMISSIONS, env.LIBRARY, id, now) }));
  if (action === "restore") return run(async () => ({ restored: await restoreMaterial(env.SUBMISSIONS, env.LIBRARY, id) }));
  if (action === "feature" || action === "unfeature") {
    return run(async () => ({ entry: await setMaterialFeatured(env.SUBMISSIONS, env.LIBRARY, id, action === "feature") }));
  }
  if (action === "cell-picture") return run(async () => ({ entries: await setCellPicture(env.SUBMISSIONS, env.LIBRARY, id) }));
  if (action === "group-picture") return run(async () => ({ entries: await setGroupPicture(env.SUBMISSIONS, env.LIBRARY, id) }));
  return run(async () => {
    await purgeMaterial(env.SUBMISSIONS, env.LIBRARY, id);
    return { purged: id, cdnPurge: env.ADMIN_LOCAL_OWNER === "yes" ? null : materialCdnPurge(env.ASSET_BASE_URL, id) };
  });
}

/**
 * Run one review operation. Expected domain state conflicts return 409 with their message;
 * unexpected storage or runtime errors return 500.
 */
async function run(operation: () => Promise<unknown>): Promise<Response> {
  try {
    return jsonResponse(await operation());
  } catch (error) {
    if (error instanceof ConflictError) return jsonResponse({ error: error.message }, 409);
    return jsonResponse({ error: "internal server error" }, 500);
  }
}

function textPage(text: string, status: number): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
