import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CELLS } from "../../app/src/recipe.ts";
import { CREATION_FILE_FORMAT, decodeCreationFile } from "../../app/src/storage/recipe-file.ts";
import { CREATION_FILE_FORMAT as RECOVERED_FORMAT } from "../src/creation-file.ts";
import { withEntry } from "../src/gallery-index.ts";
import { RestBucket } from "../src/rest-bucket.ts";
import { approve, approveAll, findEntry, galleryEntries, hide, pendingSubmissions, purge, recoverCreation, reject, restore } from "../src/review.ts";
import { APP_ORIGIN, checkCopies, curlCommand, purgePrefix } from "../src/cdn-check.ts";
import { CACHE_IMMUTABLE, CACHE_INDEX, INDEX_KEY, PUBLIC_BUCKET, SUBMISSIONS_BUCKET, hiddenKey, submissionId, type Bucket } from "../src/storage.ts";
import { SUBMISSION_LIMITS, checkedRecipe } from "../src/submission.ts";
import { THUMBNAIL_PIXELS } from "../src/thumbnail.ts";
import { sharpThumbnail } from "../src/thumbnail-sharp.ts";
import { SITEVERIFY_URL } from "../src/turnstile.ts";
import worker from "../src/worker.ts";
import { PNG, PNG_COLOUR, flatPng, recipe, submit, type submissionRequest, testEnv } from "./fixtures.ts";


