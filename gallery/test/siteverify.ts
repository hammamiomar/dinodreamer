// Every test Worker has a Turnstile secret, as production does (it refuses submissions without one).
// This stands in for Cloudflare's siteverify: it accepts the fixtures' test token and refuses any
// other. A test that checks Turnstile itself installs its own answer (gallery.test.ts).
import { beforeEach, vi } from "vitest";
import { SITEVERIFY_URL } from "../src/turnstile.ts";
import { TEST_TURNSTILE_TOKEN } from "./fixtures.ts";

const network = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) !== SITEVERIFY_URL) return network(url, init);
    return Response.json({ success: new URLSearchParams(init?.body as URLSearchParams).get("response") === TEST_TURNSTILE_TOKEN });
  });
});
