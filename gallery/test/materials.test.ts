// The material flow: a format-4 file submitted with kind=material, pending until approved,
// published with its poster into published/materials.json, hidden, restored and purged.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker from "../src/worker.ts";
import {
  addFeaturedMarks, approveMaterial, hideMaterial, materialEntries, pendingMaterials, publishMaterial, publishMaterials, purgeMaterial, readMaterials,
  restoreMaterial, setCellPicture, setGroupPicture, setMaterialFeatured, type HiddenMaterial,
} from "../src/material-review.ts";
import { galleryEntries, pendingSubmissions } from "../src/review.ts";
import { canonicalFigureFile, readFigureMaterial } from "../../app/src/materials/material-file.ts";
import { materialKey, readMaterialIndex } from "../../app/src/features/gallery/material-index.ts";
import { TEST_TURNSTILE_TOKEN, submit, testEnv } from "./fixtures.ts";
import type { Env } from "../src/worker.ts";

const folder = new URL("../seed/materials/", import.meta.url);
const names = readdirSync(folder).filter((name) => name.endsWith(".material.json")).sort();
const text = (name: string) => readFileSync(new URL(name, folder), "utf8");
const firedName = "block-12002-figure-strongest-mean-seed-1.material.json";
const quietName = "block-13633-figure-strongest-mean-seed-0.material.json";

async function materialRequest(fields: { material?: string; title?: string; credit?: string } = {}) {
  const form = new FormData();
  form.append("kind", "material");
  form.append("material", new Blob([fields.material ?? text(firedName)], { type: "application/json" }), "material.json");
  form.append("title", fields.title ?? "Scales");
  form.append("credit", fields.credit ?? "Contributor");
  form.append("turnstileToken", TEST_TURNSTILE_TOKEN);
  const encoded = new Request("https://app.test/api/submissions", { method: "POST", body: form });
  const body = new Uint8Array(await encoded.arrayBuffer());
  return new Request("https://app.test/api/submissions", {
    method: "POST", body,
    headers: { "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length), "cf-connecting-ip": "203.0.113.9" },
  });
}
async function submitMaterial(env: Env, fields: Parameters<typeof materialRequest>[0] = {}) {
  const response = await worker.fetch(await materialRequest(fields), env);
  return { status: response.status, body: (await response.json()) as { id?: string; error?: string } };
}

describe("material submissions", () => {
  it("store a checked material file, its poster and metadata, apart from canvas submissions", async () => {
    const { env, submissions } = testEnv();
    const canvas = await submit(env);
    const material = await submitMaterial(env);
    expect([canvas.status, material.status]).toEqual([201, 201]);
    const id = material.body.id!;
    expect([...submissions.objects.keys()].filter((key) => key.startsWith(`pending/${id}/`)).sort())
      .toEqual([`pending/${id}/material.json`, `pending/${id}/meta.json`, `pending/${id}/poster.png`]);
    expect((await pendingMaterials(submissions)).map((metadata) => metadata.id)).toEqual([id]);
    expect((await pendingSubmissions(submissions)).map((metadata) => metadata.id)).toEqual([canvas.body.id]);
  });

  it("refuse shader source, another dictionary, a broken file and an overlong title", async () => {
    const { env, submissions } = testEnv();
    const file = JSON.parse(text(firedName));
    const shader = await submitMaterial(env, { material: "@compute @workgroup_size(64) fn main() {}" });
    expect(shader.status).toBe(400);
    expect(shader.body.error).toMatch(/not a valid format-4 file/);
    expect((await submitMaterial(env, { material: JSON.stringify({ ...file, dictionaryId: "other" }) })).body.error).toMatch(/another basis collection/);
    expect((await submitMaterial(env, { material: JSON.stringify({ ...file, rule: { ...file.rule, fireRate: 2 } }) })).status).toBe(400);
    expect((await submitMaterial(env, { title: "a".repeat(81) })).body.error).toMatch(/title/);
    expect(submissions.objects.size).toBe(0);
  });
  it.each(["", "   ", "a".repeat(80), "🌿".repeat(80)])("accepts an optional title within 80 Unicode characters (%j)", async (title) => {
    const { env, submissions, library } = testEnv();
    const file = JSON.parse(text(firedName));
    file.name = "Block 12002 · strongest anchor · Fine · noise · run 1 of 3 · final · 1,000 updates · continued from update 450";
    const response = await submitMaterial(env, { title, material: JSON.stringify(file) });
    expect(response.status).toBe(201);
    const metadata = (await pendingMaterials(submissions))[0];
    expect(metadata.title).toBe(title.trim());
    const entry = await approveMaterial(submissions, library, response.body.id!, new Date());
    expect(entry.title).toBe(title.trim());
    const stored = await library.get(materialKey(entry.id, "material.json"));
    expect(JSON.parse(await stored!.text()).training).toEqual(file.training);
  });

  it("rejects 81 Unicode characters and embedded control characters without storing a submission", async () => {
    for (const title of ["🌿".repeat(81), "Autumn\u0000garden"]) {
      const { env, submissions } = testEnv();
      const response = await submitMaterial(env, { title });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/title/);
      expect(submissions.objects.size).toBe(0);
    }
  });

});

