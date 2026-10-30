import { describe, expect, it } from "vitest";
import type { MaterialEntry } from "../gallery/material-index";
import { fetchOwnerMaterials, readOwnerMaterials, sendOwnerAction } from "./owner-materials";

const base: MaterialEntry = {
  id: "block-12002-figure-strongest-seed-1", title: "12002 · strongest · seed 1", credit: "DinoDreamer project", publishedAt: "2026-10-23T00:00:00Z",
  materialId: "block-12002-figure-strongest-seed-1", block: 12002, recipe: "figure-2026-10-22", band: "strongest",
  strength: 2.387, winnerFraction: 1, fired: true, side: 128, seed: 2026102201, tick: 600, engine: "pytorch", trainerCommit: "9822ee64",
  layout: "figure-16-96-torus-v1", start: "noise", pixelsPerCell: 1, experiment: "E18",
};
const pyramid: MaterialEntry = { ...base, id: "block-4009-stage-6-pyramid-seeded-strongest-seed-0", block: 4009, layout: "figure-pyramid-16-96-torus-v1", start: "centre-disc", region: "centre-4x4", experiment: "E21" };
const submission = { kind: "material", id: "20261026-101500-a1b2c3d4", title: "Moss", credit: "A visitor", submittedAt: "2026-10-26T10:15:00Z", block: 7178, materialId: "kept-7178" };

/** A fetch that answers every request with `body` and records what was sent. */
function answering(body: unknown, status = 200) {
  const sent: [string, RequestInit | undefined][] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    sent.push([url, init]);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { sent, fetcher };
}

describe("the owner API's client", () => {
  it("reads the pending, shown and hidden automata, and refuses a hidden one without its time or a pending one without its fields", () => {
    const answer = { pending: [submission], published: [base], hidden: [{ ...pyramid, hiddenAt: "2026-10-23T12:00:00Z" }] };
    const read = readOwnerMaterials(answer);
    expect(read.pending.map((row) => row.id)).toEqual([submission.id]);
    expect(read.shown.map((entry) => entry.id)).toEqual([base.id]);
    expect(read.hidden.map((entry) => [entry.id, entry.hiddenAt])).toEqual([[pyramid.id, "2026-10-23T12:00:00Z"]]);
    expect(() => readOwnerMaterials({ ...answer, hidden: [pyramid] })).toThrow(/hiding time/);
    expect(() => readOwnerMaterials({ ...answer, pending: [{ ...submission, block: "7178" }] })).toThrow(/pending submission/);
    expect(() => readOwnerMaterials({ ...answer, published: [{ ...base, layout: "other" }] })).toThrow(/layout/);
  });

  it("sends one action as JSON and reads the entry each answer holds", async () => {
    const featured = answering({ entry: { ...base, featured: true } });
    expect(await sendOwnerAction("feature", base.id, featured.fetcher)).toMatchObject({ id: base.id, featured: true });
    expect(featured.sent).toEqual([["/admin/api/materials/feature", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: base.id }) }]]);
    expect(await sendOwnerAction("hide", base.id, answering({ hidden: { ...base, hiddenAt: "2026-10-26T10:00:00Z" } }).fetcher)).toMatchObject({ id: base.id });
    expect(await sendOwnerAction("restore", base.id, answering({ restored: base }).fetcher)).toMatchObject({ id: base.id });
    expect(await sendOwnerAction("approve", submission.id, answering({ entry: { ...base, id: submission.id } }).fetcher)).toMatchObject({ id: submission.id });
    // Purge and Reject answer only the id.
    expect(await sendOwnerAction("purge", base.id, answering({ purged: base.id }).fetcher)).toBeNull();
    expect(await sendOwnerAction("reject", submission.id, answering({ rejected: submission.id }).fetcher)).toBeNull();
  });

  it("reports the Worker's own refusal", async () => {
    const refused = answering({ error: "owner access refused: no Access token" }, 403);
    await expect(sendOwnerAction("purge", base.id, refused.fetcher)).rejects.toThrow("owner access refused: no Access token");
    await expect(fetchOwnerMaterials(refused.fetcher)).rejects.toThrow("owner access refused");
    const hidden = answering({ error: `${base.id} is hidden: show it first` }, 409);
    await expect(sendOwnerAction("feature", base.id, hidden.fetcher)).rejects.toThrow("is hidden: show it first");
  });
});
