import { describe, expect, it, vi } from "vitest";
import { decodeLookFixture, decodeLookSummary, LOOK_CLOUDS_PATH } from "./look-cloud";
import { Library } from "./library";
import { fixtureLibrary } from "./fixture-library";

const sample = () => ({
  format: 2,
  block: 14544,
  source: { release: "pass-003" },
  sampling: { filter: "public_preview", selected_rows: 1, source_block_rows: 100, public_preview_fraction: 0.8 },
  rows: [{ code: [3, 4, 0], norm: 5, image_id: 9007199254740991, slot: 260, public_preview: true, winner_rank: 32, gate: 4.5 }],
});
const summary = () => ({
  block: 14544, release: "pass-003", gate_median: 4, radius: { p5: 3.5, p50: 4.4, p95: 7 }, main_lobe: { direction: [1, 0, 0] }, patch_rows: 100,
});

describe("public cloud boundary", () => {
  it("preserves native codes, one-based winner ranks and exact safe image IDs", () => {
    const decoded = decodeLookFixture(sample());
    expect(decoded.points[0]).toMatchObject({ imageId: 9007199254740991, code: [3, 4, 0], winnerRank: 32 });
    expect(decodeLookSummary(summary())).toMatchObject({ gateMedian: 4, medianNorm: 4.4 });
  });

  it.each(["code", "image", "preview", "rank", "norm", "duplicate"])("rejects invalid %s at the boundary", (problem) => {
    const file = sample();
    if (problem === "code") file.rows[0].code[0] = NaN;
    if (problem === "image") file.rows[0].image_id = 9007199254740992;
    if (problem === "preview") file.rows[0].public_preview = false;
    if (problem === "rank") file.rows[0].winner_rank = 0;
    if (problem === "norm") file.rows[0].norm = 9;
    if (problem === "duplicate") file.rows.push(file.rows[0]);
    expect(() => decodeLookFixture(file)).toThrow();
  });

  it("shares reads and reads no observations or model assets", async () => {
    const published = (await fixtureLibrary()).library;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => Response.json(String(url).includes("/summaries/") ? summary() : sample()));
    const library = new Library("https://library.example", { ...published.release, name: "pass-003" }, fetcher);
    const [first, second] = await Promise.all([library.lookCloud(14544), library.lookCloud(14544)]);
    expect(first).toBe(second);
    expect(await library.lookCloud(14544)).toBe(first);
    expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual([
      `https://library.example/${LOOK_CLOUDS_PATH}/14544.json`,
      `https://library.example/${LOOK_CLOUDS_PATH}/summaries/14544.json`,
    ]);
  });

  it("rejects a different block and retries a failed fetch", async () => {
    const published = (await fixtureLibrary()).library;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => Response.json(String(url).includes("/summaries/") ? summary() : sample()));
    fetcher.mockRejectedValueOnce(new Error("offline"));
    const library = new Library("https://library.example", { ...published.release, name: "pass-003" }, fetcher);
    await expect(library.lookCloud(14544)).rejects.toThrow("offline");
    await expect(library.lookCloud(14544)).resolves.toHaveProperty("fixture.block", 14544);
    await expect(library.lookCloud(1)).rejects.toThrow("does not match");
  });
});