describe("material review", () => {
  it("validates the poster before replacing any published object", async () => {
    const { library } = testEnv();
    const { file } = readFigureMaterial(JSON.parse(text(firedName)));
    const label = { title: file.name, credit: "Fixture" };
    await publishMaterial(library, file.id, file, label, new Date());
    const before = new Map(library.objects);
    const invalid = { ...file, preview: "data:image/png;base64,iVBORw0KGgo=" };
    await expect(publishMaterial(library, file.id, invalid, label, new Date())).rejects.toThrow();
    expect([...library.objects.keys()]).toEqual([...before.keys()]);
    for (const [key, stored] of before) expect(library.objects.get(key) === stored, key).toBe(true);
  });

  it("approves into published/materials.json with readouts taken from the file", async () => {
    const { env, submissions, library } = testEnv();
    const id = (await submitMaterial(env, { title: "Scales" })).body.id!;
    const entry = await approveMaterial(submissions, library, id, new Date("2026-10-23T03:00:00Z"));
    const file = readFigureMaterial(JSON.parse(text(firedName))).file;
    expect(entry).toMatchObject({ id, title: "Scales", block: 12002, materialId: file.id, band: "strongest", fired: true, winnerFraction: 1, tick: 600 });
    expect(library.objects.get(materialKey(id, "poster.png"))!.httpMetadata.cacheControl).toContain("immutable");
    expect(JSON.parse(new TextDecoder().decode(library.objects.get(materialKey(id, "material.json"))!.body))).toEqual(file);
    expect([...submissions.objects.keys()].some((key) => key.startsWith(`pending/${id}/`))).toBe(false);
    expect(await approveMaterial(submissions, library, id, new Date())).toEqual(entry);
    const listed = (await (await worker.fetch(new Request("https://app.test/api/materials"), env)).json()) as { entries: { id: string }[] };
    expect(listed.entries.map((shown) => shown.id)).toEqual([id]);
    const poster = await worker.fetch(new Request(`https://app.test/api/materials/${id}/poster.png`), env);
    expect([poster.status, poster.headers.get("content-type")]).toEqual([200, "image/png"]);
    expect((await worker.fetch(new Request(`https://app.test/api/materials/${id}/rule.wgsl`), env)).status).toBe(404);
  });

  it("accepts a set method's file from Train, keeps its method, layers and set, and files it in its method's column", async () => {
    const { env, submissions, library } = testEnv();
    const trained = JSON.parse(text(firedName));
    const set = { source: "selection", neighbourhood: "3x3", pictures: [{ imageId: 3536804379159069, patch: 69 }, { imageId: 12, patch: 255 }] };
    trained.recipe.settings = { ...trained.recipe.settings, method: "token-distribution", layers: ["block-3", "block-6", "block-9", "final"], set };
    const submitted = await submitMaterial(env, { material: JSON.stringify(trained) });
    expect(submitted.status).toBe(201);
    const entry = await approveMaterial(submissions, library, submitted.body.id!, new Date("2026-11-17T03:00:00Z"));
    expect(entry.gallery).toEqual({ start: "noise", method: "token-distribution" });
    expect(entry).not.toHaveProperty("loss");
    const stored = JSON.parse(new TextDecoder().decode(library.objects.get(materialKey(entry.id, "material.json"))!.body));
    expect(stored.recipe.settings).toMatchObject({ method: "token-distribution", layers: ["block-3", "block-6", "block-9", "final"], set });
    const listed = (await (await worker.fetch(new Request("https://app.test/api/materials"), env)).json()) as unknown;
    expect(readMaterialIndex(listed).entries[0]!.gallery?.method).toBe("token-distribution");
    // A set method's file without its set is refused at the boundary.
    const unset = { ...trained, recipe: { ...trained.recipe, settings: { ...trained.recipe.settings, set: undefined } } };
    const refused = await submitMaterial(env, { material: JSON.stringify(unset) });
    expect([refused.status, refused.body.error]).toEqual([400, expect.stringMatching(/target set/)]);
  });

  it("seeds project entries, marks those that did not fire, and hides, restores and purges them", async () => {
    const { env, submissions, library } = testEnv();
    const now = new Date("2026-10-23T03:00:00Z");
    for (const name of [firedName, quietName]) {
      const { file } = readFigureMaterial(JSON.parse(text(name)));
      await publishMaterial(library, file.id, file, { title: file.name, credit: "DinoDreamer project" }, now);
    }
    const shown = (await readMaterials(library)).entries;
    expect(shown.map((entry) => [entry.block, entry.fired])).toEqual([[12002, true], [13633, false]]);
    const quiet = shown[1]!.id;
    await hideMaterial(submissions, library, quiet, now);
    expect((await materialEntries(submissions, library)).hidden.map((entry) => entry.id)).toEqual([quiet]);
    expect((await galleryEntries(submissions, library)).hidden).toEqual([]);
    await restoreMaterial(submissions, library, quiet);
    expect((await readMaterials(library)).entries).toHaveLength(2);
    // Its link-preview files go with it; another material's stay.
    for (const id of [quiet, shown[0]!.id]) {
      await library.put(`previews/${id}/poster.png`, new Uint8Array([1]));
      await library.put(`previews/${id}/preview.mp4`, new Uint8Array([1]));
    }
    await purgeMaterial(submissions, library, quiet);
    expect([...library.objects.keys()].filter((key) => key.startsWith("previews/"))).toEqual([
      `previews/${shown[0]!.id}/poster.png`, `previews/${shown[0]!.id}/preview.mp4`,
    ]);
    expect((await readMaterials(library)).entries.map((entry) => entry.block)).toEqual([12002]);
    expect([...library.objects.keys()].some((key) => key.includes(`/${quiet}/`))).toBe(false);
    void env;
  });

  it("accepts every project seed file at the boundary, keeping every field it defines", () => {
    // 44 rules of E18 and E19; of stage 5 (E20), 3 seeded-centre, 6 at 2 px per cell and 11 pyramids;
    // the 108 stage-6 rules (E21).
    expect(names).toHaveLength(172);
    for (const name of names) {
      const file = readFigureMaterial(JSON.parse(text(name))).file;
      expect(canonicalFigureFile(file)).toEqual(file);
    }
  });
});

