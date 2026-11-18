import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ownerRequest } from "../src/admin.ts";
import { ACCESS_TOKEN_HEADER } from "../src/access.ts";
import { PURGE_BY_PREFIX_PLACE } from "../src/cdn-check.ts";
import { approve } from "../src/review.ts";
import { CACHE_IMMUTABLE, type Bucket } from "../src/storage.ts";
import { sharpThumbnail } from "../src/thumbnail-sharp.ts";
import worker, { type Env } from "../src/worker.ts";
import { PNG, submit, testEnv } from "./fixtures.ts";

const TEAM = "https://owner-test.cloudflareaccess.com";
const AUD = "aud-of-the-owner-application";
const PAGE = "<!doctype html><title>owner page</title>";
const NOW_SECONDS = Math.floor(Date.now() / 1000);

type KeyPair = { privateKey: CryptoKey; publicJwk: JsonWebKey & { kid: string } };

async function signingPair(kid: string): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "RS256", use: "sig" };
  return { privateKey: pair.privateKey, publicJwk };
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/[=]+$/, "");
}

/** A token as Access issues it: RS256, the key's kid, the team as issuer and the application as audience. */
async function accessToken(signer: KeyPair, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): Promise<string> {
  const head = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: signer.publicJwk.kid, ...header })));
  const payload = { iss: TEAM, aud: [AUD], email: "owner@example.test", iat: NOW_SECONDS - 60, nbf: NOW_SECONDS - 60, exp: NOW_SECONDS + 3600, ...claims };
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${base64Url(new Uint8Array(signature))}`;
}

const teamKey = await signingPair("team-key-1");
const rotatedKey = await signingPair("team-key-2");
const strangerKey = await signingPair("team-key-1");

/** The team's published keys; `published` is what the certs endpoint lists at the moment. */
function certsEndpoint(published: KeyPair[]): { fetcher: typeof fetch; requests: string[] } {
  const requests: string[] = [];
  const fetcher = (async (url: string) => {
    requests.push(url);
    if (url !== `${TEAM}/cdn-cgi/access/certs`) return new Response("", { status: 404 });
    return Response.json({ keys: published.map((pair) => pair.publicJwk) });
  }) as unknown as typeof fetch;
  return { fetcher, requests };
}

function accessEnv(): Env {
  const { env } = testEnv();
  return { ...env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
}

async function entries(env: Env, token: string | null, fetcher: typeof fetch) {
  const headers: Record<string, string> = token === null ? {} : { [ACCESS_TOKEN_HEADER]: token };
  const response = await ownerRequest(new Request("https://computervision.vision/admin/api/entries", { headers }), env, PAGE, fetcher);
  return { status: response.status, body: (await response.json()) as { error?: string; owner?: string } };
}

describe("owner access: the Worker's own check of the Access token", () => {
  const { fetcher } = certsEndpoint([teamKey]);

  it("admits a token signed by the team's key, for this application, within its lifetime", async () => {
    const answer = await entries(accessEnv(), await accessToken(teamKey), fetcher);
    expect(answer.status).toBe(200);
    expect(answer.body.owner).toBe("owner@example.test");
  });

  it.each([
    ["no token", async () => null, /no Access token/],
    ["a malformed token", async () => "not.a-token", /malformed/],
    // JSON.parse gives null for "null"; the check must refuse it, not throw.
    ["a header that is not an object", async () => "bnVsbA.e30.AA", /malformed/],
    ["a payload that is not an object", async () => `${base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "team-key-1" })))}.bnVsbA.AA`, /malformed/],
    ["another algorithm", async () => accessToken(teamKey, {}, { alg: "HS256" }), /not RS256/],
    ["a key the team does not publish", async () => accessToken(teamKey, {}, { kid: "someone-else" }), /not the team's/],
    ["a bad signature", async () => accessToken(strangerKey), /bad Access token signature/],
    ["another team", async () => accessToken(teamKey, { iss: "https://other.cloudflareaccess.com" }), /another team/],
    ["another application", async () => accessToken(teamKey, { aud: ["another-aud"] }), /another application/],
    ["an expired token", async () => accessToken(teamKey, { exp: NOW_SECONDS - 1 }), /expired/],
    ["a token not valid yet", async () => accessToken(teamKey, { nbf: NOW_SECONDS + 600 }), /not valid yet/],
  ])("refuses %s with 403", async (_case, token, reason) => {
    const answer = await entries(accessEnv(), await token(), fetcher);
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatch(reason);
  });

  it("refuses even a good token while the Access settings are missing", async () => {
    const { env } = testEnv();
    const answer = await entries({ ...env, ACCESS_TEAM_DOMAIN: TEAM }, await accessToken(teamKey), fetcher);
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatch(/not configured/);
  });

  it("fetches the team's keys again for an unknown kid, so a key rotation needs nothing", async () => {
    const endpoint = certsEndpoint([teamKey]);
    expect((await entries(accessEnv(), await accessToken(teamKey), endpoint.fetcher)).status).toBe(200);
    const rotated = certsEndpoint([teamKey, rotatedKey]);
    expect((await entries(accessEnv(), await accessToken(rotatedKey), rotated.fetcher)).status).toBe(200);
    expect(rotated.requests).toEqual([`${TEAM}/cdn-cgi/access/certs`]);
  });

  it("stays closed when a published key cannot be imported", async () => {
    // A key whose declared algorithm is not RS256: WebCrypto's import throws for it.
    const mislabelled = { ...teamKey.publicJwk, kid: "broken-key", alg: "RS512" };
    const broken = (async () => Response.json({ keys: [mislabelled] })) as unknown as typeof fetch;
    const answer = await entries(accessEnv(), await accessToken(teamKey, {}, { kid: "broken-key" }), broken);
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatch(/could not be checked/);
  });

  it("stays closed when the team's keys cannot be read", async () => {
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const answer = await entries(accessEnv(), await accessToken(rotatedKey, {}, { kid: "team-key-3" }), down);
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatch(/could not be read/);
  });

  it("serves the page only to the owner, framed by no other site; the app's fallback never answers /admin", async () => {
    const token = await accessToken(teamKey);
    const page = await ownerRequest(new Request("https://computervision.vision/admin", { headers: { [ACCESS_TOKEN_HEADER]: token } }), accessEnv(), PAGE, fetcher);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(await page.text()).toBe(PAGE);

    const { env, assetRequests } = testEnv();
    for (const path of ["/admin", "/admin/", "/admin/api/entries", "/admin/anything"]) {
      const refused = await worker.fetch(new Request(`https://computervision.vision${path}`), env);
      expect(refused.status, path).toBe(403);
    }
    expect(assetRequests).toEqual([]);
    const page403 = await worker.fetch(new Request("https://computervision.vision/admin"), env);
    expect(await page403.text()).toMatch(/Owner access refused/);
  });
});