describe("POST /api/submissions", () => {
  it("stores a valid submission as three pending objects and returns its id", async () => {
    const { env, submissions } = testEnv();
    const { status, body } = await submit(env);
    expect(status).toBe(201);
    expect(body.id).toMatch(/^\d{8}-\d{6}-[0-9a-f]{8}$/);
    expect(submissions.keys()).toEqual(["image.png", "meta.json", "recipe.json"].map((file) => `pending/${body.id}/${file}`));
    const metadata = JSON.parse(new TextDecoder().decode(submissions.objects.get(`pending/${body.id}/meta.json`)!.body));
    expect(metadata).toMatchObject({ id: body.id, title: "Collar", credit: "Contributor", release: "pass-003" });
    expect(metadata).not.toHaveProperty("engine");
  });

  it("records the engine build that made the image when the form names it", async () => {
    const { env, submissions } = testEnv();
    const { body } = await submit(env, { engine: " app/24a0790f50c6e613/dinodreamer_engine_bg.wasm " });
    const metadata = JSON.parse(new TextDecoder().decode(submissions.objects.get(`pending/${body.id}/meta.json`)!.body));
    expect(metadata.engine).toBe("app/24a0790f50c6e613/dinodreamer_engine_bg.wasm");
    const blank = await submit(env, { engine: "  " });
    expect(JSON.parse(new TextDecoder().decode(submissions.objects.get(`pending/${blank.body.id}/meta.json`)!.body))).not.toHaveProperty("engine");
  });

  it("refuses what the contract excludes, with a message for the visitor", async () => {
    const { env, submissions } = testEnv();
    const cases: [Parameters<typeof submissionRequest>[0], number, RegExp][] = [
      [{ image: new Uint8Array([1, 2, 3]) }, 400, /PNG/],
      [{ image: new Uint8Array(SUBMISSION_LIMITS.imageBytes + 1).fill(0x89) }, 413, /2 MB/],
      [{ recipe: "{not json" }, 400, /not JSON/],
      [{ recipe: JSON.stringify({ ...recipe(), seed: -1 }) }, 400, /not valid: seed/],
      [{ recipe: "[]" }, 400, /format 7/],
      [{ recipe: JSON.stringify({ format: 6 }) }, 400, /wrong structure/],
      [{ title: "" }, 400, /title/],
      [{ title: "x".repeat(81) }, 400, /80/],
      [{ credit: "y".repeat(41) }, 400, /40/],
      [{ title: "line\nbreak" }, 400, /control/],
      [{ engine: "e".repeat(129) }, 400, /engine has more than 128/],
      [{ engine: "fake\u0000" }, 400, /engine contains control/],
    ];
    for (const [fields, status, message] of cases) {
      const result = await submit(env, fields);
      expect(result.status, JSON.stringify(result.body)).toBe(status);
      expect(result.body.error).toMatch(message);
    }
    expect(submissions.keys()).toEqual([]);
  });

  it("checks structure before semantics: missing rules and string cells are refused", async () => {
    const { env, submissions } = testEnv();
    // validateRecipe alone does not reject this non-objective input.
    const { rules: _rules, ...withoutRules } = recipe();
    const malformed = { ...withoutRules, protect: Array.from({ length: CELLS }, () => "false") };
    const refused = await submit(env, { recipe: JSON.stringify(malformed) });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/wrong structure/);
    expect(submissions.keys()).toEqual([]);
    const releases = async (release: string) => (release === "pass-003" ? 16384 : null);
    expect("error" in (await checkedRecipe({ ...recipe(), protect: Array.from({ length: CELLS }, () => "false") }, releases))).toBe(true);
    const { body } = await submit(env, { recipe: JSON.stringify({ ...recipe(), protect: [] }) });
    expect(body.error).toMatch(/protect/);
  });

  it("accepts formats 5 to 7 only: an upgraded older recipe would not reproduce the submitted image", async () => {
    const { env, submissions } = testEnv();
    const { respondLike, lookLike, ...request } = recipe().requests[0]!;
    const formatOne = {
      ...recipe(),
      format: 1,
      requests: [{ ...request, where: respondLike.where.map(Number), respondLike: { ...respondLike, where: undefined }, lookLike: { ...lookLike, where: undefined } }],
    };
    const formatTwo = { ...recipe(), format: 2, wholeCanvas: { enabled: false, weight: 1, references: [] } };
    const { optimizer: _, ...formatFour } = { ...recipe(), format: 4 };
    for (const older of [formatOne, formatTwo, { ...recipe(), format: 3 }, formatFour]) {
      const refused = await submit(env, { recipe: JSON.stringify(older) });
      expect(refused.status, `format ${older.format}`).toBe(400);
      expect(refused.body.error).toMatch(/format 7/);
    }
    expect(submissions.keys()).toEqual([]);
  });

  it("accepts a format-5 recipe and stores it as the current format 7, its requests asking their own block alone", async () => {
    const { env, submissions } = testEnv();
    const formatFive = JSON.parse(JSON.stringify({ ...recipe(), format: 5 }));
    delete formatFive.requests[0].respondLike.alsoBlocks;
    const { status, body } = await submit(env, { recipe: JSON.stringify(formatFive) });
    expect(status).toBe(201);
    const stored = JSON.parse(new TextDecoder().decode(submissions.objects.get(`pending/${body.id}/recipe.json`)!.body));
    expect(stored).toEqual(recipe());
  });

  it("accepts a format-6 recipe and stores it as format 7, its code request a point at radius 1", async () => {
    const { env, submissions } = testEnv();
    const formatSix = JSON.parse(JSON.stringify({ ...recipe(), format: 6 }));
    delete formatSix.requests[0].respondLike.target;
    delete formatSix.requests[0].respondLike.radius;
    const { status, body } = await submit(env, { recipe: JSON.stringify(formatSix) });
    expect(status).toBe(201);
    const stored = JSON.parse(new TextDecoder().decode(submissions.objects.get(`pending/${body.id}/recipe.json`)!.body));
    expect(stored).toEqual(recipe());
  });

  it("refuses a block beyond the release's dictionary and a release that is not published", async () => {
    const { env, submissions } = testEnv();
    const outside = recipe();
    outside.requests[0]!.block = 16384;
    expect((await submit(env, { recipe: JSON.stringify(outside) })).body.error).toMatch(/not valid/);
    expect((await submit(env, { recipe: JSON.stringify({ ...recipe(), release: "pass-999" }) })).body.error).toMatch(/unknown release/);
    expect((await submit(env, { recipe: JSON.stringify({ ...recipe(), release: "../model" }) })).body.error).toMatch(/unknown release/);
    expect(submissions.keys()).toEqual([]);
  });

  it("stores the recipe rebuilt from known fields only", async () => {
    const { env, submissions } = testEnv();
    const { body } = await submit(env, { recipe: JSON.stringify({ ...recipe(), comment: "<script>" }) });
    const stored = JSON.parse(new TextDecoder().decode(submissions.objects.get(`pending/${body.id}/recipe.json`)!.body));
    expect(stored).toEqual(recipe());
  });

  it("needs a Content-Length within the limit and a multipart body", async () => {
    const { env } = testEnv();
    const post = (headers: Record<string, string>) =>
      worker.fetch(new Request("https://app.test/api/submissions", { method: "POST", body: "x", headers }), env);
    expect((await post({ "content-length": String(SUBMISSION_LIMITS.requestBytes + 1), "content-type": "multipart/form-data; boundary=x" })).status).toBe(413);
    expect((await post({ "content-length": "1", "content-type": "application/json" })).status).toBe(415);
  });

  it("limits submissions per client before reading the body", async () => {
    const { env, submissions } = testEnv(false);
    expect((await submit(env)).status).toBe(429);
    expect(submissions.keys()).toEqual([]);
  });
});

