import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownerRequest } from "../src/admin.ts";
import {
  checkedResearchManifest, researchRunProblems, runsToWrite, showResearchRuns, writeResearch, type ResearchRunFiles,
} from "../src/research.ts";
import { hideMaterial, readMaterials } from "../src/material-review.ts";
import { entryIdOfRun, placeOfRun, RESEARCH_MANIFEST_KEY, type ResearchManifest } from "../../app/src/features/research/research-runs.ts";
import type { Env } from "../src/worker.ts";
import type { MemoryBucket } from "./memory-bucket.ts";
import { PNG, testEnv } from "./fixtures.ts";

const RUN_ID = "block-12002-figure-strongest-mean-seed-1";
const MATERIAL = new Uint8Array(readFileSync(new URL(`../seed/materials/${RUN_ID}.material.json`, import.meta.url)));
const MATERIAL_SHA256 = createHash("sha256").update(MATERIAL).digest("hex");
const FILES: ResearchRunFiles = { material: MATERIAL, stills: new Map([[200, PNG], [600, PNG]]) };

type RunFields = { id: string; materialSha256?: string; group?: number; gallery?: unknown; siteMaterials?: string[]; review?: { site: boolean; featured: boolean } };

function manifestText(runs: RunFields[]): string {
  return JSON.stringify({
    format: 1, generatedAt: "2026-10-31T20:00:00Z", researchCommit: "0123abcd", dictionaryId: "monet-dtd-seed9-20261004-pass-003",
    studies: [{ id: "day-1", date: "2026-10-31", title: "First", question: "Does it fire?" }],
    runs: runs.map(({ id, materialSha256 = MATERIAL_SHA256, group = 12002, ...added }) => ({
      ...added,
      id, study: "day-1", group, groupName: "", start: { kind: "noise" }, loss: { kind: "plain" }, rule: "cell", seed: 1,
      schedule: { updates: 1000, pool: 64 },
      outcome: {
        releasedAtUpdate: null, requestLoss: null, centreSelected: null, naturalRouteKept: null,
        guideLossAtRelease: null, guideLossEnd: null, firesAtUpdate: 400, holds4000: true,
      },
      reading: { line: "a figure", tags: ["figure"] }, materialSha256, stills: [200, 600],
    })),
  });
}

const manifestOf = (runs: RunFields[]): ResearchManifest => checkedResearchManifest(manifestText(runs));

describe("publishing research runs", () => {
  it("checks a run's files against its row in the index", async () => {
    const [run] = manifestOf([{ id: RUN_ID }]).runs;
    expect(await researchRunProblems(run!, FILES)).toEqual([]);
    const [wrong] = manifestOf([{ id: RUN_ID, materialSha256: "0".repeat(64), group: 7178 }]).runs;
    expect(await researchRunProblems(wrong!, { material: MATERIAL, stills: new Map([[200, PNG]]) })).toEqual([
      `run ${RUN_ID}: material.json does not have the SHA-256 the index gives`,
      `run ${RUN_ID}: material.json trains basis group 12002, not 7178`,
      `run ${RUN_ID}: still-0600.png is missing or not a PNG`,
    ]);
    const [renamed] = manifestOf([{ id: "another-id" }]).runs;
    expect(await researchRunProblems(renamed!, FILES)).toEqual([`run another-id: material.json has the id ${RUN_ID}, not the run's id`]);
  });

  it("refuses an index of another basis collection", () => {
    expect(() => checkedResearchManifest(manifestText([]).replace("monet-dtd-seed9-20261004-pass-003", "another"))).toThrow("another basis collection");
  });

  it("writes only the runs the stored index lacks, and refuses a run whose file changed", () => {
    const stored = manifestOf([{ id: RUN_ID }]);
    expect(runsToWrite(null, stored).map((run) => run.id)).toEqual([RUN_ID]);
    expect(runsToWrite(stored, manifestOf([{ id: RUN_ID }, { id: "next-run" }])).map((run) => run.id)).toEqual(["next-run"]);
    expect(() => runsToWrite(stored, manifestOf([{ id: RUN_ID, materialSha256: "1".repeat(64) }]))).toThrow(`give each a new id: ${RUN_ID}`);
  });

  it("writes the run files before the index", async () => {
    const { env } = testEnv();
    const text = manifestText([{ id: RUN_ID }]);
    await writeResearch(env.SUBMISSIONS, text, checkedResearchManifest(text).runs, () => FILES);
    expect([...(env.SUBMISSIONS as MemoryBucket).objects.keys()]).toEqual([
      `research/runs/${RUN_ID}/material.json`, `research/runs/${RUN_ID}/still-0200.png`, `research/runs/${RUN_ID}/still-0600.png`, RESEARCH_MANIFEST_KEY,
    ]);
    expect((await env.LIBRARY.list({ prefix: "research/" })).objects).toEqual([]);
  });
});