describe("production seed", () => {
  it("retains a hidden record until the index publishes its restored entry", async () => {
    const { submissions, library } = testEnv();
    const { file } = readFigureMaterial(JSON.parse(text(firedName)));
    const label = { title: file.name, credit: "Fixture" };
    const now = new Date();
    await publishMaterial(library, file.id, file, label, now);
    await hideMaterial(submissions, library, file.id, now);
    const key = `hidden/materials/${file.id}.json`;
    const hiddenBefore = await (await submissions.get(key))!.text();
    const put = library.put.bind(library);
    library.put = async (key, body, options) => {
      if (key === "published/materials.json") throw new Error("index write failed");
      return put(key, body, options);
    };
    const materials = [{ id: file.id, file, label, hidden: false, featured: false }];
    await expect(publishMaterials(submissions, library, materials, now)).rejects.toThrow("index write failed");
    expect(await (await submissions.get(key))?.text()).toBe(hiddenBefore);
    expect((await readMaterials(library)).entries).toEqual([]);
    library.put = put;
    await publishMaterials(submissions, library, materials, now);
    expect((await readMaterials(library)).entries.map((entry) => entry.id)).toEqual([file.id]);
    expect(await submissions.get(key)).toBeNull();
  });

  it("publishes many materials with one index write, keeps the hidden ones out of the index, and clears an old hide", async () => {
    const { submissions, library } = testEnv();
    const files = names.slice(0, 3).map((name) => readFigureMaterial(JSON.parse(text(name))).file);
    const [shown, hidden, restored] = files.map((file) => ({ id: file.id, file, label: { title: file.name, credit: "DinoDreamer project" } }));
    await submissions.put(`hidden/materials/${restored!.id}.json`, "{}");
    const indexWrites: string[] = [];
    const put = library.put.bind(library);
    library.put = async (key, body, options) => { if (key === "published/materials.json") indexWrites.push(key); return put(key, body, options); };
    const result = await publishMaterials(submissions, library, [
      { ...shown!, hidden: false, featured: true }, { ...hidden!, hidden: true, featured: true }, { ...restored!, hidden: false, featured: false },
    ], new Date("2026-10-26T12:00:00Z"));
    expect(result).toEqual({ shown: 2, hidden: 1 });
    expect(indexWrites).toHaveLength(1);
    expect((await readMaterials(library)).entries.map((entry) => entry.id).sort()).toEqual([shown!.id, restored!.id].sort());
    expect([...submissions.objects.keys()].filter((key) => key.startsWith("hidden/materials/"))).toEqual([`hidden/materials/${hidden!.id}.json`]);
    for (const { id } of [shown!, hidden!, restored!]) expect(library.objects.has(materialKey(id, "material.json")) && library.objects.has(materialKey(id, "poster.png"))).toBe(true);
    // The owner's featured marks travel with the seed, into the hidden record too.
    const marks = Object.fromEntries((await readMaterials(library)).entries.map((entry) => [entry.id, entry.featured]));
    expect(marks).toEqual({ [shown!.id]: true, [restored!.id]: false });
    expect((await materialEntries(submissions, library)).hidden.map((entry) => [entry.id, entry.featured])).toEqual([[hidden!.id, true]]);
  });
});