describe("the local owner under wrangler dev", () => {
  const refuse = (async () => {
    throw new Error("no network in this test");
  }) as unknown as typeof fetch;

  it("is admitted only with the dev var and a request to this machine", async () => {
    const { env } = testEnv();
    const local = { ...env, ADMIN_LOCAL_OWNER: "yes" };
    const ask = (url: string, withEnv: Env) => ownerRequest(new Request(url), withEnv, PAGE, refuse);
    const admitted = await ask("http://127.0.0.1:8791/admin/api/entries", local);
    expect(admitted.status).toBe(200);
    expect(((await admitted.json()) as { owner: string }).owner).toBe("local owner");
    expect((await ask("http://localhost:8791/admin", local)).status).toBe(200);
    // The var alone opens nothing on a public host.
    expect((await ask("https://computervision.vision/admin/api/entries", local)).status).toBe(403);
    expect((await ask("https://dinodreamer-public.omi27000.workers.dev/admin", local)).status).toBe(403);
    // This machine alone opens nothing without the var.
    expect((await ask("http://127.0.0.1:8791/admin/api/entries", env)).status).toBe(403);
  });

  it("production config never sets the bypass; it names Access, the Images binding and the app's library host", () => {
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(config).not.toContain("ADMIN_LOCAL_OWNER");
    expect(config).toContain(`"images": { "binding": "IMAGES" }`);
    expect(config).toMatch(/"ACCESS_TEAM_DOMAIN": "https:\/\/[a-z0-9-]+\.cloudflareaccess\.com"/);
    const appEnv = readFileSync(new URL("../../app/.env", import.meta.url), "utf8");
    const appBase = appEnv.split("\n").find((line) => line.startsWith("ASSET_BASE_URL="))!.slice("ASSET_BASE_URL=".length).trim();
    expect(config).toContain(`"ASSET_BASE_URL": "${appBase}"`);
  });
});

