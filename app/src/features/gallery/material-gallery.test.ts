import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fetchPublishedMaterial } from "./material-gallery";

const text = readFileSync(new URL("../../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8");
afterEach(() => vi.unstubAllGlobals());

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