describe("featured materials", () => {
  const now = new Date("2026-10-26T21:00:00Z");
  async function seeded() {
    const fixture = testEnv();
    for (const name of [firedName, quietName]) {
      const { file } = readFigureMaterial(JSON.parse(text(name)));
      await publishMaterial(fixture.library, file.id, file, { title: file.name, credit: "DinoDreamer project" }, now);
    }
    const [fired, quiet] = (await readMaterials(fixture.library)).entries.map((entry) => entry.id);
    return { ...fixture, fired: fired!, quiet: quiet! };
  }

  it("marks a shown material with one index write, writes nothing when the mark is already as asked, and keeps the index order", async () => {
    const { submissions, library, fired, quiet } = await seeded();
    expect((await readMaterials(library)).entries.map((entry) => entry.featured)).toEqual([false, false]);
    const indexWrites: string[] = [];
    const put = library.put.bind(library);
    library.put = async (key, body, options) => { if (key === "published/materials.json") indexWrites.push(key); return put(key, body, options); };
    expect((await setMaterialFeatured(submissions, library, quiet, true)).featured).toBe(true);
    expect((await setMaterialFeatured(submissions, library, quiet, true)).featured).toBe(true);
    expect(indexWrites).toHaveLength(1);
    expect((await readMaterials(library)).entries.map((entry) => [entry.id, entry.featured])).toEqual([[fired, false], [quiet, true]]);
    expect((await setMaterialFeatured(submissions, library, quiet, false)).featured).toBe(false);
    expect(indexWrites).toHaveLength(2);
  });

  it("keeps the mark through hide, restore and a reseed, and refuses to change it on a hidden or unknown material", async () => {
    const { submissions, library, quiet } = await seeded();
    await setMaterialFeatured(submissions, library, quiet, true);
    await hideMaterial(submissions, library, quiet, now);
    await expect(setMaterialFeatured(submissions, library, quiet, false)).rejects.toThrow(/is hidden: show it first/);
    await expect(setMaterialFeatured(submissions, library, "block-1-not-published", true)).rejects.toThrow(/no published material/);
    expect((await restoreMaterial(submissions, library, quiet)).featured).toBe(true);
    const { file } = readFigureMaterial(JSON.parse(text(quietName)));
    expect((await publishMaterial(library, quiet, file, { title: file.name, credit: "DinoDreamer project" }, now)).featured).toBe(true);
  });

  it("adds featured: false to every entry and hidden record without a mark, only with write, and leaves a marked one alone", async () => {
    const { submissions, library, fired, quiet } = await seeded();
    await setMaterialFeatured(submissions, library, fired, true);
    await hideMaterial(submissions, library, quiet, now);
    // As release 2.0.0 wrote them: a hidden record and another index entry without the field.
    const hiddenKey = `hidden/materials/${quiet}.json`;
    const { featured: _featured, ...oldRecord } = JSON.parse(await (await submissions.get(hiddenKey))!.text()) as HiddenMaterial;
    const { hiddenAt: _hiddenAt, ...oldEntry } = oldRecord;
    await submissions.put(hiddenKey, JSON.stringify(oldRecord));
    const index = (await readMaterials(library)).entries;
    await library.put("published/materials.json", JSON.stringify({ entries: [...index, { ...oldEntry, id: "block-13633-older-entry" }] }));
    const marks = async () => (await readMaterials(library)).entries.map((entry) => [entry.id, entry.featured]);

    expect(await addFeaturedMarks(submissions, library, false)).toEqual({ entries: 1, hidden: 1 });
    expect(await marks()).toEqual([[fired, true], ["block-13633-older-entry", undefined]]);
    expect(await addFeaturedMarks(submissions, library, true)).toEqual({ entries: 1, hidden: 1 });
    expect(await marks()).toEqual([[fired, true], ["block-13633-older-entry", false]]);
    expect((await materialEntries(submissions, library)).hidden.map((entry) => entry.featured)).toEqual([false]);
    expect(await addFeaturedMarks(submissions, library, true)).toEqual({ entries: 0, hidden: 0 });
  });

  it("reads an index whose entries have no mark, and refuses a mark that is not true or false", () => {
    const { file } = readFigureMaterial(JSON.parse(text(firedName)));
    const entry = { id: "block-12002-x", title: file.name, credit: "", publishedAt: "", materialId: file.id, block: 12002, recipe: "figure-2026-10-23",
      band: "strongest", strength: 1, winnerFraction: 1, fired: true, side: 128, seed: 1, tick: 600, engine: "pytorch", trainerCommit: "ee76d84a",
      layout: "figure-16-96-torus-v1", start: "noise", pixelsPerCell: 1 };
    expect(readMaterialIndex({ entries: [entry] }).entries[0]!.featured).toBeUndefined();
    expect(() => readMaterialIndex({ entries: [{ ...entry, featured: "yes" }] })).toThrow(/featured mark/);
  });
});

