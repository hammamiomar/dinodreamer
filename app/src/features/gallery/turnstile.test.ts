import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("retries when the script loads without installing its API", async () => {
  vi.resetModules();
  const scripts: HTMLScriptElement[] = [];
  const windowStub = {} as Window;
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("document", {
    createElement: () => ({ remove: vi.fn() }),
    head: { append: (script: HTMLScriptElement) => scripts.push(script) },
  });
  const { loadTurnstile } = await import("./turnstile");
  const first = loadTurnstile();
  const refused = expect(first).rejects.toThrow("Turnstile did not start");
  scripts[0].onload?.({} as Event);
  await refused;
  const next = loadTurnstile();
  expect(scripts).toHaveLength(2);
  const api = { render: vi.fn(), remove: vi.fn() };
  windowStub.turnstile = api;
  scripts[1].onload?.({} as Event);
  await expect(next).resolves.toBe(api);
});