describe("showing research runs on the Automata page", () => {
  const SITE_ID = "block-12002-figure-strongest-mean-seed-0";
  const PLACE = { start: "circle", method: "token-distribution", target: "group", shown: true };
  /** A store that holds the run's file in the private bucket, as the publish command leaves it. */
  async function storeWithRun(): Promise<Env> {
    const { env } = testEnv();
    const text = manifestText([{ id: RUN_ID }]);
    await writeResearch(env.SUBMISSIONS, text, checkedResearchManifest(text).runs, () => FILES);
    return env;
  }

  it("a run is on the page as the automaton that holds its rule, else under its own id", () => {
    const [onSite, fresh] = manifestOf([{ id: RUN_ID, siteMaterials: [SITE_ID] }, { id: "next-run" }]).runs;
    expect([entryIdOfRun(onSite!), entryIdOfRun(fresh!)]).toEqual([SITE_ID, "next-run"]);
  });

  it("publishes a run with its place in the grid and the review's mark, under the project's credit and without a title", async () => {
    const env = await storeWithRun();
    const [run] = manifestOf([{ id: RUN_ID, gallery: PLACE, review: { site: true, featured: true } }]).runs;
    const result = await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, [run!], new Date("2026-11-10T20:00:00Z"), true);
    expect(result).toEqual({ published: [RUN_ID], placed: [], keptHidden: [], withoutPlace: [] });
    const [entry] = (await readMaterials(env.LIBRARY)).entries;
    expect(entry).toMatchObject({
      id: RUN_ID, materialId: RUN_ID, title: "", credit: "DinoDreamer project", block: 12002,
      gallery: { start: "circle", method: "token-distribution" }, featuredInBlock: true, featured: false,
    });
    expect((env.LIBRARY as MemoryBucket).objects.has(`gallery/materials/${RUN_ID}/poster.png`)).toBe(true);
  });

  it("a dry run writes nothing and answers what it would do", async () => {
    const env = await storeWithRun();
    const [run] = manifestOf([{ id: RUN_ID, gallery: PLACE }]).runs;
    const before = [...(env.LIBRARY as MemoryBucket).objects.keys()];
    expect((await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, [run!], new Date(), false)).published).toEqual([RUN_ID]);
    expect([...(env.LIBRARY as MemoryBucket).objects.keys()]).toEqual(before);
  });

  it("gives a shown automaton its place without touching its file, and a second time changes nothing", async () => {
    const env = await storeWithRun();
    const [first] = manifestOf([{ id: RUN_ID, gallery: { ...PLACE, start: "noise" } }]).runs;
    await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, [first!], new Date(), true);
    const library = env.LIBRARY as MemoryBucket;
    const fileBefore = library.objects.get(`gallery/materials/${RUN_ID}/material.json`);
    const [moved] = manifestOf([{ id: RUN_ID, gallery: PLACE }]).runs;
    const result = await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, [moved!], new Date(), true);
    expect(result).toEqual({ published: [], placed: [RUN_ID], keptHidden: [], withoutPlace: [] });
    expect((await readMaterials(env.LIBRARY)).entries[0]!.gallery).toEqual({ start: "circle", method: "token-distribution" });
    expect(library.objects.get(`gallery/materials/${RUN_ID}/material.json`)).toBe(fileBefore);
  });

  it("leaves a hidden automaton hidden, and does not publish a run the grid has no place for", async () => {
    const env = await storeWithRun();
    const runs = manifestOf([{ id: RUN_ID, gallery: PLACE }, { id: "no-row", gallery: { ...PLACE, start: null } }, { id: "old-export" }]).runs;
    await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, [runs[0]!], new Date(), true);
    await hideMaterial(env.SUBMISSIONS, env.LIBRARY, RUN_ID, new Date());
    const result = await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, runs, new Date(), true);
    expect(result).toEqual({ published: [], placed: [], keptHidden: [RUN_ID], withoutPlace: ["no-row", "old-export"] });
    expect((await readMaterials(env.LIBRARY)).entries).toEqual([]);
    expect([placeOfRun(runs[1]!), placeOfRun(runs[2]!)]).toEqual([null, null]);
  });
});