describe("owner API: the review operations", () => {
  const ORIGIN = "http://127.0.0.1:8791";
  const neverFetch = (async () => {
    throw new Error("no network in this test");
  }) as unknown as typeof fetch;

  function ownerSetup() {
    const fixture = testEnv();
    const env: Env = { ...fixture.env, ADMIN_LOCAL_OWNER: "yes" };
    const get = async (path: string) => ownerRequest(new Request(`${ORIGIN}${path}`), env, PAGE, neverFetch);
    const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
      const request = new Request(`${ORIGIN}${path}`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      });
      const response = await ownerRequest(request, env, PAGE, neverFetch);
      return { status: response.status, body: (await response.json()) as Record<string, unknown> & { error?: string } };
    };
    const lists = async () =>
      (await (await get("/admin/api/entries")).json()) as {
        pending: { id: string; blocks: number[]; release: string; title: string }[];
        published: { id: string }[];
        hidden: { id: string }[];
      };
    return { ...fixture, env, get, post, lists };
  }

  it("lists a pending submission with its blocks and streams its picture from the private bucket", async () => {
    const { env, get, lists } = ownerSetup();
    const id = (await submit(env, { title: "Collar" })).body.id!;
    const { pending } = await lists();
    expect(pending.map((metadata) => [metadata.id, metadata.title, metadata.blocks, metadata.release])).toEqual([[id, "Collar", [6], "pass-003"]]);
    const picture = await get(`/admin/api/pending/${id}/image.png`);
    expect(picture.headers.get("content-type")).toBe("image/png");
    expect(picture.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(PNG);
    expect((await get("/admin/api/pending/20261011-153012-a1b2c3d4/image.png")).status).toBe(404);
    expect((await get("/admin/api/pending/..%2Fsecret/image.png")).status).toBe(404);
  });

  it("approves through the Images binding: a 256 px WebP at quality 75, published like the command's", async () => {
    const { env, post, get, lists, library, imageCalls } = ownerSetup();
    const id = (await submit(env, { title: "Collar" })).body.id!;
    const approved = await post("/admin/api/approve", { ids: [id] });
    expect(approved.status).toBe(200);
    expect(imageCalls).toEqual([{ transforms: [{ width: 256, height: 256, fit: "scale-down" }], output: { format: "image/webp", quality: 75 } }]);
    const thumbnail = library.objects.get(`gallery/${id}/thumbnail.webp`)!;
    expect(thumbnail.httpMetadata).toEqual({ contentType: "image/webp", cacheControl: CACHE_IMMUTABLE });
    expect(await sharp(thumbnail.body).metadata()).toMatchObject({ format: "webp", width: 256, height: 256 });
    const { pending, published } = await lists();
    expect(pending).toEqual([]);
    expect(published.map((entry) => entry.id)).toEqual([id]);
    const served = await get(`/admin/api/gallery/${id}/thumbnail.webp`);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(thumbnail.body);
  });

  it("approves exactly the listed submissions; one that arrives later waits", async () => {
    const { env, post, lists } = ownerSetup();
    const first = (await submit(env, { title: "First" })).body.id!;
    const second = (await submit(env, { title: "Second" })).body.id!;
    const shown = (await lists()).pending.map((metadata) => metadata.id);
    const late = (await submit(env, { title: "Later" })).body.id!;
    const answer = await post("/admin/api/approve", { ids: shown });
    expect((answer.body.entries as { id: string }[]).map((entry) => entry.id).sort()).toEqual([first, second].sort());
    expect((await lists()).pending.map((metadata) => metadata.id)).toEqual([late]);
  });

  it("rejects, hides, restores and purges with the review operations; the purge names the CDN step", async () => {
    const { env, post, lists, submissions, library } = ownerSetup();
    const rejected = (await submit(env, { title: "Rejected" })).body.id!;
    const kept = (await submit(env, { title: "Kept" })).body.id!;
    expect((await post("/admin/api/reject", { id: rejected })).status).toBe(200);
    expect(submissions.keys(`pending/${rejected}/`)).toEqual([]);
    const again = await post("/admin/api/reject", { id: rejected });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/no pending submission/);

    await post("/admin/api/approve", { ids: [kept] });
    expect((await post("/admin/api/hide", { id: kept })).status).toBe(200);
    expect((await lists()).hidden.map((entry) => entry.id)).toEqual([kept]);
    expect((await lists()).published).toEqual([]);
    expect((await post("/admin/api/restore", { id: kept })).status).toBe(200);
    expect((await lists()).published.map((entry) => entry.id)).toEqual([kept]);

    const purged = await post("/admin/api/purge", { id: kept });
    expect(purged.status).toBe(200);
    expect(purged.body.cdnPurge).toEqual({ place: PURGE_BY_PREFIX_PLACE, prefix: `library.test/gallery/${kept}/` });
    expect(library.keys("gallery/")).toEqual([]);
    expect(await lists()).toMatchObject({ pending: [], published: [], hidden: [] });
  });

  it("refuses a malformed action before it runs, and a POST from another site or without JSON", async () => {
    const { env, post, get } = ownerSetup();
    const id = (await submit(env)).body.id!;
    expect((await post("/admin/api/approve", { ids: [] })).status).toBe(400);
    expect((await post("/admin/api/approve", { ids: ["../published"] })).status).toBe(400);
    expect((await post("/admin/api/hide", { id: "../index" })).status).toBe(400);
    expect((await post("/admin/api/approve", "{not json")).status).toBe(400);
    // Valid JSON that is not an object is refused before any field is read.
    expect((await post("/admin/api/approve", "null")).status).toBe(400);
    expect((await post("/admin/api/approve", "[]")).status).toBe(400);
    expect((await post("/admin/api/delete-everything", { id })).status).toBe(404);
    expect((await post("/admin/api/approve", { ids: [id] }, { origin: "https://elsewhere.test" })).status).toBe(403);
    expect((await post("/admin/api/approve", { ids: [id] }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await get("/admin/api/unknown")).status).toBe(404);
    const put = await ownerRequest(new Request(`${ORIGIN}/admin/api/entries`, { method: "PUT" }), env, PAGE, neverFetch);
    expect(put.status).toBe(405);
    // Nothing above changed the pending submission.
    expect((await (await get("/admin/api/entries")).json()) as { pending: unknown[] }).toMatchObject({ pending: [{ id }] });
  });

  it("lists an approval whose cleanup stopped after publishing, and finishes it with approve", async () => {
    const { env, get, post, lists, submissions, library } = ownerSetup();
    const id = (await submit(env, { title: "Interrupted" })).body.id!;
    const waiting = (await submit(env, { title: "Waiting" })).body.id!;
    // The cleanup deletes image.png and recipe.json, then fails before meta.json.
    const interrupted: Bucket = {
      get: (key) => submissions.get(key),
      put: (key, body, options) => submissions.put(key, body, options),
      list: (options) => submissions.list(options),
      delete: async (keys) => {
        await submissions.delete([keys].flat().slice(0, 2));
        throw new Error("interrupted pending cleanup");
      },
    };
    await expect(approve(interrupted, library, id, new Date("2026-10-15T09:00:00Z"), sharpThumbnail)).rejects.toThrow("interrupted pending cleanup");
    expect(submissions.keys(`pending/${id}/`)).toEqual([`pending/${id}/meta.json`]);

    const listed = await get("/admin/api/entries");
    expect(listed.status).toBe(200);
    const { pending, published } = (await listed.json()) as { pending: { id: string; state: string; blocks: number[] | null }[]; published: { id: string }[] };
    // Both came in the same second, so their order is their random suffixes': compare by id.
    const rows = Object.fromEntries(pending.map((row) => [row.id, [row.state, row.blocks]]));
    expect(rows).toEqual({ [id]: ["cleanup unfinished", null], [waiting]: ["pending", [6]] });
    expect(published.map((entry) => entry.id)).toEqual([id]);

    expect((await post("/admin/api/approve", { ids: [id] })).status).toBe(200);
    expect(submissions.keys(`pending/${id}/`)).toEqual([]);
    const after = await lists();
    expect(after.pending.map((row) => row.id)).toEqual([waiting]);
    expect((after.published as { id: string; publishedAt?: string }[]).map((entry) => [entry.id, entry.publishedAt])).toEqual([[id, "2026-10-15T09:00:00.000Z"]]);
  });
});

