import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker.ts";
import { SITE_PREVIEW, TOP_PAGES, previewTags, routePreview, withPreviewTags } from "../src/link-preview.ts";
import { paragraphHtml, readerText } from "../src/reader-text.ts";
import { SITE_WORDS } from "../../app/src/app/site-words.ts";
import { testEnv } from "./fixtures.ts";

const ORIGIN = "https://dinodreamer.test";
const PAGE = `<!doctype html><html><head><meta charset="UTF-8" /><title>DinoDreamer</title><script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>`;

describe("shared site preview", () => {
  it("uses one media pair while retaining the shared page's title and address", () => {
    const home = routePreview("home", null, `${ORIGIN}/`, ORIGIN);
    const basis = routePreview("index", 12002, `${ORIGIN}/index/basis/12002?sort=block`, ORIGIN);
    expect(home.media).toEqual({
      image: `${ORIGIN}${SITE_PREVIEW.image}`, video: `${ORIGIN}${SITE_PREVIEW.video}`,
      width: 1280, height: 640,
    });
    expect(basis.media).toEqual(home.media);
    expect(home.title).toBe(SITE_WORDS.pageSummaries.home.title);
    expect(basis.title).toBe("Basis group 12002 · DinoDreamer");
    expect(basis.description).toContain("Basis group 12002");
    expect(basis.url).toBe(`${ORIGIN}/index/basis/12002?sort=block`);
    // Search engines get one address per page: no query, and a panel's group address over any page.
    expect(basis.canonical).toBe(`${ORIGIN}/basis/12002`);
    expect(home.canonical).toBe(`${ORIGIN}/`);
    expect(routePreview("how", null, `${ORIGIN}/how/`, ORIGIN).canonical).toBe(`${ORIGIN}/how`);
    expect(routePreview(null, null, `${ORIGIN}/canvas`, ORIGIN).title).toBe(SITE_WORDS.preview.title);
  });

  it("serves downloadable MP4 metadata, a full-size poster and escaped text before JavaScript", () => {
    const preview = { ...routePreview("home", null, `${ORIGIN}/`, ORIGIN), description: `Fires on "stripes" & <dots>` };
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
    expect(html).toContain(`<title>${SITE_WORDS.pageSummaries.home.title}</title>`);
    expect(head).toContain(`<link rel="canonical" href="${ORIGIN}/" />`);
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


  it("gives each top page its own title, description, canonical address and reader text, and unknown addresses 404", async () => {
    const fixture = testEnv();
    const shell = `<!doctype html><html><head><meta name="description" content="shell" /><title>DinoDreamer</title></head><body><div id="root"></div></body></html>`;
    const env = { ...fixture.env, ASSETS: { fetch: async () => new Response(shell, { headers: { "content-type": "text/html" } }) } };
    const read = async (path: string) => {
      const response = await worker.fetch(new Request(`${ORIGIN}${path}`), env);
      return { status: response.status, body: await response.text() };
    };
    const paths = { home: "/", index: "/index", automata: "/automata", train: "/train", how: "/how" } as const;
    const titles = new Set<string>();
    for (const page of TOP_PAGES) {
      const path = paths[page];
      const words = SITE_WORDS.pageSummaries[page];
      const { status, body } = await read(path);
      expect(status, path).toBe(200);
      expect(body, path).toContain(`<title>${words.title}</title>`);
      expect(body, path).toContain(`<meta name="description" content="${words.description}" />`);
      expect(body, path).not.toContain('content="shell"');
      expect(body, path).toContain(`<link rel="canonical" href="${ORIGIN}${path}" />`);
      expect(body, path).toContain(`<h1>${words.heading}</h1>`);
      expect(body, path).toContain('<a href="https://computervision.vision/writing/dinodreamer/">');
      expect(body, path).toContain(`<a href="/" class="wordmark">${SITE_WORDS.frame.wordmark}</a>`);
      // The home keeps the app's header out of view while the entrance is on the screen.
      expect(body.includes("data-entrance"), path).toBe(page === "home");
      titles.add(words.title);
    }
    expect(titles.size).toBe(TOP_PAGES.length);
    const panel = await read("/automata/basis/4009");
    expect(panel.body).toContain("<h1>Basis group 4009</h1>");
    expect(panel.body).toContain(`<link rel="canonical" href="${ORIGIN}/basis/4009" />`);
    const unknown = await read("/no-such-page");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toBe(shell);
  });

  it("writes a paragraph's [words](address) as links and escapes everything else", () => {
    expect(paragraphHtml("See the [Index](/index) & <b>more</b>.")).toBe('See the <a href="/index">Index</a> &amp; &lt;b&gt;more&lt;/b&gt;.');
    expect(paragraphHtml("[a](javascript:alert(1))")).toBe("[a](javascript:alert(1))");
    // Every link in the words leads to a top page or to the write-up, so an edit cannot leave a broken one.
    const pages = new Set(["/index", "/automata", "/train", "/how"]);
    for (const page of TOP_PAGES) {
      const { paragraph } = readerText(page, null);
      for (const link of paragraph.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
        const address = link[2]!;
        expect(pages.has(address) || address === "https://computervision.vision/writing/dinodreamer/", `${page}: ${address}`).toBe(true);
      }
    }
  });
});