describe("the pictures of a cell and of a basis group", () => {
  const now = new Date("2026-11-10T21:00:00Z");
  /** Three shown automata of one basis group: two that share a cell of its grid, and one in another cell. */
  async function group() {
    const fixture = testEnv();
    const { file } = readFigureMaterial(JSON.parse(text(firedName)));
    const label = { title: "", credit: "DinoDreamer project" };
    await publishMaterials(fixture.submissions, fixture.library, [
      { id: "noise-a", file, label, hidden: false, featured: false, gallery: { start: "noise", method: "basis-group-mean" } },
      { id: "noise-b", file, label, hidden: false, featured: true, gallery: { start: "noise", method: "basis-group-mean" } },
      { id: "circle-a", file, label, hidden: false, featured: false, gallery: { start: "circle", method: "token-distribution" } },
    ], now);
    const marks = async (field: "cellPicture" | "featuredInBlock" | "featured") =>
      Object.fromEntries((await readMaterials(fixture.library)).entries.map((entry) => [entry.id, entry[field] === true]));
    return { ...fixture, marks };
  }

  it("one automaton is the picture of its cell: the mark leaves the others of the cell, and another cell keeps its own", async () => {
    const { submissions, library, marks } = await group();
    expect((await setCellPicture(submissions, library, "noise-a")).map((entry) => entry.id)).toEqual(["noise-a"]);
    await setCellPicture(submissions, library, "circle-a");
    expect((await setCellPicture(submissions, library, "noise-b")).map((entry) => entry.id)).toEqual(["noise-b", "noise-a"]);
    expect(await marks("cellPicture")).toEqual({ "noise-a": false, "noise-b": true, "circle-a": true });
  });

  it("one automaton is the picture of its group, and the site's featured mark is left as it is", async () => {
    const { submissions, library, marks } = await group();
    await setGroupPicture(submissions, library, "circle-a");
    expect((await setGroupPicture(submissions, library, "noise-a")).map((entry) => entry.id)).toEqual(["noise-a", "circle-a"]);
    expect(await marks("featuredInBlock")).toEqual({ "noise-a": true, "noise-b": false, "circle-a": false });
    expect(await marks("featured")).toEqual({ "noise-a": false, "noise-b": true, "circle-a": false });
  });

  it("writes the index once, nothing when the mark is already there, and refuses a hidden or unknown automaton", async () => {
    const { submissions, library } = await group();
    const indexWrites: string[] = [];
    const put = library.put.bind(library);
    library.put = async (key, body, options) => { if (key === "published/materials.json") indexWrites.push(key); return put(key, body, options); };
    await setCellPicture(submissions, library, "noise-a");
    expect(await setCellPicture(submissions, library, "noise-a")).toEqual([]);
    expect(indexWrites).toHaveLength(1);
    await hideMaterial(submissions, library, "noise-a", now);
    await expect(setGroupPicture(submissions, library, "noise-a")).rejects.toThrow(/is hidden: show it first/);
    await expect(setCellPicture(submissions, library, "never-published")).rejects.toThrow(/no published automaton/);
  });
});

