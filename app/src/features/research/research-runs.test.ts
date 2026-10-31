import { describe, expect, it } from "vitest";
import {
  conditionKey, conditionOf, CONDITIONS, filterSearch, groupRuns, groupSegment, outcomeClass, readFilter, readResearchManifest,
  researchRunKey, startClass, stillName, tagsInUse, type ResearchOutcome,
} from "./research-runs";

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
      loss: { kind: "guided", ratio: 0.5, releaseFraction: 0.4, zFloor: 1.2, units: "median norm" },
      outcome: { centreSelected: { count: 11, of: 16 }, firesAtUpdate: 412, holds4000: true },
    });
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

describe("the arrangement", () => {
  it("names a run's files", () => {
    expect(researchRunKey("r-1", "material.json")).toBe("research/runs/r-1/material.json");
    expect(researchRunKey("r-1", stillName(200))).toBe("research/runs/r-1/still-0200.png");
  });

  it("tells a centre disc from a seeded field by its background", () => {
    expect(startClass({ kind: "noise" })).toBe("noise");
    expect(startClass({ kind: "centre-disc", radius: 16 })).toBe("centre-disc");
    expect(startClass({ kind: "centre-disc", radius: 16, backgroundAmplitude: 0 })).toBe("centre-disc");
    expect(startClass({ kind: "centre-disc", radius: 16, backgroundAmplitude: 0.25 })).toBe("seeded-field");
  });

  it("orders twelve conditions by start, loss and rule", () => {
    expect(CONDITIONS).toHaveLength(24);
    expect(CONDITIONS.slice(0, 4).map(conditionKey)).toEqual(["noise/plain/cell", "noise/plain/pyramid", "noise/guided/cell", "noise/guided/pyramid"]);
    const read = readResearchManifest(manifest([run("r-1", { rule: "pyramid", loss: { kind: "guided", ratio: 1, releaseFraction: 0.5, zFloor: 0, units: "m" } })]));
    expect(conditionKey(conditionOf(read.runs[0]!))).toBe("noise/guided/pyramid");
  });

  it("classes an outcome by firing and holding", () => {
    expect(outcomeClass(NO_OUTCOME)).toBe("never-fired");
    expect(outcomeClass({ ...NO_OUTCOME, firesAtUpdate: 300 })).toBe("fired");
    expect(outcomeClass({ ...NO_OUTCOME, firesAtUpdate: 300, holds4000: false })).toBe("fired");
    expect(outcomeClass({ ...NO_OUTCOME, firesAtUpdate: 300, holds4000: true })).toBe("holds");
  });

  it("reads and writes the filter in the address", () => {
    const filter = readFilter(new URLSearchParams("study=day-1,day-2&tag=texture&outcome=holds,unknown"));
    expect(filter).toEqual({ studies: ["day-1", "day-2"], tags: ["texture"], outcomes: ["holds"] });
    expect(filterSearch(filter)).toBe("?study=day-1,day-2&tag=texture&outcome=holds");
    expect(filterSearch({ studies: [], tags: [], outcomes: [] })).toBe("");
  });

  it("puts each group's filtered runs in rows, newest study first", () => {
    const read = readResearchManifest(manifest([
      run("old", { study: "day-1", seed: 0 }),
      run("new-1", { seed: 1, reading: { line: "", tags: ["texture"] } }),
      run("new-0", { seed: 0, groupName: "fireworks", reading: { line: "", tags: ["figure"] } }),
      run("other", { group: 12, rule: "pyramid" }),
    ]));
    const rows = groupRuns(read, { studies: [], tags: [], outcomes: [] });
    expect(rows.map((row) => row.group)).toEqual([12, 7178]);
    expect(rows[1]!.name).toBe("fireworks");
    expect(rows[1]!.byCondition.get("noise/plain/cell")!.map((candidate) => candidate.id)).toEqual(["new-0", "new-1", "old"]);
    expect(groupRuns(read, { studies: [], tags: ["texture"], outcomes: [] }).map((row) => row.runs.map((candidate) => candidate.id))).toEqual([["new-1"]]);
    expect(tagsInUse(read.runs)).toEqual(["figure", "texture"]);
  });

  it("puts the runs without a basis group in a last row", () => {
    const read = readResearchManifest(manifest([run("objective", { group: null, loss: { kind: "other" } }), run("grouped", { group: 12 })]));
    expect(groupRuns(read, { studies: [], tags: [], outcomes: [] }).map((row) => row.group)).toEqual([12, null]);
    expect(groupSegment(null)).toBe("none");
    expect(read.runs[0]).toMatchObject({ group: null, loss: { kind: "other" }, lossRegion: null, request: null, machine: null });
  });
});
