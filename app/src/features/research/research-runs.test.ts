import { describe, expect, it } from "vitest";
import { definitionRule, promotedRunEntries, readResearchManifest, researchRunKey, stillName, type DefinitionRule, type ResearchOutcome } from "./research-runs";

const NO_OUTCOME: ResearchOutcome = {
  releasedAtUpdate: null, requestLoss: null, centreSelected: null, naturalRouteKept: null,
  guideLossAtRelease: null, guideLossEnd: null, firesAtUpdate: null, holds4000: null,
};

function run(id: string, fields: Record<string, unknown> = {}) {
  return {
    id, study: "day-2", group: 7178, groupName: "", start: { kind: "noise" }, loss: { kind: "plain" }, rule: "cell", seed: 0,
    schedule: { updates: 1000, pool: 64 }, outcome: NO_OUTCOME, reading: { line: "", tags: [] }, materialSha256: "a".repeat(64),
    stills: [200, 600], ...fields,
  };
}

function manifest(runs: unknown[]) {
  return {
    format: 1, generatedAt: "2026-10-31T20:00:00Z", researchCommit: "0123abcd", dictionaryId: "monet-dtd-seed9-20261004-pass-003",
    studies: [
      { id: "day-1", date: "2026-10-30", title: "First", question: "Does it fire?" },
      { id: "day-2", date: "2026-10-31", title: "Second", question: "Does it hold?" },
    ],
    runs,
  };
}

describe("a run's gallery fields", () => {
  it("reads the run's place, its target, the default choice, its role and the automata that hold its rule", () => {
    const [read] = readResearchManifest(manifest([run("r-1", {
      gallery: { start: "circle-on-noise", method: "token-distribution", target: "group", shown: true },
      role: "settings-sweep",
      siteMaterials: ["block-7178-figure-strongest-mean-seed-0"],
    })])).runs;
    expect(read!.gallery).toEqual({ start: "circle-on-noise", method: "token-distribution", target: "group", shown: true });
    expect(read!.role).toBe("settings-sweep");
    expect(read!.siteMaterials).toEqual(["block-7178-figure-strongest-mean-seed-0"]);
  });

  it("an export from before the fields has no place, no role and no automaton on the site", () => {
    const [read] = readResearchManifest(manifest([run("r-1")])).runs;
    expect([read!.gallery, read!.role, read!.siteMaterials]).toEqual([null, null, []]);
  });

  it("a start outside the grid is null, and an unknown start, method or target is refused", () => {
    const place = { start: null, method: "basis-group-mean", target: "other", shown: false };
    expect(readResearchManifest(manifest([run("r-1", { gallery: place })])).runs[0]!.gallery).toEqual(place);
    expect(() => readResearchManifest(manifest([run("r-1", { gallery: { ...place, start: "a picture" } })]))).toThrow("run r-1.gallery.start");
    expect(() => readResearchManifest(manifest([run("r-1", { gallery: { ...place, method: "plain" } })]))).toThrow("run r-1.gallery.method");
    expect(() => readResearchManifest(manifest([run("r-1", { gallery: { ...place, target: "level" } })]))).toThrow("run r-1.gallery.target");
    expect(() => readResearchManifest(manifest([run("r-1", { role: "pilot" })]))).toThrow("run r-1.role");
  });
});

