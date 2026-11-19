import { describe, expect, it } from "vitest";
import worker from "../src/worker.ts";
import { testEnv } from "./fixtures.ts";

describe("old page redirects", () => {
  it.each(["/index?sort=block&page=3", "/index/?role=patch"])("serves the Index at %s without Static Assets redirecting it home", async (path) => {
    const { env } = testEnv();
    env.ASSETS = {
      fetch: async (request) => new URL(request.url).pathname.startsWith("/index")
        ? Response.redirect("https://app.test/", 307)
        : new Response("<!doctype html><title>Dinodreamer</title>", { headers: { "content-type": "text/html" } }),
    };
    const response = await worker.fetch(new Request(`https://app.test${path}`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("Dinodreamer");
  });

  it.each([
    ["/explore?sort=block&page=3", "/index?sort=block&page=3"],
    ["/block/7178?role=patch", "/basis/7178?role=patch"],
    ["/playground?material=example%2Bseed&group=yours", "/automata?material=example%2Bseed&group=yours"],
    ["/grow?continue=example&rule=pyramid&start=centre-disc", "/train?continue=example&rule=pyramid&start=centre-disc"],
    ["/explore/block/7178?sort=block&page=3", "/index/basis/7178?sort=block&page=3"],
    ["/create/block/7178?request=2", "/create/basis/7178?request=2"],
  ])("preserves the query from %s", async (previous, current) => {
    const { env } = testEnv();
    const response = await worker.fetch(new Request(`https://app.test${previous}`), env);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(`https://app.test${current}`);
  });

  it.each([
    ["/ADMIN/automata?group=pending&material=20261118-221005-8afe5fcd", "/admin/automata?group=pending&material=20261118-221005-8afe5fcd"],
    ["/%61dmin/automata", "/admin/automata"],
    ["/Admin", "/admin"],
    ["/admin%2Fautomata", "/admin/automata"],
  ])("sends another spelling of the owner's path %s to the canonical one, where the owner check and the frame rule apply", async (previous, current) => {
    const { env } = testEnv();
    env.ASSETS = { fetch: async () => { throw new Error("the static assets must not answer an owner path"); } };
    const response = await worker.fetch(new Request(`https://app.test${previous}`), env);
    expect([response.status, response.headers.get("location")]).toEqual([301, `https://app.test${current}`]);
  });

  it("preserves a non-GET method when redirecting", async () => {
    const { env } = testEnv();
    const response = await worker.fetch(new Request("https://app.test/grow", { method: "POST" }), env);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.test/train");
  });
});