describe("Turnstile on POST /api/submissions", () => {
  // Cloudflare's always-pass test secret; the widget's test site key gives the dummy token.
  const SECRET = "1x0000000000000000000000000000000AA";
  const TEST_TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

  /** Replace siteverify; each call records its form and answers `answer`. */
  function siteverify(answer: () => Response | Promise<Response>) {
    const calls: URLSearchParams[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe(SITEVERIFY_URL);
      calls.push(new URLSearchParams(init.body as URLSearchParams));
      return answer();
    });
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses every submission without the secret, before reading the form", async () => {
    const calls = siteverify(() => Response.json({ success: true }));
    const { env, submissions } = testEnv();
    delete env.TURNSTILE_SECRET;
    expect(await submit(env)).toEqual({ status: 503, body: { error: "submissions are closed: the human check is not configured" } });
    expect(calls).toEqual([]);
    expect(submissions.keys()).toEqual([]);
  });

  it("stores a submission whose token siteverify accepts, and sends the secret, token and client IP", async () => {
    const calls = siteverify(() => Response.json({ success: true }));
    const { env, submissions } = testEnv();
    env.TURNSTILE_SECRET = SECRET;
    expect((await submit(env, { turnstileToken: TEST_TURNSTILE_TOKEN })).status).toBe(201);
    expect(calls.map((form) => Object.fromEntries(form))).toEqual([{ secret: SECRET, response: TEST_TURNSTILE_TOKEN, remoteip: "203.0.113.9" }]);
    expect(submissions.keys()).toHaveLength(3);
  });

  it("refuses a missing or rejected token with 403 and stores nothing", async () => {
    const calls = siteverify(() => Response.json({ success: false, "error-codes": ["invalid-input-response"] }));
    const { env, submissions } = testEnv();
    env.TURNSTILE_SECRET = SECRET;
    expect(await submit(env, { turnstileToken: null })).toEqual({ status: 403, body: { error: "The check failed; try again." } });
    expect(calls).toHaveLength(0);
    expect((await submit(env, { turnstileToken: "forged" })).status).toBe(403);
    expect(calls).toHaveLength(1);
    expect(submissions.keys()).toEqual([]);
  });

  it("checks the form first, so a refused form does not spend the token", async () => {
    const calls = siteverify(() => Response.json({ success: true }));
    const { env } = testEnv();
    env.TURNSTILE_SECRET = SECRET;
    expect((await submit(env, { title: "", turnstileToken: TEST_TURNSTILE_TOKEN })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("answers 503 when siteverify cannot be reached", async () => {
    siteverify(() => Promise.reject(new TypeError("network")));
    const { env, submissions } = testEnv();
    env.TURNSTILE_SECRET = SECRET;
    expect((await submit(env, { turnstileToken: TEST_TURNSTILE_TOKEN })).status).toBe(503);
    expect(submissions.keys()).toEqual([]);
  });

  it.each([null, [], {}, { success: "true" }].map((answer) => [answer]))("answers 503 for a malformed siteverify response: %j", async (answer) => {
    siteverify(() => Response.json(answer));
    const { env, submissions } = testEnv();
    expect((await submit(env)).status).toBe(503);
    expect(submissions.keys()).toEqual([]);
  });
});

describe("routes", () => {
  it("serves an empty gallery before any approval, with a short cache lifetime", async () => {
    const { env } = testEnv();
    const response = await worker.fetch(new Request("https://app.test/api/gallery"), env);
    expect(response.headers.get("cache-control")).toBe(CACHE_INDEX);
    expect(await response.json()).toEqual({ entries: [] });
  });

  it("sends app paths to the static assets and answers unknown API paths itself", async () => {
    const { env, assetRequests } = testEnv();
    expect((await worker.fetch(new Request("https://app.test/index"), env)).status).toBe(200);
    expect(assetRequests).toEqual(["/"]);
    // A block page is the app's page too, read as "/" and given its link-preview tags (link-preview.ts).
    expect((await worker.fetch(new Request("https://app.test/basis/12"), env)).status).toBe(200);
    expect(assetRequests).toEqual(["/", "/"]);
    expect((await worker.fetch(new Request("https://app.test/api/other"), env)).status).toBe(404);
    expect((await worker.fetch(new Request("https://app.test/api/gallery", { method: "POST" }), env)).status).toBe(405);
  });

  it("answers a file the build lacks under /assets/ with 404, not the app's index.html", async () => {
    const { env } = testEnv();
    // The static assets as deployed: the build's files, and index.html for every other path.
    env.ASSETS = {
      fetch: async (request: Request) =>
        new URL(request.url).pathname === "/assets/engine.worker-BAZWNlvA.js"
          ? new Response("self.onmessage = () => {};", { headers: { "content-type": "text/javascript" } })
          : new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
    };
    const current = await worker.fetch(new Request("https://app.test/assets/engine.worker-BAZWNlvA.js"), env);
    expect(current.status).toBe(200);
    expect(await current.text()).toBe("self.onmessage = () => {};");

    // A tab from an earlier build asks for its own engine worker after a deploy.
    const stale = await worker.fetch(new Request("https://app.test/assets/engine.worker-DdQOB2wZ.js"), env);
    expect(stale.status).toBe(404);
    expect(stale.headers.get("cache-control")).toBe("no-store");
    expect(stale.headers.get("content-type")).not.toMatch(/html/);

    const route = await worker.fetch(new Request("https://app.test/basis/12"), env);
    expect([route.status, route.headers.get("content-type")]).toEqual([200, "text/html"]);
  });
});

describe("review", () => {
  it("submits, approves and lists: the entry is public and the pending objects are gone", async () => {
    const { env, submissions, library } = testEnv();
    const { body } = await submit(env, { engine: "app/24a0790f50c6e613/dinodreamer_engine_bg.wasm" });
    const id = body.id!;
    expect((await pendingSubmissions(submissions)).map((metadata) => metadata.id)).toEqual([id]);

    const entry = await approve(submissions, library, id, new Date("2026-10-12T10:00:00Z"), sharpThumbnail);
    expect(entry).toEqual({
      id,
      title: "Collar",
      credit: "Contributor",
      imageUrl: `gallery/${id}/image.png`,
      thumbnailUrl: `gallery/${id}/thumbnail.webp`,
      recipeUrl: `gallery/${id}/recipe.json`,
      publishedAt: "2026-10-12T10:00:00.000Z",
      engine: "app/24a0790f50c6e613/dinodreamer_engine_bg.wasm",
    });
    expect(library.objects.get(`gallery/${id}/image.png`)).toEqual({
      body: PNG,
      httpMetadata: { contentType: "image/png", cacheControl: CACHE_IMMUTABLE },
    });
    const thumbnail = library.objects.get(`gallery/${id}/thumbnail.webp`)!;
    expect(thumbnail.httpMetadata).toEqual({ contentType: "image/webp", cacheControl: CACHE_IMMUTABLE });
    expect(await sharp(thumbnail.body).metadata()).toMatchObject({ format: "webp", width: 256, height: 256 });
    expect(library.objects.get(INDEX_KEY)!.httpMetadata.cacheControl).toBe(CACHE_INDEX);
    expect(submissions.keys()).toEqual([]);

    const listed = (await (await worker.fetch(new Request("https://app.test/api/gallery"), env)).json()) as { entries: unknown[] };
    expect(listed.entries).toEqual([entry]);
  });

  it("rejects by deleting the pending objects only", async () => {
    const { env, submissions } = testEnv();
    const { body } = await submit(env);
    await reject(submissions, body.id!);
    expect(submissions.keys()).toEqual([]);
    await expect(reject(submissions, body.id!)).rejects.toThrow(/no pending submission/);
    await expect(reject(submissions, "../published")).rejects.toThrow(/not a submission id/);
  });

  it("approves every listed pending submission in one run, newest first in the index", async () => {
    const { env, submissions, library } = testEnv();
    const first = (await submit(env, { title: "First" })).body.id!;
    const second = (await submit(env, { title: "Second" })).body.id!;
    const listed = await pendingSubmissions(submissions);
    const late = (await submit(env, { title: "After the question" })).body.id!;
    const entries = await approveAll(submissions, library, listed.map((metadata) => metadata.id), new Date("2026-10-15T09:00:00Z"), sharpThumbnail);
    // Ids sort by submission second, then by their random suffix: both came in the same second.
    const oldestFirst = [first, second].sort();
    expect(entries.map((entry) => entry.id)).toEqual(oldestFirst);
    const { pending, published } = await galleryEntries(submissions, library);
    expect(published.map((entry) => entry.id)).toEqual(oldestFirst.reverse());
    expect(pending.map((metadata) => metadata.id)).toEqual([late]);
  });

  it("finishes an approval that stopped while deleting the pending copy, and recovers from the published copy", async () => {
    const { env, submissions, library } = testEnv();
    const interrupted = (await submit(env, { title: "Interrupted" })).body.id!;
    const next = (await submit(env, { title: "Next" })).body.id!;
    // RestBucket deletes one key at a time; this connection fails after the first delete.
    const failsAfterOneDelete: Bucket = {
      get: (key) => submissions.get(key),
      put: (key, body, options) => submissions.put(key, body, options),
      list: (options) => submissions.list(options),
      delete: async (keys) => {
        await submissions.delete([keys].flat()[0]!);
        throw new Error("connection reset");
      },
    };
    await expect(approve(failsAfterOneDelete, library, interrupted, new Date("2026-10-15T09:00:00Z"), sharpThumbnail)).rejects.toThrow("connection reset");
    expect(submissions.keys(`pending/${interrupted}/`)).toEqual([`pending/${interrupted}/meta.json`, `pending/${interrupted}/recipe.json`]);
    const recovered = JSON.parse((await recoverCreation(submissions, library, interrupted)).text) as { createdAt: string };
    expect(recovered.createdAt).toBe("2026-10-15T09:00:00.000Z");

    const listed = await pendingSubmissions(submissions);
    expect(listed.map((metadata) => metadata.id).sort()).toEqual([interrupted, next].sort());
    await approveAll(submissions, library, listed.map((metadata) => metadata.id), new Date("2026-10-15T10:00:00Z"), sharpThumbnail);
    expect(submissions.keys()).toEqual([]);
    const { published } = await galleryEntries(submissions, library);
    expect(published.map((entry) => [entry.title, entry.publishedAt])).toEqual([
      ["Next", "2026-10-15T10:00:00.000Z"],
      ["Interrupted", "2026-10-15T09:00:00.000Z"],
    ]);
  });

  it("hides a published entry and restores it to its place; the public objects stay", async () => {
    const { env, submissions, library } = testEnv();
    const older = (await submit(env, { title: "Older" })).body.id!;
    const newer = (await submit(env, { title: "Newer" })).body.id!;
    await approve(submissions, library, older, new Date("2026-10-12T10:00:00Z"), sharpThumbnail);
    const entry = await approve(submissions, library, newer, new Date("2026-10-12T11:00:00Z"), sharpThumbnail);
    const objects = library.keys("gallery/");
    const gallery = async () => ((await (await worker.fetch(new Request("https://app.test/api/gallery"), env)).json()) as { entries: { id: string }[] }).entries;

    const hidden = await hide(submissions, library, newer, new Date("2026-10-15T09:00:00Z"));
    expect(hidden).toEqual({ ...entry, hiddenAt: "2026-10-15T09:00:00.000Z" });
    expect((await gallery()).map((shown) => shown.id)).toEqual([older]);
    expect(library.objects.get(INDEX_KEY)!.httpMetadata.cacheControl).toBe(CACHE_INDEX);
    expect(library.keys("gallery/")).toEqual(objects);
    expect(await galleryEntries(submissions, library)).toMatchObject({ published: [{ id: older }], hidden: [{ id: newer, title: "Newer" }] });
    expect(await findEntry(submissions, library, newer)).toEqual({ state: "hidden", entry: hidden });
    await expect(hide(submissions, library, newer, new Date())).rejects.toThrow(/no published entry/);

    expect(await restore(submissions, library, newer)).toEqual(entry);
    expect((await gallery()).map((shown) => shown.id)).toEqual([newer, older]);
    expect(submissions.keys()).toEqual([]);
    await expect(restore(submissions, library, newer)).rejects.toThrow(/no hidden entry/);
    await expect(hide(submissions, library, "../published", new Date())).rejects.toThrow(/not a submission id/);
  });

  it("finishes a hide or a restore that failed halfway when it runs again", async () => {
    const { env, submissions, library } = testEnv();
    const id = (await submit(env)).body.id!;
    const entry = await approve(submissions, library, id, new Date("2026-10-12T10:00:00Z"), sharpThumbnail);
    // A hide that wrote its record but not the index: the entry is still shown, so hide runs again.
    await submissions.put(hiddenKey(id), JSON.stringify({ ...entry, hiddenAt: "2026-10-15T08:00:00.000Z" }));
    await hide(submissions, library, id, new Date("2026-10-15T09:00:00Z"));
    expect((await galleryEntries(submissions, library)).published).toEqual([]);
    // A restore that wrote the index but did not delete the record: restore runs again.
    await library.put(INDEX_KEY, JSON.stringify({ entries: [entry] }));
    expect(await restore(submissions, library, id)).toEqual(entry);
    expect(await galleryEntries(submissions, library)).toMatchObject({ published: [entry], hidden: [] });
  });

  it("purges a shown or a hidden entry: its public objects, index entry and hidden record", async () => {
    const { env, submissions, library } = testEnv();
    const kept = (await submit(env)).body.id!;
    const shown = (await submit(env)).body.id!;
    const hidden = (await submit(env)).body.id!;
    await approve(submissions, library, kept, new Date("2026-10-12T10:00:00Z"), sharpThumbnail);
    await approve(submissions, library, shown, new Date("2026-10-12T11:00:00Z"), sharpThumbnail);
    await approve(submissions, library, hidden, new Date("2026-10-12T12:00:00Z"), sharpThumbnail);
    await hide(submissions, library, hidden, new Date("2026-10-15T09:00:00Z"));

    await purge(submissions, library, shown);
    await purge(submissions, library, hidden);
    expect(library.keys("gallery/")).toEqual([`gallery/${kept}/image.png`, `gallery/${kept}/recipe.json`, `gallery/${kept}/thumbnail.webp`]);
    expect(await galleryEntries(submissions, library)).toMatchObject({ pending: [], published: [{ id: kept }], hidden: [] });
    expect(submissions.keys()).toEqual([]);
    const listed = (await (await worker.fetch(new Request("https://app.test/api/gallery"), env)).json()) as { entries: { id: string }[] };
    expect(listed.entries[0]).not.toHaveProperty("engine");
    await expect(purge(submissions, library, shown)).rejects.toThrow(/no published or hidden entry/);
  });

  it("finishes a purge that failed after deleting the objects when it runs again", async () => {
    const { env, submissions, library } = testEnv();
    const id = (await submit(env)).body.id!;
    await approve(submissions, library, id, new Date("2026-10-12T10:00:00Z"), sharpThumbnail);
    await library.delete(library.keys(`gallery/${id}/`));
    expect(await findEntry(submissions, library, id)).toMatchObject({ state: "published" });
    await purge(submissions, library, id);
    expect(await findEntry(submissions, library, id)).toBeNull();
  });

  it("keeps the index newest first and replaces a re-approved entry", () => {
    const entry = (id: string, publishedAt: string) => ({ id, title: id, credit: "", imageUrl: "", thumbnailUrl: "", recipeUrl: "", publishedAt });
    let index = withEntry({ entries: [] }, entry("a", "2026-10-11T00:00:00Z"));
    index = withEntry(index, entry("b", "2026-10-12T00:00:00Z"));
    index = withEntry(index, entry("a", "2026-10-13T00:00:00Z"));
    expect(index.entries.map((item) => `${item.id}@${item.publishedAt.slice(8, 10)}`)).toEqual(["a@13", "b@12"]);
  });

  it("names submissions by UTC time and four random bytes", () => {
    expect(submissionId(new Date("2026-10-11T15:30:12.345Z"), new Uint8Array([0xa1, 0xb2, 0xc3, 0x04]))).toBe("20261011-153012-a1b2c304");
  });

  it("rebuilds a pending, published or hidden submission as the creation file the app imports", async () => {
    const { env, submissions, library } = testEnv();
    const engine = "app/528a718f4e655b9c/dinodreamer_engine_bg.wasm";
    const id = (await submit(env, { engine })).body.id!;
    expect(RECOVERED_FORMAT).toBe(CREATION_FILE_FORMAT);

    const pending = await recoverCreation(submissions, library, id);
    const imported = decodeCreationFile(pending.text);
    expect(pending.title).toBe("Collar");
    expect(imported.title).toBe("Collar");
    expect(imported.recipe).toEqual(recipe());
    expect(new Uint8Array(await imported.previewPng.arrayBuffer())).toEqual(PNG);
    expect(imported.engine).toBe(engine);
    expect(imported.upgradedFrom).toBeUndefined();

    await approve(submissions, library, id, new Date("2026-10-13T05:00:00Z"), sharpThumbnail);
    const published = decodeCreationFile((await recoverCreation(submissions, library, id)).text);
    expect(published.recipe).toEqual(recipe());
    expect(new Uint8Array(await published.previewPng.arrayBuffer())).toEqual(PNG);
    expect(published.engine).toBe(engine);
    expect(JSON.parse((await recoverCreation(submissions, library, id)).text)).toMatchObject({ createdAt: "2026-10-13T05:00:00.000Z" });

    await hide(submissions, library, id, new Date("2026-10-15T09:00:00Z"));
    expect(decodeCreationFile((await recoverCreation(submissions, library, id)).text).recipe).toEqual(recipe());

    await expect(recoverCreation(submissions, library, "20261013-000000-00000000")).rejects.toThrow(/no pending, published or hidden submission/);
  });
});

describe("CDN check after a purge", () => {
  it("counts only 200 as served and 404 as absent; any other answer or no answer is unknown", async () => {
    const answers = [200, 404, 403, 429, 503];
    const asked: (string | undefined)[] = [];
    const fetcher = (async (_url: string, init: { headers: Record<string, string> }) => {
      asked.push(init.headers.origin);
      const status = answers.shift();
      if (status === undefined) throw new Error("getaddrinfo ENOTFOUND");
      return new Response(null, { status, headers: { "cf-cache-status": "HIT", "cf-ray": "8d00aa11bb22cc33-CDG" } });
    }) as unknown as typeof fetch;
    const urls = ["https://library.test/gallery/a/image.png", "https://library.test/gallery/a/thumbnail.webp", "https://library.test/gallery/a/recipe.json"];
    const checks = await checkCopies(urls, fetcher);
    expect(checks.map((check) => check.state)).toEqual(["served", "absent here", "unknown", "unknown", "unknown", "unknown"]);
    expect(asked).toEqual([undefined, APP_ORIGIN, undefined, APP_ORIGIN, undefined, APP_ORIGIN]);
    expect(checks[0]!.detail).toBe("HTTP 200, cf-cache-status HIT, edge CDG");
    expect(checks[5]!.detail).toBe("no answer: getaddrinfo ENOTFOUND");
  });

  it("names the entry's prefix for the dashboard purge and a recheck command per copy", () => {
    expect(purgePrefix("https://library.computervision.vision", "20261015-072415-18a22c44")).toBe("library.computervision.vision/gallery/20261015-072415-18a22c44/");
    expect(curlCommand("https://l.test/x.png", APP_ORIGIN)).toBe(`curl -s -o /dev/null -w '%{http_code}\\n' -H 'origin: ${APP_ORIGIN}' https://l.test/x.png`);
  });
});

describe("thumbnail", () => {
  it("is a WebP of the image's pixels at 256 px", async () => {
    const decoded = await sharp(await sharpThumbnail(PNG)).raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: THUMBNAIL_PIXELS, height: THUMBNAIL_PIXELS });
    const expected = [PNG_COLOUR.r, PNG_COLOUR.g, PNG_COLOUR.b];
    let error = 0;
    for (let offset = 0; offset < decoded.data.length; offset += decoded.info.channels) {
      for (let channel = 0; channel < 3; channel += 1) error += Math.abs(decoded.data[offset + channel]! - expected[channel]!);
    }
    const meanError = error / (3 * THUMBNAIL_PIXELS * THUMBNAIL_PIXELS);
    expect(meanError, `mean absolute error ${meanError}`).toBeLessThan(4);
  });

  it("fits a larger image inside 256 px with its aspect ratio, and does not enlarge a smaller one", async () => {
    const wide = await sharp(await sharpThumbnail(await flatPng(512, 384, PNG_COLOUR))).metadata();
    expect(wide).toMatchObject({ format: "webp", width: 256, height: 192 });
    const small = await sharp(await sharpThumbnail(await flatPng(64, 64, PNG_COLOUR))).metadata();
    expect(small).toMatchObject({ format: "webp", width: 64, height: 64 });
  });
});

