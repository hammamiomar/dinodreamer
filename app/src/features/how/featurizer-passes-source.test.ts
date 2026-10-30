import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fill, SITE_WORDS } from "../../app/site-words";
import { decodeFeaturizerPasses, loadFeaturizerPasses } from "./featurizer-passes-source";

function onePass(pass: number, left: number) {
  return {
    pass, checkpoint: `pass-00${pass}.pt`, sha256: "0".repeat(64), updates: 32768 * pass,
    loss: { main: 0.3, auxiliary: 0.35, total: 0.31 }, gain: 0.36,
    groups: Array.from({ length: 32 }, (_, index) => index * 7),
    norms: Array.from({ length: 32 }, (_, index) => 10 - index * 0.1),
    curve: Array.from({ length: 33 }, (_, index) => 1 - ((1 - left) * index) / 32),
  };
}
function recorded() {
  return { format: 1, provenance: { run: "test-run" }, imageId: 1, slot: 59, block: 7, passes: [onePass(1, 0.5), onePass(2, 0.48), onePass(3, 0.46)] };
}

describe("the featurizer passes record", () => {
  it("decodes the passes in order with their groups and remainders", () => {
    const record = decodeFeaturizerPasses(recorded());
    expect(record.passes.map((entry) => entry.pass)).toEqual([1, 2, 3]);
    expect(record.passes[2]!.curve[32]).toBeCloseTo(0.46);
    expect(record.passes[0]!.groups).toContain(7);
  });

  it.each([
    ["a group outside the collection", (value: ReturnType<typeof recorded>) => { value.passes[0]!.groups[0] = 16384; }],
    ["a repeated group", (value: ReturnType<typeof recorded>) => { value.passes[0]!.groups[1] = value.passes[0]!.groups[0]!; }],
    ["a remainder that does not start whole", (value: ReturnType<typeof recorded>) => { value.passes[1]!.curve[0] = 0.9; }],
    ["passes out of order", (value: ReturnType<typeof recorded>) => { value.passes.reverse(); }],
  ])("rejects %s", (_, damage) => {
    const value = recorded();
    damage(value);
    expect(() => decodeFeaturizerPasses(value)).toThrow();
  });

  it("holds the page's record: three passes of the hibiscus patch, its group among the 32 each time, the remainder falling", () => {
    const value = JSON.parse(readFileSync(new URL("../../../public/how/training/featurizer-passes.json", import.meta.url), "utf8")) as unknown;
    const record = decodeFeaturizerPasses(value);
    expect(record.block).toBe(4009);
    expect(record.passes).toHaveLength(3);
    for (const entry of record.passes) expect(entry.groups).toContain(record.block);
    const ends = record.passes.map((entry) => entry.curve[32]!);
    expect(ends[0]!).toBeGreaterThan(ends[1]!);
    expect(ends[1]!).toBeGreaterThan(ends[2]!);
    const losses = record.passes.map((entry) => entry.loss.total);
    expect(losses[0]!).toBeGreaterThan(losses[2]!);
  });
});

describe("the loader's failure words", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses site words for a 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503, headers: { "Content-Type": "text/html" } })));
    await expect(loadFeaturizerPasses()).rejects.toThrow(fill(SITE_WORDS.how.basisTrainingReadFailed, { status: 503 }));
  });

  it("treats an HTML page in the record's place as no record", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } })));
    await expect(loadFeaturizerPasses()).resolves.toBeNull();
  });

  it("keeps parse diagnostics behind the record message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{", { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(loadFeaturizerPasses()).rejects.toThrow(SITE_WORDS.how.basisTrainingInvalid);
  });
});
