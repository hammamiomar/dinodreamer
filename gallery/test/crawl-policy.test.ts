// The crawl policy of both hosts: app/public/robots.txt for the site and library-robots.txt for the library.
// A crawler reads the rule with the longest matching path, Allow winning a tie; `*` matches any characters
// and a final `$` ends the path (RFC 9309). The rows are the addresses the policy exists for.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

interface CrawlRule {
  allow: boolean;
  path: string;
}

/**
 * The rules a crawler named `agent` obeys: those of the group that names it, or of the `*` group when none does
 * (RFC 9309). A group is one or more User-agent lines followed by its rules.
 */
function rulesOf(file: URL, agent = "*"): CrawlRule[] {
  const groups: { agents: string[]; rules: CrawlRule[] }[] = [];
  let open = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const [field, ...rest] = line.replace(/#.*/, "").split(":");
    const value = rest.join(":").trim();
    const name = field!.trim().toLowerCase();
    if (name === "user-agent") {
      if (!open) groups.push({ agents: [], rules: [] });
      groups.at(-1)!.agents.push(value.toLowerCase());
      open = true;
    } else if (name === "allow" || name === "disallow") {
      groups.at(-1)!.rules.push({ allow: name === "allow", path: value });
      open = false;
    }
  }
  const own = groups.find((group) => group.agents.includes(agent.toLowerCase()));
  return (own ?? groups.find((group) => group.agents.includes("*")))?.rules ?? [];
}

function pathPattern(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

function crawlable(rules: CrawlRule[], address: string): boolean {
  let chosen: CrawlRule | null = null;
  for (const rule of rules) {
    if (rule.path === "" || !pathPattern(rule.path).test(address)) continue;
    const longer = chosen === null || rule.path.length > chosen.path.length;
    const tieWonByAllow = chosen !== null && rule.path.length === chosen.path.length && rule.allow;
    if (longer || tieWonByAllow) chosen = rule;
  }
  return chosen?.allow ?? true;
}

describe("the site's crawl policy", () => {
  const rules = rulesOf(new URL("../../app/public/robots.txt", import.meta.url));

  test("admits the top-level pages", () => {
    for (const page of ["/", "/index", "/automata", "/train", "/how", "/canvas", "/create", "/picture"]) {
      expect(crawlable(rules, page), page).toBe(true);
    }
  });

  test("keeps out every basis group's panel, its old address, query views and the owner pages", () => {
    const refused = [
      "/basis/4009", "/index/basis/4009", "/automata/basis/4009", "/train/basis/4009", "/picture/basis/4009",
      "/how/basis/4009", "/create/basis/4009", "/block/4009", "/index/block/4009",
      "/index?sort=block&page=516", "/automata?group=12002", "/train?block=4009",
      "/admin", "/admin/automata",
    ];
    for (const address of refused) expect(crawlable(rules, address), address).toBe(false);
  });

  test("lets the link-preview readers of X and LinkedIn read shared panel and automaton links, not the owner pages", () => {
    for (const agent of ["Twitterbot", "LinkedInBot"]) {
      const preview = rulesOf(new URL("../../app/public/robots.txt", import.meta.url), agent);
      for (const address of ["/automata?group=12002&material=x", "/basis/4009", "/index/basis/4009", "/"]) {
        expect(crawlable(preview, address), `${agent} ${address}`).toBe(true);
      }
      expect(crawlable(preview, "/admin"), agent).toBe(false);
    }
  });

  test("names a sitemap whose pages are all crawlable", () => {
    const policy = readFileSync(new URL("../../app/public/robots.txt", import.meta.url), "utf8");
    expect(policy).toMatch(/^Sitemap: https:\/\/dinodreamer\.computervision\.vision\/sitemap\.xml$/m);
    const sitemap = readFileSync(new URL("../../app/public/sitemap.xml", import.meta.url), "utf8");
    const pages = [...sitemap.matchAll(/<loc>https:\/\/dinodreamer\.computervision\.vision(\/[^<]*)<\/loc>/g)].map((match) => match[1]!);
    expect(pages).toEqual(["/", "/index", "/automata", "/train", "/how"]);
    for (const page of pages) expect(crawlable(rules, page), page).toBe(true);
  });
});

describe("the library's crawl policy", () => {
  const rules = rulesOf(new URL("../library-robots.txt", import.meta.url));

  test("admits what the top-level pages load and keeps out the model and the engine", () => {
    expect(crawlable(rules, "/releases/pass-003.json")).toBe(true);
    expect(crawlable(rules, "/web/v2/assets/452ed7c3/thumbs/1.webp")).toBe(true);
    expect(crawlable(rules, "/previews/site/dinodreamer-hibiscus-v2.jpg")).toBe(true);
    expect(crawlable(rules, "/model/dinov3-vitb16-pretrain-lvd1689m/encoder-layer-00.safetensors")).toBe(false);
    expect(crawlable(rules, "/app/7ace1a210ebcd5da/dinodreamer_engine_bg.wasm")).toBe(false);
  });
});