describe("terminal bucket over the REST API", () => {
  it("pages listings, maps a missing object to null and sends the metadata headers", async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const fetcher = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string> });
      if (url.includes("?") && !url.includes("cursor=")) {
        return Response.json({ result: [{ key: "pending/a/meta.json" }], result_info: { cursor: "c1", is_truncated: true } });
      }
      if (url.includes("cursor=c1")) return Response.json({ result: [{ key: "pending/b/meta.json" }], result_info: { is_truncated: false } });
      if (url.endsWith("/missing.json")) return new Response("", { status: 404 });
      return new Response("{}");
    }) as unknown as typeof fetch;
    const bucket = new RestBucket("dinodreamer-submissions", "token", fetcher);
    const first = await bucket.list({ prefix: "pending/" });
    expect(first).toEqual({ objects: [{ key: "pending/a/meta.json" }], truncated: true, cursor: "c1" });
    expect((await bucket.list({ prefix: "pending/", cursor: "c1" })).truncated).toBe(false);
    expect(await bucket.get("missing.json")).toBeNull();
    await bucket.put("gallery/x/image.png", PNG, { httpMetadata: { contentType: "image/png", cacheControl: CACHE_IMMUTABLE } });
    const put = calls.at(-1)!;
    expect(put.method).toBe("PUT");
    expect(put.headers).toMatchObject({ "content-type": "image/png", "cache-control": CACHE_IMMUTABLE, authorization: "Bearer token" });
    expect(put.url).toMatch(/\/r2\/buckets\/dinodreamer-submissions\/objects\/gallery\/x\/image\.png$/);
  });
});

