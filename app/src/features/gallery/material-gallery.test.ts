import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { loadMaterialIndex, fetchPublishedMaterial, fetchPublishedMaterialById, materialFileUrl, refreshMaterialIndex } from "./material-gallery";
import { materialEntry } from "./material-index";

const text = readFileSync(new URL("../../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8");
afterEach(() => {
  vi.unstubAllGlobals();
  refreshMaterialIndex();
});

it("shares a published definition between its label and playback", async () => {
  const fetcher = vi.fn(async () => new Response(text));
  vi.stubGlobal("fetch", fetcher);
  const first = fetchPublishedMaterial("caption-playback-shared");
  const second = fetchPublishedMaterial("caption-playback-shared");
  expect(first).toBe(second);
  expect((await first).file.training.updates).toBe(1000);
  expect(await fetchPublishedMaterial("caption-playback-shared")).toBe(await first);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("retries a failed definition load instead of retaining its rejection", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("Unavailable", { status: 503 })).mockResolvedValueOnce(new Response(text));
  vi.stubGlobal("fetch", fetcher);
  await expect(fetchPublishedMaterial("caption-retry")).rejects.toThrow("503");
  expect((await fetchPublishedMaterial("caption-retry")).file.training.updates).toBe(1000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("shares only the same URL and lets a failed version retry independently", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(text))
    .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response(text));
  vi.stubGlobal("fetch", fetcher);
  const initial = { id: "two-readings", tick: 100 };
  const later = { ...initial, tick: 200 };
  const first = fetchPublishedMaterial(initial);
  await expect(fetchPublishedMaterial(later)).rejects.toThrow("503");
  expect(fetchPublishedMaterial(initial)).toBe(first);
  await fetchPublishedMaterial(later);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/api/materials/two-readings/material.json?step=100",
    "/api/materials/two-readings/material.json?step=200",
    "/api/materials/two-readings/material.json?step=200",
  ]);
});

it("reads both files from the configured library and keeps replacements at one tick separate", async () => {
  vi.stubGlobal("location", new URL("https://preview.example"));
  const first = { id: "same-reading", tick: 600, fileRevision: "a".repeat(64) };
  const replacement = { ...first, fileRevision: "b".repeat(64) };
  const base = "https://library.example";
  const key = `gallery/materials/same-reading/versions/${first.fileRevision}`;
  expect(materialFileUrl(first, "poster.png", base)).toBe(`${base}/${key}/poster.png`);
  expect(materialFileUrl(first, "material.json", "/remote-library")).toBe(`/remote-library/${key}/material.json`);

  const updated = { ...JSON.parse(text), name: "Replacement" };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(text)).mockResolvedValueOnce(Response.json(updated));
  vi.stubGlobal("fetch", fetcher);
  const original = fetchPublishedMaterial(first);
  const latest = fetchPublishedMaterial(replacement);
  expect(fetchPublishedMaterial(first)).toBe(original);
  expect(fetchPublishedMaterial(replacement)).toBe(latest);
  expect((await latest).file.name).toBe("Replacement");
  expect((await original).file.name).not.toBe("Replacement");
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    materialFileUrl(first, "material.json"), materialFileUrl(replacement, "material.json"),
  ]);
});

it.each(["127.0.0.1", "localhost", "[::1]"])("loads the exact revision from the local gallery on %s", (host) => {
  vi.stubGlobal("location", new URL(`http://${host}:5173`));
  const fileRevision = "a".repeat(64);
  const entry = { id: "local-automaton", tick: 600, fileRevision };
  expect(materialFileUrl(entry, "poster.png", "/remote-library")).toBe(`/api/materials/local-automaton/poster.png?revision=${fileRevision}`);
  expect(materialFileUrl({ id: entry.id, tick: 600 }, "poster.png")).toBe("/api/materials/local-automaton/poster.png?step=600");
  expect(materialFileUrl(entry.id, "material.json")).toBe("/api/materials/local-automaton/material.json");
});

it("uses the current index revision for an id-only replay and retains the stable link for an unlisted id", async () => {
  const entry = {
    ...materialEntry("id-only-reading", JSON.parse(text), { title: "", credit: "" }, "2026-11-19"),
    fileRevision: "c".repeat(64),
  };
  const fetcher = vi.fn(async (url: string) => url === "/api/materials" ? Response.json({ entries: [entry] }) : new Response(text));
  vi.stubGlobal("fetch", fetcher);
  await loadMaterialIndex();
  const indexed = await fetchPublishedMaterialById(entry.id);
  expect(await fetchPublishedMaterial(entry)).toBe(indexed);
  await fetchPublishedMaterialById("unlisted-material");
  expect(fetcher.mock.calls.map(([address]) => address)).toEqual([
    "/api/materials",
    `${import.meta.env.ASSET_BASE_URL}/gallery/materials/${entry.id}/versions/${entry.fileRevision}/material.json`,
    "/api/materials/unlisted-material/material.json",
  ]);
});
