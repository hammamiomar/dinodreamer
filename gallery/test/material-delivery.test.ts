import { expect, it, vi } from "vitest";
import { materialKey, versionedMaterialKey } from "../../app/src/features/gallery/material-index.ts";
import { CACHE_IMMUTABLE, CACHE_INDEX } from "../src/storage.ts";
import worker from "../src/worker.ts";
import { testEnv } from "./fixtures.ts";

it("gives the edge and browser the same index expiry, including when no index exists yet", async () => {
  const { env, library } = testEnv();
  const read = vi.spyOn(library, "get");
  const now = Date.parse("2026-11-19T12:00:00Z");
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const saved = new Map<string, Response>();
  const cache = {
    match: async (key: string) => saved.get(key)?.clone(),
    put: async (key: string, response: Response) => { saved.set(key, response); },
  };
  const writes: Promise<unknown>[] = [];
  const context = { waitUntil: (operation: Promise<unknown>) => { writes.push(operation); } };
  const url = "https://app.test/api/materials";
  vi.stubGlobal("caches", { default: cache });
  try {
    const fresh = await worker.fetch(new Request(url), env, context);
    await Promise.all(writes);
    expect(await fresh.json()).toEqual({ entries: [] });
    const deadline = new Date(now + 60_000).toUTCString();
    expect(fresh.headers.get("expires")).toBe(deadline);
    expect(fresh.headers.get("cache-control")).toBe("public, must-revalidate");

    clock.mockReturnValue(now + 59_000);
    const hit = await worker.fetch(new Request(url + "?view=grid"), env, context);
    expect(hit.headers.get("expires")).toBe(deadline);
    expect([...saved.keys()]).toEqual([url]);
    expect(read).toHaveBeenCalledTimes(1);

    // Simulate eviction at the original deadline.
    saved.clear();
    clock.mockReturnValue(now + 60_000);
    const next = await worker.fetch(new Request(url), env, context);
    expect(next.headers.get("expires")).toBe(new Date(now + 120_000).toUTCString());
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    clock.mockRestore();
  }
});

it("serves legacy material links and exact local revisions from the bound bucket", async () => {
  const { env, library } = testEnv();
  const id = "two-readings";
  const revision = "a".repeat(64);
  await library.put(materialKey(id, "material.json"), "current");
  await library.put(versionedMaterialKey(id, revision, "material.json"), "first");
  const url = `https://app.test/api/materials/${id}/material.json`;
  for (const query of ["", "?step=600"]) {
    const legacy = await worker.fetch(new Request(url + query), env);
    expect(legacy.headers.get("cache-control")).toBe(CACHE_INDEX);
    expect(await legacy.text()).toBe("current");
  }
  const version = await worker.fetch(new Request(url + "?revision=" + revision), env);
  expect(version.headers.get("cache-control")).toBe(CACHE_IMMUTABLE);
  expect(await version.text()).toBe("first");
  const missing = await worker.fetch(new Request(url + "?revision=" + "b".repeat(64)), env);
  expect([missing.status, missing.headers.get("cache-control")]).toEqual([404, "no-store"]);
  const read = vi.spyOn(library, "get");
  const invalid = await worker.fetch(new Request(url + "?revision=../"), env);
  expect(invalid.status).toBe(404);
  expect(read).not.toHaveBeenCalled();
});