it("sends a request again after the API's rate limit or a server error, and gives up after six attempts", async () => {
  let calls = 0;
  const answers = [429, 503, 200];
  const fetcher = (async () => new Response("{}", { status: answers[calls++] ?? 200 })) as unknown as typeof fetch;
  const bucket = new RestBucket("dinodreamer-library", "token", fetcher, () => 0);
  await bucket.put("a.json", "{}");
  expect(calls).toBe(3);
  let limited = 0;
  const always = (async () => { limited++; return new Response("slow down", { status: 429 }); }) as unknown as typeof fetch;
  await expect(new RestBucket("dinodreamer-library", "token", always, () => 0).put("a.json", "{}")).rejects.toThrow(/HTTP 429/);
  expect(limited).toBe(6);
});

it("wrangler.jsonc binds the buckets the scripts write, and routes /api/*, /assets/* and /admin to the Worker", () => {
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  expect(config).toContain(`"binding": "SUBMISSIONS", "bucket_name": "${SUBMISSIONS_BUCKET}"`);
  expect(config).toContain(`"binding": "LIBRARY", "bucket_name": "${PUBLIC_BUCKET}"`);
  const routes = JSON.parse(/"run_worker_first":\s*(\[[^\]]+\])/.exec(config)![1]!) as string[];
  expect(routes).toEqual(expect.arrayContaining([
    "/api/*", "/assets/*", "/admin", "/admin/*", "/", "/basis/*",
    "/explore", "/explore/*", "/block/*", "/playground", "/playground/*", "/grow", "/grow/*",
    "/index", "/index/*", "/automata", "/automata/*", "/train", "/train/*", "/picture", "/picture/*",
    "/how", "/how/*", "/create", "/create/*", "/canvas", "/gallery", "/saved",
  ]));
});