describe("owner API: the research page", () => {
  const ORIGIN = "http://127.0.0.1:8791";
  const neverFetch = (async () => {
    throw new Error("no network in this test");
  }) as unknown as typeof fetch;

  async function ownerSetup(published = true) {
    const fixture = testEnv();
    const env: Env = { ...fixture.env, ADMIN_LOCAL_OWNER: "yes" };
    if (published) {
      const text = manifestText([{ id: RUN_ID }]);
      await writeResearch(env.SUBMISSIONS, text, checkedResearchManifest(text).runs, () => FILES);
    }
    const get = (path: string) => ownerRequest(new Request(`${ORIGIN}${path}`), env, "<!doctype html>", neverFetch);
    const post = async (path: string, body: unknown) => {
      const request = new Request(`${ORIGIN}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: ORIGIN } });
      const response = await ownerRequest(request, env, "<!doctype html>", neverFetch);
      return { status: response.status, body: (await response.json()) as Record<string, unknown> & { error?: string } };
    };
    return { env, get, post };
  }

  it("serves the app's page for the research views", async () => {
    const { get } = await ownerSetup();
    for (const path of ["/admin/research", "/admin/research/group/12002", "/admin/research/group/none", `/admin/research/run/${RUN_ID}`]) {
      const answer = await get(path);
      expect([path, answer.status, answer.headers.get("content-type")]).toEqual([path, 200, "text/html; charset=utf-8"]);
    }
    expect((await get("/admin/research/run/Not-An-Id")).status).toBe(404);
  });

  it("reads the index, a run's file and its stills from the private bucket", async () => {
    const { get } = await ownerSetup();
    const manifest = await get("/admin/api/research/manifest.json");
    expect(manifest.headers.get("cache-control")).toBe("private, no-store");
    expect(((await manifest.json()) as ResearchManifest).runs.map((run) => run.id)).toEqual([RUN_ID]);
    expect(new Uint8Array(await (await get(`/admin/api/research/runs/${RUN_ID}/material.json`)).arrayBuffer())).toEqual(MATERIAL);
    const still = await get(`/admin/api/research/runs/${RUN_ID}/still-0600.png`);
    expect([still.status, still.headers.get("content-type")]).toEqual([200, "image/png"]);
    expect((await get(`/admin/api/research/runs/${RUN_ID}/still-0400.png`)).status).toBe(404);
    expect((await (await ownerSetup(false)).get("/admin/api/research/manifest.json")).status).toBe(404);
  });

  it("promotes a run to a pending material that Approve publishes", async () => {
    const { get, post } = await ownerSetup();
    const promoted = await post("/admin/api/research/promote", { id: RUN_ID, title: "  Collar of light " });
    expect(promoted.status).toBe(200);
    const pending = promoted.body.pending as { id: string; title: string; credit: string; materialId: string };
    expect([pending.title, pending.credit, pending.materialId]).toEqual(["Collar of light", "DinoDreamer project", RUN_ID]);
    const listed = (await (await get("/admin/api/materials")).json()) as { pending: { id: string }[]; published: { id: string }[] };
    expect(listed.pending.map((submission) => submission.id)).toEqual([pending.id]);
    expect(listed.published).toEqual([]);
    const approved = await post("/admin/api/materials/approve", { id: pending.id });
    expect((approved.body.entry as { title: string; materialId: string })).toMatchObject({ title: "Collar of light", materialId: RUN_ID });
  });

  it("shows a run from the owner's view: it becomes a published automaton with its place, and the page gets its entry", async () => {
    const env = { ...testEnv().env, ADMIN_LOCAL_OWNER: "yes" } as Env;
    const text = manifestText([{ id: RUN_ID, gallery: { start: "circle-on-noise", method: "token-distribution", target: "group", shown: false } }]);
    await writeResearch(env.SUBMISSIONS, text, checkedResearchManifest(text).runs, () => FILES);
    const show = (ids: unknown) => ownerRequest(new Request(`${ORIGIN}/admin/api/research/show`, {
      method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ ids }),
    }), env, "<!doctype html>", neverFetch);
    const answered = await show([RUN_ID]);
    const body = (await answered.json()) as { result: { published: string[] }; entries: { id: string; gallery: unknown }[] };
    expect(answered.status).toBe(200);
    expect(body.result.published).toEqual([RUN_ID]);
    expect(body.entries).toEqual([expect.objectContaining({ id: RUN_ID, gallery: { start: "circle-on-noise", method: "token-distribution" } })]);
    expect((await readMaterials(env.LIBRARY)).entries.map((entry) => entry.id)).toEqual([RUN_ID]);
    const unknown = await show(["no-such-run"]);
    expect([unknown.status, ((await unknown.json()) as { error: string }).error]).toEqual([409, "no research run no-such-run"]);
    expect((await show([])).status).toBe(400);
    expect((await show(["Not An Id"])).status).toBe(400);
  });

  it("refuses a promotion without a title, of an unknown run or with a malformed id", async () => {
    const { post } = await ownerSetup();
    expect((await post("/admin/api/research/promote", { id: RUN_ID, title: "   " })).status).toBe(409);
    expect((await post("/admin/api/research/promote", { id: "no-such-run", title: "A title" })).status).toBe(409);
    expect((await post("/admin/api/research/promote", { id: "../pending", title: "A title" })).status).toBe(400);
  });
});
