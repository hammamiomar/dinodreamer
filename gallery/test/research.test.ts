import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownerRequest } from "../src/admin.ts";
import {
  changedRuns, checkedResearchManifest, republishRereadRuns, rereadProblem, rereadProblems, researchRunProblems, runsToWrite,
  showResearchRuns, writeResearch, type ResearchRunFiles,
} from "../src/research.ts";
import { approveMaterial, checkedMaterial, hideMaterial, materialPoster, readMaterials, storeMaterialSubmission } from "../src/material-review.ts";
import { entryIdOfRun, placeOfRun, RESEARCH_MANIFEST_KEY, type ResearchManifest } from "../../app/src/features/research/research-runs.ts";
import type { Env } from "../src/worker.ts";
import type { MemoryBucket } from "./memory-bucket.ts";
import { PNG, testEnv } from "./fixtures.ts";

const RUN_ID = "block-12002-figure-strongest-mean-seed-1";
const MATERIAL = new Uint8Array(readFileSync(new URL(`../seed/materials/${RUN_ID}.material.json`, import.meta.url)));
const MATERIAL_SHA256 = createHash("sha256").update(MATERIAL).digest("hex");
const FILES: ResearchRunFiles = { material: MATERIAL, stills: new Map([[200, PNG], [600, PNG]]) };

