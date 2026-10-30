import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";

const folder = new URL("../../../public/how/training/automaton-4009/", import.meta.url);

afterEach(() => { vi.unstubAllGlobals(); });

it("loads only the recorded grids and metadata, once for concurrent readers", async () => {
  vi.resetModules();
  const fetchRecord = vi.fn(async (url: string) => new Response(await readFile(new URL(url.split("/").at(-1)!, folder))));
  vi.stubGlobal("fetch", fetchRecord);
  const { loadAutomatonState } = await import("./automaton-record");
  const [first, second] = await Promise.all([loadAutomatonState(), loadAutomatonState()]);
  expect(second).toBe(first);
  expect(first.fine.state).toHaveLength(128 * 128 * 16);
  expect(first.coarse.state).toHaveLength(64 * 64 * 16);
  expect(first.replay.tick).toBe(600);
  expect(fetchRecord.mock.calls.map(([url]) => url.split("/").at(-1)).sort()).toEqual([
    "grid-coarse-600.bin", "grid-fine-600.bin", "replay.json",
  ]);
});

it.each(["seed", "tick"])("rejects a recorded %s mismatch and allows a new load", async (invalid) => {
  vi.resetModules();
  let corrupt = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const bytes = await readFile(new URL(url.split("/").at(-1)!, folder));
    if (corrupt && url.endsWith("grid-coarse-600.bin")) bytes.writeUInt32LE(1, invalid === "tick" ? 8 : 12);
    return new Response(bytes);
  }));
  const { loadAutomatonState } = await import("./automaton-record");
  await expect(loadAutomatonState()).rejects.toThrow();
  corrupt = false;
  await expect(loadAutomatonState()).resolves.toMatchObject({ replay: { tick: 600 } });
});
