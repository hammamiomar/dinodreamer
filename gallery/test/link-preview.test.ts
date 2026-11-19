import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker.ts";
import { SITE_PREVIEW, previewTags, routePreview, withPreviewTags } from "../src/link-preview.ts";
import { testEnv } from "./fixtures.ts";

const ORIGIN = "https://dinodreamer.test";
const PAGE = `<!doctype html><html><head><meta charset="UTF-8" /><title>DinoDreamer</title><script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>`;

describe("shared site preview", () => {
  it("uses one media pair while retaining the shared page's title and address", () => {
    const home = routePreview(null, `${ORIGIN}/`, ORIGIN);
    const basis = routePreview(12002, `${ORIGIN}/basis/12002`, ORIGIN);
    expect(home.media).toEqual({
      image: `${ORIGIN}${SITE_PREVIEW.image}`, video: `${ORIGIN}${SITE_PREVIEW.video}`,
      width: 1280, height: 640,
    });
    expect(basis.media).toEqual(home.media);
    expect(home.title).toBe("Dinodreamer");
    expect(basis.title).toBe("Basis group 12002 · Dinodreamer");
    expect(basis.description).toContain("Basis group 12002");
    expect(basis.url).toBe(`${ORIGIN}/basis/12002`);
  });

  it("serves downloadable MP4 metadata, a full-size poster and escaped text before JavaScript", () => {
    const preview = { ...routePreview(null, `${ORIGIN}/`, ORIGIN), description: `Fires on "stripes" & <dots>` };
    const html = withPreviewTags(PAGE, preview);
    const head = html.slice(0, html.indexOf("</head>"));
    for (const tag of ["og:image", "og:image:type", "og:video", "og:video:secure_url", "twitter:player:stream"]) {
      expect(head).toContain(`"${tag}"`);
    }
    expect(head).toContain('property="og:video:type" content="video/mp4"');
    expect(head).toContain('property="og:image:type" content="image/jpeg"');
    expect(head).toContain('property="og:image:width" content="1280"');
    expect(head).toContain('property="og:video:height" content="640"');
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
    expect(head).toContain('content="Fires on &quot;stripes&quot; &amp; &lt;dots&gt;"');
    expect(html).toContain('<script type="module" src="/assets/index.js"></script>');
    expect(html).toContain("<title>Dinodreamer</title>");
    expect(previewTags(preview).match(/property="og:video"/g)).toHaveLength(1);
  });

  it("gives all public routes the same preview without gallery I/O, for browsers and link readers", async () => {
    const fixture = testEnv();
    const get = vi.spyOn(fixture.library, "get");
    const list = vi.spyOn(fixture.library, "list");
    const env = {
      ...fixture.env,
      ASSETS: { fetch: async () => new Response(PAGE, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", etag: '"page"' },
      }) },
    };
    for (const path of ["/", "/index?sort=block&page=7", "/automata", "/train", "/how/", "/canvas", "/picture", "/create", "/gallery", "/saved", "/basis/4009", "/index/basis/4009", "/automata/basis/4009", "/train/basis/4009", "/how/basis/4009"]) {
      const ask = (agent: string) => worker.fetch(new Request(`${ORIGIN}${path}`, { headers: { "user-agent": agent } }), env);
      const messages = await ask("facebookexternalhit/1.1 Facebot Twitterbot/1.0");
      const body = await messages.text();
      expect(body).toBe(await (await ask("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)")).text());
      expect(body).toContain(`${fixture.env.ASSET_BASE_URL}${SITE_PREVIEW.video}`);
      expect(body).toContain(`${ORIGIN}${path.replaceAll("&", "&amp;")}`);
      expect(messages.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      expect(messages.headers.get("etag")).toBeNull();
    }
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    const head = await worker.fetch(new Request(`${ORIGIN}/`, { method: "HEAD" }), env);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

});