describe("owner page materials", () => {
  const ORIGIN = "http://127.0.0.1:8791";
  const neverFetch = (async () => { throw new Error("no network in this test"); }) as unknown as typeof fetch;

  it("lists, serves a pending file, approves, hides, restores and purges materials, apart from canvases", async () => {
    const { ownerRequest } = await import("../src/admin.ts");
    const fixture = testEnv();
    const env: Env = { ...fixture.env, ADMIN_LOCAL_OWNER: "yes" };
    const get = (path: string) => ownerRequest(new Request(`${ORIGIN}${path}`), env, "<html></html>", neverFetch);
    const post = async (path: string, body: unknown) => {
      const response = await ownerRequest(new Request(`${ORIGIN}${path}`, {
        method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: ORIGIN },
      }), env, "<html></html>", neverFetch);
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const lists = async () => (await (await get("/admin/api/materials")).json()) as { pending: { id: string }[]; published: { id: string }[]; hidden: { id: string }[] };
    const id = (await submitMaterial(env)).body.id!;
    expect((await lists()).pending.map((metadata) => metadata.id)).toEqual([id]);
    expect((await (await get("/admin/api/entries")).json() as { pending: unknown[] }).pending).toEqual([]);
    expect((await get(`/admin/api/materials/pending/${id}/poster.png`)).headers.get("content-type")).toBe("image/png");
    // The stored file, so the owner can play a pending material before Approve.
    const pendingFile = await get(`/admin/api/materials/pending/${id}/material.json`);
    expect([pendingFile.status, pendingFile.headers.get("content-type"), pendingFile.headers.get("cache-control")]).toEqual([200, "application/json", "private, no-store"]);
    expect(readFigureMaterial(await pendingFile.json()).file.block).toBe(12002);
    expect((await post("/admin/api/materials/approve", { id })).status).toBe(200);
    expect((await get(`/admin/api/materials/pending/${id}/material.json`)).status).toBe(404);
    expect((await lists()).published.map((entry) => entry.id)).toEqual([id]);
    expect((await get(`/admin/api/materials/gallery/${id}/poster.png`)).status).toBe(200);
    expect((await post("/admin/api/materials/hide", { id })).status).toBe(200);
    expect((await lists()).hidden.map((entry) => entry.id)).toEqual([id]);
    expect((await post("/admin/api/materials/restore", { id })).status).toBe(200);
    const featured = await post("/admin/api/materials/feature", { id });
    expect([featured.status, (featured.body.entry as { featured: boolean }).featured]).toEqual([200, true]);
    expect((await lists()).published.map((entry) => (entry as { featured?: boolean }).featured)).toEqual([true]);
    expect((await post("/admin/api/materials/hide", { id })).status).toBe(200);
    const refused = await post("/admin/api/materials/unfeature", { id });
    expect([refused.status, refused.body.error]).toEqual([409, `${id} is hidden: show it first`]);
    expect((await post("/admin/api/materials/restore", { id })).status).toBe(200);
    const cleared = await post("/admin/api/materials/unfeature", { id });
    expect([cleared.status, (cleared.body.entry as { featured: boolean }).featured]).toEqual([200, false]);
    expect((await post("/admin/api/materials/feature", { id: "../index" })).status).toBe(400);
    expect((await post("/admin/api/materials/purge", { id })).status).toBe(200);
    expect(await lists()).toEqual({ pending: [], published: [], hidden: [] });
    expect((await post("/admin/api/materials/hide", { id: "../index" })).status).toBe(400);
  });

  it("sends the earlier materials page and its panels to the owner's Automata page, for the owner only", async () => {
    const { ownerRequest } = await import("../src/admin.ts");
    const fixture = testEnv();
    for (const path of ["/admin/materials", "/admin/materials/basis/12002"]) {
      const owner = await ownerRequest(new Request(`${ORIGIN}${path}`), { ...fixture.env, ADMIN_LOCAL_OWNER: "yes" }, "<html></html>", neverFetch);
      expect([path, owner.status, owner.headers.get("location")]).toEqual([path, 302, `${ORIGIN}/admin/automata`]);
    }
    const stranger = await ownerRequest(new Request(`${ORIGIN}/admin/materials`), fixture.env, "<html></html>", neverFetch);
    expect(stranger.status).toBe(403);
    // The owner's Automata page and its panels are the app's page.
    const page = await ownerRequest(new Request(`${ORIGIN}/admin/automata/basis/12002`), { ...fixture.env, ADMIN_LOCAL_OWNER: "yes" }, "<html></html>", neverFetch);
    expect([page.status, await page.text()]).toEqual([200, "<!doctype html>"]);
    expect([page.headers.get("cache-control"), page.headers.get("content-security-policy")]).toEqual(["no-store", "frame-ancestors 'none'"]);
    expect((await ownerRequest(new Request(`${ORIGIN}/admin/automata/basis/twelve`), { ...fixture.env, ADMIN_LOCAL_OWNER: "yes" }, "<html></html>", neverFetch)).status).toBe(404);
    expect(fixture.assetRequests).toEqual(["/"]);
  });
});