/** The same automaton read again at step 300: its reading differs, and nothing else. */
const REREAD = (() => {
  const file = JSON.parse(new TextDecoder().decode(MATERIAL));
  file.reading = { ...file.reading, tick: 300, strength: 2.5, winnerFraction: 1 };
  return new TextEncoder().encode(JSON.stringify(file));
})();
const REREAD_SHA256 = createHash("sha256").update(REREAD).digest("hex");
const REREAD_FILES: ResearchRunFiles = { material: REREAD, stills: FILES.stills };

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
    expect(() => runsToWrite(stored, manifestOf([{ id: RUN_ID, materialSha256: "1".repeat(64) }]))).toThrow(RUN_ID);
  });

  it("with --reread a changed run is not refused: it is one of the changed runs, and not a new one", () => {
    const stored = manifestOf([{ id: RUN_ID }]);
    const next = manifestOf([{ id: RUN_ID, materialSha256: REREAD_SHA256 }, { id: "next-run" }]);
    expect(runsToWrite(stored, next, true).map((run) => run.id)).toEqual(["next-run"]);
    expect(changedRuns(stored, next).map((run) => run.id)).toEqual([RUN_ID]);
    expect(changedRuns(stored, stored)).toEqual([]);
  });

  it("a file may replace the stored one when only its reading and its preview differ", async () => {
    const text = new TextDecoder().decode(MATERIAL);
    expect(rereadProblem(text, new TextDecoder().decode(REREAD))).toBeNull();
    const retrained = JSON.parse(text);
    retrained.rule.fireRate = 0.25;
    retrained.training.updates = 7;
    expect(rereadProblem(text, JSON.stringify(retrained))).toBe("its file differs in training, rule, more than its reading and preview");
    const { env } = testEnv();
    const stored = manifestText([{ id: RUN_ID }]);
    await writeResearch(env.SUBMISSIONS, stored, checkedResearchManifest(stored).runs, () => FILES);
    const [run] = manifestOf([{ id: RUN_ID, materialSha256: REREAD_SHA256 }]).runs;
    expect(await rereadProblems(env.SUBMISSIONS, [run!], () => REREAD_FILES)).toEqual([]);
    const wrong = { material: new TextEncoder().encode(JSON.stringify(retrained)), stills: FILES.stills };
    expect(await rereadProblems(env.SUBMISSIONS, [run!], () => wrong)).toEqual([`run ${RUN_ID}: its file differs in training, rule, more than its reading and preview`]);
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

  it("a run that an earlier promotion published under a submission's id takes its place there and is not published twice", async () => {
    const env = await storeWithRun();
    // An earlier owner page promoted a run: its file stored as a pending material with a title, then approved.
    const checked = checkedMaterial(new TextDecoder().decode(MATERIAL));
    if ("error" in checked) throw new Error(checked.error);
    const promotion = { file: checked.file, text: JSON.stringify(checked.file), poster: materialPoster(checked.file), title: "Scales", credit: "DinoDreamer project" };
    const pending = await storeMaterialSubmission(env.SUBMISSIONS, "20261102-153012-01020304", promotion, new Date("2026-11-02T15:30:12Z"));
    await approveMaterial(env.SUBMISSIONS, env.LIBRARY, pending.id, new Date("2026-11-02T15:31:00Z"));
    const [run] = manifestOf([{ id: RUN_ID, gallery: PLACE }]).runs;
    const result = await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, [run!], new Date(), true);
    expect(result).toEqual({ published: [], placed: [pending.id], keptHidden: [], withoutPlace: [] });
    expect((await readMaterials(env.LIBRARY)).entries.map((entry) => [entry.id, entry.gallery])).toEqual([[pending.id, { start: "circle", method: "token-distribution" }]]);
  });

  /** A visitor's own automaton, approved, whose file claims the run's id: other weights, the same top-level id. */
  async function approveClaimant(env: Env): Promise<string> {
    const visitorFile = JSON.parse(readFileSync(new URL("../seed/materials/block-12002-figure-weak-seed-0.material.json", import.meta.url), "utf8"));
    const checked = checkedMaterial(JSON.stringify({ ...visitorFile, id: RUN_ID }));
    if ("error" in checked) throw new Error(checked.error);
    const claim = { file: checked.file, text: JSON.stringify(checked.file), poster: materialPoster(checked.file), title: "Mine now", credit: "A visitor" };
    const pending = await storeMaterialSubmission(env.SUBMISSIONS, "20261118-221005-8afe5fcd", claim, new Date("2026-11-18T22:10:05Z"));
    await approveMaterial(env.SUBMISSIONS, env.LIBRARY, pending.id, new Date("2026-11-18T22:11:00Z"));
    return pending.id;
  }

  it("a visitor's automaton whose file claims an unshown run's id stays the visitor's: Show publishes the run under its own id", async () => {
    const env = await storeWithRun();
    const visitor = await approveClaimant(env);
    const [run] = manifestOf([{ id: RUN_ID, gallery: PLACE }]).runs;
    const result = await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, [run!], new Date(), true);
    expect(result).toEqual({ published: [RUN_ID], placed: [], keptHidden: [], withoutPlace: [] });
    const entries = (await readMaterials(env.LIBRARY)).entries;
    expect(entries.map((entry) => [entry.id, entry.credit, entry.gallery ?? null])).toEqual([
      [RUN_ID, "DinoDreamer project", { start: "circle", method: "token-distribution" }], [visitor, "A visitor", null],
    ]);
  });

  it("keeps a hidden run hidden when a visitor's copy claims its id, and refuses to approve that copy", async () => {
    const env = await storeWithRun();
    const [run] = manifestOf([{ id: RUN_ID, gallery: PLACE }]).runs;
    await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, [run!], new Date(), true);
    await hideMaterial(env.SUBMISSIONS, env.LIBRARY, RUN_ID, new Date());
    // The hidden run's public file stays readable; a copy of it claims the run's id and has the run's rule.
    const copy = checkedMaterial(new TextDecoder().decode(MATERIAL));
    if ("error" in copy) throw new Error(copy.error);
    const pending = await storeMaterialSubmission(env.SUBMISSIONS, "20261118-221006-01020304",
      { file: copy.file, text: JSON.stringify(copy.file), poster: materialPoster(copy.file), title: "Copy", credit: "A visitor" }, new Date());
    await expect(approveMaterial(env.SUBMISSIONS, env.LIBRARY, pending.id, new Date())).rejects.toThrow(`the hidden automaton ${RUN_ID} already has the file id ${RUN_ID}`);
    expect(await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, [run!], new Date(), true)).toEqual({ published: [], placed: [], keptHidden: [RUN_ID], withoutPlace: [] });
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