describe("readResearchManifest", () => {
  it("reads every field of a run", () => {
    const read = readResearchManifest(manifest([run("r-1", {
      groupName: "fireworks",
      start: { kind: "centre-disc", radius: 16, backgroundAmplitude: 0.25 },
      loss: { kind: "guided", ratio: 0.5, releaseFraction: 0.4, zFloor: 1.2, units: "median norm" },
      outcome: { ...NO_OUTCOME, centreSelected: { count: 11, of: 16 }, firesAtUpdate: 412, holds4000: true },
      reading: { line: "a figure that holds", tags: ["figure"] },
    })]));
    expect(read.runs[0]).toMatchObject({
      groupName: "fireworks",
      start: { kind: "centre-disc", radius: 16, backgroundAmplitude: 0.25 },
      loss: {
        kind: "guided", ratio: 0.5, weightCap: null, releaseFraction: 0.4, releaseAtUpdate: null,
        releaseFloor: null, reEngage: null, reEngageAt: null, zFloor: 1.2, units: "median norm",
      },
      outcome: { centreSelected: { count: 11, of: 16 }, firesAtUpdate: 412, holds4000: true },
    });
  });

  it("reads an early guide held to a fixed update with a capped weight, and a floor that re-engages", () => {
    const read = readResearchManifest(manifest([
      run("pilot", { loss: { kind: "guided", weightCap: 0.1, releaseAtUpdate: 750 } }),
      run("floor", { loss: { kind: "guided", ratio: 3, releaseFraction: 0.4, releaseFloor: 1, reEngage: true, reEngageAt: 0.5, units: "73 DINO units" } }),
    ]));
    expect(read.runs[0]!.loss).toEqual({
      kind: "guided", ratio: null, weightCap: 0.1, releaseFraction: null, releaseAtUpdate: 750, releaseFloor: null, reEngage: null, reEngageAt: null,
      zFloor: null, units: "",
    });
    expect(read.runs[1]!.loss).toMatchObject({ releaseFloor: 1, reEngage: true, reEngageAt: 0.5, units: "73 DINO units" });
    expect(() => readResearchManifest(manifest([run("bad", { loss: { kind: "guided", releaseAtUpdate: 7.5 } })]))).toThrow("run bad.loss.releaseAtUpdate");
  });

  it("reads the owner's review, none when the export has none, and refuses a featured run off the site list", () => {
    const read = readResearchManifest(manifest([
      run("r-1", { review: { site: true, featured: true } }),
      run("r-2", { review: { site: true, featured: false } }),
      run("r-3"),
    ]));
    expect(read.runs.map((candidate) => candidate.review)).toEqual([{ site: true, featured: true }, { site: true, featured: false }, { site: false, featured: false }]);
    expect(() => readResearchManifest(manifest([run("bad", { review: { site: false, featured: true } })]))).toThrow("run bad.review.featured");
    expect(() => readResearchManifest(manifest([run("bad", { review: { site: "yes", featured: false } })]))).toThrow("run bad.review.site");
  });

  it("names the run and the field it refuses", () => {
    expect(() => readResearchManifest(manifest([run("r-1", { study: "day-9" })]))).toThrow("run r-1.study: names no study in the manifest: day-9");
    expect(() => readResearchManifest(manifest([run("R 1")]))).toThrow("runs[0].id");
    expect(() => readResearchManifest(manifest([run("r-1"), run("r-1")]))).toThrow("runs: repeat an id");
    expect(() => readResearchManifest(manifest([run("r-1", { start: { kind: "centre-disc", radius: 16, backgroundAmplitude: 2 } })])))
      .toThrow("run r-1.start.backgroundAmplitude");
    expect(() => readResearchManifest(manifest([run("r-1", { outcome: { ...NO_OUTCOME, centreSelected: { count: 17, of: 16 } } })])))
      .toThrow("run r-1.outcome.centreSelected.count");
    expect(() => readResearchManifest(manifest([run("r-1", { stills: [600, 200] })]))).toThrow("run r-1.stills");
    expect(() => readResearchManifest(manifest([run("r-1", { reading: { line: "", tags: ["Colour only"] } })]))).toThrow("run r-1.reading.tags[0]");
  });
});

describe("a run's files", () => {
  it("names a run's files", () => {
    expect(researchRunKey("r-1", "material.json")).toBe("research/runs/r-1/material.json");
    expect(researchRunKey("r-1", stillName(200))).toBe("research/runs/r-1/still-0200.png");
  });
});

describe("the run an earlier promotion published under a submission's id", () => {
  const runs = readResearchManifest(manifest([run("7178-private-run"), run("7178-shown-run"), run("7178-on-site", { siteMaterials: ["block-7178-site"] })])).runs;
  const rule = (values: string): DefinitionRule => ({ layout: "figure-cell-12-96-v1", values });
  const reader = (rules: Record<string, DefinitionRule>) => {
    const asked: string[] = [];
    return { asked, read: async (id: string) => { asked.push(id); return rules[id] ?? null; } };
  };

  it("links a run to an entry under another id only when the entry's published rule is the run's", async () => {
    const runRules = reader({ "7178-private-run": rule("RUN") });
    const entryRules = reader({ "20261102-153012-a1b2c3d4": rule("RUN"), "20261118-221005-8afe5fcd": rule("VISITOR") });
    const promoted = await promotedRunEntries(runs, [
      { id: "20261118-221005-8afe5fcd", materialId: "7178-private-run" },
      { id: "20261102-153012-a1b2c3d4", materialId: "7178-private-run" },
    ], runRules.read, entryRules.read);
    expect([...promoted]).toEqual([["7178-private-run", "20261102-153012-a1b2c3d4"]]);
  });

  it("never links a file that only claims the run's id, and reads nothing for a run with an entry of its own", async () => {
    const runRules = reader({ "7178-private-run": rule("RUN"), "7178-shown-run": rule("SHOWN") });
    const entryRules = reader({ "20261118-221005-8afe5fcd": rule("VISITOR"), "20261118-221006-01020304": rule("SHOWN") });
    const promoted = await promotedRunEntries(runs, [
      { id: "20261118-221005-8afe5fcd", materialId: "7178-private-run" },
      { id: "7178-shown-run", materialId: "7178-shown-run" },
      { id: "20261118-221006-01020304", materialId: "7178-shown-run" },
      { id: "block-7178-site", materialId: "block-7178-site" },
    ], runRules.read, entryRules.read);
    expect(promoted.size).toBe(0);
    expect(runRules.asked).toEqual(["7178-private-run"]);
    expect(entryRules.asked).toEqual(["20261118-221005-8afe5fcd"]);
  });

  it("reads a rule from a definition's JSON, and nothing from JSON without one", () => {
    expect(definitionRule({ rule: { layout: "figure-cell-12-96-v1", values: "AAAA", fireRate: 0.5 } })).toEqual(rule("AAAA"));
    expect([definitionRule(null), definitionRule({}), definitionRule({ rule: { layout: 1, values: "AAAA" } })]).toEqual([null, null, null]);
  });
});