describe("canonical material boundary", () => {
  const materialWithUnexpectedFields = () => {
    const file = JSON.parse(text(firedName));
    return {
      ...file, shader: "@compute fn main() {}", shaderSource: "x", wgsl: "y",
      rule: { ...file.rule, wgsl: "z" }, anchor: { ...file.anchor, shader: "w" },
      recipe: { ...file.recipe, shader: "v", settings: { ...file.recipe.settings, wgsl: "@compute ".repeat(40) } },
      reading: { ...file.reading, shaderSource: "u" },
    };
  };
  const keys = (value: unknown): string[] => value && typeof value === "object"
    ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]) : [];

  it("stores and publishes only the fields format 4 defines", async () => {
    const { env, submissions, library } = testEnv();
    const id = (await submitMaterial(env, { material: JSON.stringify(materialWithUnexpectedFields()) })).body.id!;
    const pending = JSON.parse(new TextDecoder().decode(submissions.objects.get(`pending/${id}/material.json`)!.body));
    expect(keys(pending).filter((key) => /shader|wgsl/i.test(key))).toEqual([]);
    await approveMaterial(submissions, library, id, new Date());
    const published = JSON.parse(new TextDecoder().decode(library.objects.get(materialKey(id, "material.json"))!.body));
    expect(keys(published).filter((key) => /shader|wgsl/i.test(key))).toEqual([]);
    expect(published).toEqual(readFigureMaterial(JSON.parse(text(firedName))).file);
  });

  it("refuses a form field other than the file, its labels and the human check", async () => {
    const { env, submissions } = testEnv();
    const request = await materialRequest();
    const form = await request.formData();
    form.append("shader", "@compute @workgroup_size(64) fn main() {}");
    const encoded = new Request("https://app.test/api/submissions", { method: "POST", body: form });
    const body = new Uint8Array(await encoded.arrayBuffer());
    const response = await worker.fetch(new Request("https://app.test/api/submissions", {
      method: "POST", body, headers: { "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length), "cf-connecting-ip": "203.0.113.9" },
    }), env);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/unexpected form field: shader/);
    expect(submissions.objects.size).toBe(0);
  });

  it("leaves every project seed unchanged", () => {
    for (const name of names) {
      const file = readFigureMaterial(JSON.parse(text(name))).file;
      expect(canonicalFigureFile(file)).toEqual(file);
    }
  });
});

describe("browser Grow files at the boundary", () => {
  it("keeps a /grow file's stage and run settings through submission, approval and publication", async () => {
    const grown = new URL("../../app/fixtures/materials/browser-grow/", import.meta.url);
    const name = readdirSync(grown).find((entry) => entry.endsWith(".material.json"))!;
    const file = JSON.parse(readFileSync(new URL(name, grown), "utf8"));
    file.recipe.settings = { ...file.recipe.settings, stage: "first fire" };
    const { env, submissions, library } = testEnv();
    const id = (await submitMaterial(env, { material: JSON.stringify(file) })).body.id!;
    const pending = JSON.parse(new TextDecoder().decode(submissions.objects.get(`pending/${id}/material.json`)!.body));
    expect(pending.recipe.settings.stage).toBe("first fire");
    await approveMaterial(submissions, library, id, new Date());
    const published = JSON.parse(new TextDecoder().decode(library.objects.get(materialKey(id, "material.json"))!.body));
    expect(published.recipe.settings).toEqual(file.recipe.settings);
  });
});