describe("a run read again at another step", () => {
  const PLACE = { start: "circle", method: "token-distribution", target: "group", shown: true };
  /** A store where the run is a shown automaton, and its re-read file has then replaced the stored one. */
  async function storeWithRereadRun(): Promise<{ env: Env; run: ReturnType<typeof manifestOf>["runs"][number] }> {
    const { env } = testEnv();
    const first = manifestText([{ id: RUN_ID, gallery: PLACE, review: { site: true, featured: true } }]);
    await writeResearch(env.SUBMISSIONS, first, checkedResearchManifest(first).runs, () => FILES);
    await showResearchRuns(env.SUBMISSIONS, env.LIBRARY, checkedResearchManifest(first).runs, new Date("2026-11-10T20:00:00Z"), true);
    const next = manifestText([{ id: RUN_ID, materialSha256: REREAD_SHA256, gallery: PLACE, review: { site: true, featured: true } }]);
    const [run] = checkedResearchManifest(next).runs;
    await writeResearch(env.SUBMISSIONS, next, [run!], () => REREAD_FILES);
    return { env, run: run! };
  }

  it("the shown automaton takes the new reading, and keeps its label, its time, its marks and its place", async () => {
    const { env, run } = await storeWithRereadRun();
    const [before] = (await readMaterials(env.LIBRARY)).entries;
    expect(before).toMatchObject({ tick: 600, publishedAt: "2026-11-10T20:00:00.000Z" });
    expect(await republishRereadRuns(env.SUBMISSIONS, env.LIBRARY, [run])).toEqual({ shown: [RUN_ID], hidden: [], absent: [] });
    const [after] = (await readMaterials(env.LIBRARY)).entries;
    expect(after).toEqual({ ...before, tick: 300, strength: 2.5, winnerFraction: 1, fired: true });
    const published = JSON.parse(await (await env.LIBRARY.get(`gallery/materials/${RUN_ID}/material.json`))!.text());
    expect(published.reading.tick).toBe(300);
  });

  it("a hidden automaton's file and recovery record take it, so a restore shows the new reading", async () => {
    const { env, run } = await storeWithRereadRun();
    await hideMaterial(env.SUBMISSIONS, env.LIBRARY, RUN_ID, new Date("2026-11-12T10:00:00Z"));
    expect(await republishRereadRuns(env.SUBMISSIONS, env.LIBRARY, [run])).toEqual({ shown: [], hidden: [RUN_ID], absent: [] });
    expect((await readMaterials(env.LIBRARY)).entries).toEqual([]);
    const record = JSON.parse(await (await env.SUBMISSIONS.get(`hidden/materials/${RUN_ID}.json`))!.text());
    expect(record).toMatchObject({ tick: 300, hiddenAt: "2026-11-12T10:00:00.000Z", gallery: { start: "circle", method: "token-distribution" }, featuredInBlock: true });
  });

  it("writes nothing over a visitor's automaton that claims the run's id, when the run is not on the page", async () => {
    const { env } = testEnv();
    const first = manifestText([{ id: RUN_ID }]);
    await writeResearch(env.SUBMISSIONS, first, checkedResearchManifest(first).runs, () => FILES);
    const visitorFile = JSON.parse(readFileSync(new URL("../seed/materials/block-12002-figure-weak-seed-0.material.json", import.meta.url), "utf8"));
    const checked = checkedMaterial(JSON.stringify({ ...visitorFile, id: RUN_ID }));
    if ("error" in checked) throw new Error(checked.error);
    const pending = await storeMaterialSubmission(env.SUBMISSIONS, "20261118-221005-8afe5fcd",
      { file: checked.file, text: JSON.stringify(checked.file), poster: materialPoster(checked.file), title: "Mine now", credit: "A visitor" }, new Date());
    await approveMaterial(env.SUBMISSIONS, env.LIBRARY, pending.id, new Date());
    const visitorObject = (env.LIBRARY as MemoryBucket).objects.get(`gallery/materials/${pending.id}/material.json`);
    const next = manifestText([{ id: RUN_ID, materialSha256: REREAD_SHA256 }]);
    const [run] = checkedResearchManifest(next).runs;
    await writeResearch(env.SUBMISSIONS, next, [run!], () => REREAD_FILES);
    expect(await republishRereadRuns(env.SUBMISSIONS, env.LIBRARY, [run!])).toEqual({ shown: [], hidden: [], absent: [RUN_ID] });
    expect((env.LIBRARY as MemoryBucket).objects.get(`gallery/materials/${pending.id}/material.json`)).toBe(visitorObject);
  });

  it("a run that is not on the page changes nothing there", async () => {
    const { env } = testEnv();
    const next = manifestText([{ id: RUN_ID, materialSha256: REREAD_SHA256 }]);
    const [run] = checkedResearchManifest(next).runs;
    await writeResearch(env.SUBMISSIONS, next, [run!], () => REREAD_FILES);
    const before = [...(env.LIBRARY as MemoryBucket).objects.keys()];
    expect(await republishRereadRuns(env.SUBMISSIONS, env.LIBRARY, [run!])).toEqual({ shown: [], hidden: [], absent: [RUN_ID] });
    expect([...(env.LIBRARY as MemoryBucket).objects.keys()]).toEqual(before);
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

  it("sends the earlier research page's addresses to the owner's Automata page", async () => {
    const { get } = await ownerSetup();
    for (const path of ["/admin/research", "/admin/research/group/12002", "/admin/research/group/none", `/admin/research/run/${RUN_ID}`]) {
      const answer = await get(path);
      expect([path, answer.status, answer.headers.get("location")]).toEqual([path, 302, `${ORIGIN}/admin/automata`]);
    }
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
});
