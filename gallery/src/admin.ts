// The owner page and its API: the gallery's review, in a browser, for the owner only. Every
// request passes checkOwner first (access.ts). The actions run the operations of review.ts,
// the same functions as the terminal commands; nothing here has rules of its own.
//
//   GET  /admin                                   the page (admin-page.html)
//   GET  /admin/materials                         the owner's materials view: the app's page, whose router
//   GET  /admin/materials/basis/<n>               the same page with basis group n's panel over it
//                                                 draws it (app/src/features/owner) over the routes below
//   GET  /admin/api/entries                       pending submissions (pendingRow), shown and hidden entries
//   GET  /admin/api/pending/<id>/image.png        a pending picture, from the private bucket
//   GET  /admin/api/gallery/<id>/thumbnail.webp   a shown or hidden entry's thumbnail, from the public bucket
//   POST /admin/api/approve   { ids }             approve these pending submissions, in this order
//   POST /admin/api/reject    { id }              delete a pending submission
//   POST /admin/api/hide      { id }              take a shown entry out of the gallery, keep it
//   POST /admin/api/restore   { id }              put a hidden entry back
//   POST /admin/api/purge     { id }              delete a shown or hidden entry for good; the answer names the CDN purge
//   GET  /admin/api/materials                     pending, shown and hidden materials (material-review.ts)
//   GET  /admin/api/materials/pending/<id>/poster.png   a pending material's poster, from the private bucket
//   GET  /admin/api/materials/pending/<id>/material.json   its stored file, so the owner can play it before Approve
//   GET  /admin/api/materials/gallery/<id>/poster.png   a shown or hidden material's poster, from the public bucket
//   POST /admin/api/materials/approve|reject|hide|restore|purge  { id }   the same operations for one material
//   POST /admin/api/materials/feature|unfeature  { id }   mark a shown material featured, or clear the mark;
//                                                 both answer { entry }, the entry as the index now lists it
//
// A POST must send JSON from this host's own page (its Origin header), so another site cannot
// post with the owner's Access cookie. The page sends one action at a time, the same rule as the
// README's "run one owner command at a time": each action rewrites the published index.

import { checkOwner, type OwnerAccessEnv } from "./access.ts";
import { PURGE_BY_PREFIX_PLACE, purgePrefix } from "./cdn-check.ts";
import { approveAll, galleryEntries, hide, pendingBlocks, purge, reject, restore } from "./review.ts";
import { approveMaterial, hideMaterial, materialEntries, pendingMaterialKey, purgeMaterial, restoreMaterial, setMaterialFeatured } from "./material-review.ts";
import { isMaterialEntryId, materialKey } from "../../app/src/features/gallery/material-index.ts";
import { isSubmissionId, pendingKey, publishedKey, type Bucket, type SubmissionMetadata } from "./storage.ts";
import { imagesThumbnail, type ImagesBinding } from "./thumbnail.ts";

export interface OwnerEnv extends OwnerAccessEnv {
  SUBMISSIONS: Bucket;
  LIBRARY: Bucket;
  IMAGES: ImagesBinding;
  /** The library CDN, the same value as app/.env's ASSET_BASE_URL (a test checks); the purge step names it. */
  ASSET_BASE_URL: string;
  /** The app build; /admin/materials answers with its index.html. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** The most submissions one approve request publishes: a page shows every pending one, and this is far above the volume. */
const MAX_APPROVE = 200;

export function isOwnerPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export async function ownerRequest(request: Request, env: OwnerEnv, page: string, fetcher: typeof fetch = fetch): Promise<Response> {
  const now = new Date();
  const { pathname } = new URL(request.url);
  const owner = await checkOwner(request, env, now, fetcher);
  if (!owner.ok) {
    return pathname.startsWith("/admin/api/") ? json({ error: `owner access refused: ${owner.reason}` }, 403) : textPage(`Owner access refused: ${owner.reason}.\n`, 403);
  }
  if (pathname === "/admin" || pathname === "/admin/") {
    return request.method === "GET" ? ownerPage(page) : json({ error: "use GET" }, 405, { allow: "GET" });
  }
  if (OWNER_APP_PAGE.test(pathname)) {
    return request.method === "GET" ? ownerPage(await appPage(request, env)) : json({ error: "use GET" }, 405, { allow: "GET" });
  }
  if (request.method === "GET") return ownerGet(pathname, env, owner.owner);
  if (request.method === "POST") return ownerPost(request, pathname, env, now);
  return json({ error: "use GET or POST" }, 405, { allow: "GET, POST" });
}

/** The owner views the app draws: the materials view, alone or with a basis group's panel over it. */
const OWNER_APP_PAGE = /^\/admin\/materials(?:\/basis\/\d{1,5})?$/;

/**
 * The app's index.html, for an owner view that the app draws: one player implementation, the
 * app's, and never a copy in this Worker's HTML. Same origin, so its calls to /admin/api pass the
 * Origin rule below.
 */
async function appPage(request: Request, env: OwnerEnv): Promise<string> {
  const index = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  if (!index.ok) throw new Error(`the app build answered ${index.status} for its page`);
  return index.text();
}

function ownerPage(page: string): Response {
  return new Response(page, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // The page acts on the gallery: no other site may frame it.
      "content-security-policy": "frame-ancestors 'none'",
      "x-robots-tag": "noindex",
    },
  });
}

