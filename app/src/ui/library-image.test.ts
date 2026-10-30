import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attemptAfterReload, attemptFor, reloadLibraryUrl, LibraryImage } from "./library-image";

describe("LibraryImage", () => {
  it("writes crossOrigin first and src last, so the one request it starts carries an Origin", () => {
    const markup = renderToStaticMarkup(createElement(LibraryImage, { src: "https://library.example/previews/1.png", alt: "", loading: "lazy", width: 256 }));
    const at = (attribute: string) => markup.indexOf(` ${attribute}=`);
    expect(at("crossorigin")).toBeGreaterThan(0);
    expect(at("crossorigin")).toBeLessThan(at("src"));
    // Every other attribute, loading included, is in place before src starts the load.
    expect(at("loading")).toBeLessThan(at("src"));
    expect(at("width")).toBeLessThan(at("src"));
  });
});

describe("a LibraryImage's attempt", () => {
  it("leaves a newer picture alone when an older picture's reload finishes late", () => {
    // A fails and its reload starts; src changes to B; B fails, its reload finishes; then A's reload finishes.
    let attempt = { src: "A", reloaded: false };
    attempt = attemptFor(attempt, "B");
    expect(attempt).toEqual({ src: "B", reloaded: false });
    attempt = attemptAfterReload(attempt, "B");
    expect(attempt).toEqual({ src: "B", reloaded: true });
    const settled = attempt;
    expect(attemptAfterReload(attempt, "A")).toBe(settled);
  });

  it("loads a picture's second element once its own reload finishes, and starts afresh for a new picture", () => {
    const first = { src: "A", reloaded: false };
    expect(attemptAfterReload(first, "A")).toEqual({ src: "A", reloaded: true });
    expect(attemptFor(first, "A")).toBe(first);
    expect(attemptFor({ src: "A", reloaded: true }, "C")).toEqual({ src: "C", reloaded: false });
  });
});

describe("reloadLibraryUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reloads a URL once per page, bypassing the cache, for every caller, and resolves when the download fails", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(new Response(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetch);
    // Two views fail on the same URL at once: one download, and both wait for it.
    await Promise.all([reloadLibraryUrl("https://library.example/previews/heal-1.png"), reloadLibraryUrl("https://library.example/previews/heal-1.png")]);
    await reloadLibraryUrl("https://library.example/previews/heal-1.png");
    await reloadLibraryUrl("https://library.example/previews/heal-2.png");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual(["https://library.example/previews/heal-1.png", "https://library.example/previews/heal-2.png"]);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: "reload" });
  });
});