it("the owner's commands load under plain Node, without the app's bundler-only imports", () => {
  // Node strips types but needs explicit file extensions; app modules import without them.
  const script = 'await import("./src/review.ts"); await import("./src/rest-bucket.ts"); await import("./src/material-review.ts");';
  expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: new URL("..", import.meta.url) })).not.toThrow();
});

describe("painted recipe contract", () => {
  it("retains nonbinary percentages through submission and recovery", async () => {
    const { env, submissions, library } = testEnv();
    const painted = recipe();
    painted.requests[0]!.respondLike.where = Array.from({ length: CELLS }, (_, cell) => cell % 101);
    painted.requests[0]!.lookLike.where.fill(100);
    const { body } = await submit(env, { recipe: JSON.stringify(painted) });
    const recovered = decodeCreationFile((await recoverCreation(submissions, library, body.id!)).text);
    expect(recovered.recipe).toEqual(painted);
    expect(recovered.upgradedFrom).toBeUndefined();
  });

  it("keeps the 64 KiB recipe boundary", async () => {
    const { env } = testEnv();
    const oversized = JSON.stringify({ ...recipe(), padding: "x".repeat(64 * 1024) });
    const refused = await submit(env, { recipe: oversized });
    expect(refused.status).toBe(413);
  });
});