async function ownerGet(pathname: string, env: OwnerEnv, owner: string): Promise<Response> {
  if (pathname === "/admin/api/materials") return json(await materialEntries(env.SUBMISSIONS, env.LIBRARY));
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
    return json({ owner, pending: rows, published, hidden });
  }
  const pendingPicture = pathname.match(/^\/admin\/api\/pending\/([^/]+)\/image\.png$/);
  if (pendingPicture !== null && isSubmissionId(pendingPicture[1]!)) {
    return privateObject(env.SUBMISSIONS, pendingKey(pendingPicture[1]!, "image.png"), "image/png");
  }
  const thumbnail = pathname.match(/^\/admin\/api\/gallery\/([^/]+)\/thumbnail\.webp$/);
  if (thumbnail !== null && isSubmissionId(thumbnail[1]!)) {
    return privateObject(env.LIBRARY, publishedKey(thumbnail[1]!, "thumbnail.webp"), "image/webp");
  }
  return json({ error: "not found" }, 404);
}

/**
 * A pending submission as the page lists it. One that is already shown or hidden is an approval
 * whose pending cleanup stopped (README: a failed approve leaves the entry in the list); approve
 * finishes it, so the page offers only that. Its recipe may be gone; then it has no blocks.
 */
async function pendingRow(submissions: Bucket, metadata: SubmissionMetadata, inGallery: Set<string>) {
  const state = inGallery.has(metadata.id) ? "cleanup unfinished" : "pending";
  const blocks = state === "pending" ? await pendingBlocks(submissions, metadata.id) : null;
  return { ...metadata, state, blocks };
}

/** A stored object of the owner's buckets: a pending picture or file, or a thumbnail; never cached. */
async function privateObject(bucket: Bucket, key: string, contentType: string): Promise<Response> {
  const stored = await bucket.get(key);
  if (stored === null) return json({ error: `${key} does not exist` }, 404);
  return new Response(await stored.arrayBuffer(), { headers: { "content-type": contentType, "cache-control": "private, no-store" } });
}

async function ownerPost(request: Request, pathname: string, env: OwnerEnv, now: Date): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "send actions from the owner page" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "send JSON" }, 415);
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return json({ error: "the body is not JSON" }, 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return json({ error: "the body must be a JSON object" }, 400);
  const body = parsed as { id?: unknown; ids?: unknown };
  const materialAction = pathname.match(/^\/admin\/api\/materials\/(approve|reject|hide|restore|purge|feature|unfeature)$/)?.[1];
  if (materialAction !== undefined) return materialPost(materialAction, body.id, env, now);
  const action = pathname.match(/^\/admin\/api\/(approve|reject|hide|restore|purge)$/)?.[1];
  if (action === undefined) return json({ error: "not found" }, 404);
  if (action === "approve") {
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_APPROVE || !ids.every((id) => typeof id === "string" && isSubmissionId(id))) {
      return json({ error: `ids must list 1 to ${MAX_APPROVE} submission ids` }, 400);
    }
    return run(async () => ({ entries: await approveAll(env.SUBMISSIONS, env.LIBRARY, ids, now, imagesThumbnail(env.IMAGES)) }));
  }
  const id = body.id;
  if (typeof id !== "string" || !isSubmissionId(id)) return json({ error: "id must be a submission id, such as 20261011-153012-a1b2c3d4" }, 400);
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

/** One material operation of material-review.ts. Pending materials have submission ids; shown ones may be project slugs. */
function materialPost(action: string, id: unknown, env: OwnerEnv, now: Date): Promise<Response> {
  const pending = action === "approve" || action === "reject";
  if (typeof id !== "string" || !(pending ? isSubmissionId(id) : isMaterialEntryId(id))) return Promise.resolve(json({ error: "id must name an automaton" }, 400));
  if (action === "approve") return run(async () => ({ entry: await approveMaterial(env.SUBMISSIONS, env.LIBRARY, id, now) }));
  if (action === "reject") return run(async () => { await reject(env.SUBMISSIONS, id); return { rejected: id }; });
  if (action === "hide") return run(async () => ({ hidden: await hideMaterial(env.SUBMISSIONS, env.LIBRARY, id, now) }));
  if (action === "restore") return run(async () => ({ restored: await restoreMaterial(env.SUBMISSIONS, env.LIBRARY, id) }));
  if (action === "feature" || action === "unfeature") {
    return run(async () => ({ entry: await setMaterialFeatured(env.SUBMISSIONS, env.LIBRARY, id, action === "feature") }));
  }
  return run(async () => { await purgeMaterial(env.SUBMISSIONS, env.LIBRARY, id); return { purged: id }; });
}

/**
 * One operation of review.ts. Its own error, such as "no pending submission <id>", answers 409
 * with that message; an operation that stopped partway is finished by running it again.
 */
async function run(operation: () => Promise<unknown>): Promise<Response> {
  try {
    return json(await operation());
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 409);
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

function textPage(text: string, status: number): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