describe("the basis groups' names", () => {
  const ORIGIN = "https://dinodreamer.computervision.vision";
  const neverFetch = (async () => {
    throw new Error("no network in this test");
  }) as unknown as typeof fetch;
  const localOwner = (): Env => ({ ...testEnv().env, ADMIN_LOCAL_OWNER: "yes" });
  const name = (env: Env, body: unknown, origin = "http://127.0.0.1:8791") => ownerRequest(new Request("http://127.0.0.1:8791/admin/api/basis-groups/name", {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  }), env, PAGE, neverFetch);

  it("the public Worker answers an empty object before the owner has named a group, then every name", async () => {
    const env = localOwner();
    const read = async () => (await worker.fetch(new Request(`${ORIGIN}/api/basis-groups`), env)).json();
    expect(await read()).toEqual({});
    expect(await (await name(env, { block: 729, name: " light on glass " })).json()).toEqual({ names: { "729": { name: "light on glass" } } });
    await name(env, { block: 2568, name: "golden fur" });
    expect(await read()).toEqual({ "729": { name: "light on glass" }, "2568": { name: "golden fur" } });
  });

  it("an empty name clears it, and a bad number or name is refused with the reason", async () => {
    const env = localOwner();
    await name(env, { block: 729, name: "light on glass" });
    expect(await (await name(env, { block: 729, name: "" })).json()).toEqual({ names: {} });
    expect((await name(env, { block: "729", name: "x" })).status).toBe(400);
    const tooLong = await name(env, { block: 729, name: "x".repeat(81) });
    expect([tooLong.status, ((await tooLong.json()) as { error: string }).error]).toEqual([409, "A name is 1 to 80 characters without control characters"]);
    expect((await name(env, { block: 729, name: "x" }, "https://another.example")).status).toBe(403);
  });
});
