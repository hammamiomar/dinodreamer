import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFigureMaterial, type FigureMaterialFile } from "../materials/material-file";
import type { FigureReplay, FigureReplayOptions } from "./figure-replay";
import type { FigureShaderSources } from "./figure-shaders";
import type { ReplayLoop, ReplayLoopOptions } from "./replay-loop";
import { materialLine } from "./material-facts";
import { replayPageHtml, replayPageName, runReplayPage } from "./replay-page";
import { checkVideoPlan, videoFileName } from "./replay-video";

const kept = (): FigureMaterialFile => JSON.parse(readFileSync(
  new URL("../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8"));

describe("standalone replay page", () => {
  it("embeds the runtime, the loop and the exact material file, with no network address", () => {
    const file = kept();
    const html = replayPageHtml(file);
    const embedded = html.match(/const material = (.*);\n/)![1];
    expect(readFigureMaterial(JSON.parse(embedded)).file).toEqual(file);
    expect(html).toContain("const createReplay = async function createFigureReplay(");
    expect(html).toContain("function startReplayLoop(");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\bimport\s*[({"']/);
    expect(replayPageName(file)).toBe("block-12002-figure-strongest-mean-seed-1.html");
  });

  it("plays a seeded material from its disc and says so, counting the central patches", () => {
    const seeded = JSON.parse(readFileSync(
      new URL("../../../gallery/seed/materials/block-2632-figure-seeded-strongest-seed-0.material.json", import.meta.url), "utf8"));
    const html = replayPageHtml(seeded);
    expect(html).toContain('const playback = {"hiddenNoise":0,"startDisc":16,"startBackground":0,"pixelsPerCell":1};');
    expect(replayPageHtml(kept())).toContain('const playback = {"hiddenNoise":0,"startDisc":0,"startBackground":0,"pixelsPerCell":1};');
    expect(materialLine(seeded)).toMatch(/^Basis group 2632 · one grid · noise disc start · [\d,]+ optimizer updates$/);
    expect(materialLine(kept())).toMatch(/^Basis group 12002 · one grid · [\d,]+ optimizer updates$/);
    // The saved note is in the embedded definition, not on the page.
    expect(html).not.toContain('class="note"');
  });

  it("offers a 2 px material's own grids and shows its 128-pixel picture", () => {
    const coarse = JSON.parse(readFileSync(
      new URL("../../../gallery/seed/materials/block-4009-figure-2px-strongest-seed-0.material.json", import.meta.url), "utf8"));
    const html = replayPageHtml(coarse);
    expect(html).toContain('<select id="grid"><option value="64" selected>64 cells</option><option value="128">128 cells</option></select>');
    expect(html).toMatch(/<img id="poster" src="data:image\/png;base64,[^"]+" width="128" height="128"/);
    expect(html).toContain('"pixelsPerCell":2};');
  });

  it("carries the pyramid's shaders, so an exported pyramid page replays both grids", () => {
    const pyramid = JSON.parse(readFileSync(
      new URL("../../../gallery/seed/materials/block-4009-figure-pyramid-strongest-seed-0.material.json", import.meta.url), "utf8"));
    const html = replayPageHtml(pyramid);
    const shaders = JSON.parse(html.match(/const shaders = (.*);\n/)![1]);
    expect(Object.keys(shaders)).toEqual(["start", "step", "fineStep", "damage", "pack", "present", "pyramidPack", "pyramidPresent"]);
    expect(html).toContain('<select id="grid"><option value="128" selected>128 cells</option><option value="256">256 cells</option></select>');
  });

  it("starts its player at 1x, with the stage's six speeds", () => {
    expect(replayPageHtml(kept())).toContain('<select id="speed"><option value="0.25">¼x</option><option value="0.5">½x</option>'
      + '<option value="1" selected>1x</option><option value="2">2x</option><option value="4">4x</option><option value="8">8x</option></select>');
  });

  it("starts on the kept frame, and the hidden attribute wins over the stage's display rule", () => {
    // Without WebGPU, hidden must override display:block so the canvas cannot cover the poster.
    const html = replayPageHtml(kept());
    expect(html).toMatch(/<canvas hidden /);
    expect(html).toMatch(/<img id="poster" src="data:image\/png;base64,/);
    expect(html).toContain("[hidden]{display:none!important}");
  });

  it("states the automaton's one line under its name, escaped, and nothing of the measurements", () => {
    const file = { ...kept(), name: "<b>12002</b>" };
    const html = replayPageHtml(file);
    expect(html).toContain("<title>&lt;b&gt;12002&lt;/b&gt;</title>");
    expect(html).not.toContain("<b>12002</b>");
    expect(html).toContain('<p class="line">Basis group 12002 · one grid · 1,000 optimizer updates</p>');
    expect(html).not.toMatch(/response magnitude|projection on|Selection target/);
  });
});

describe("video plan", () => {
  it("names the tick range and rate and counts the first frame", () => {
    const plan = { seed: 1, fromTick: 0, toTick: 600, ticksPerFrame: 1, fps: 30 };
    expect(checkVideoPlan(plan)).toBe(601);
    expect(videoFileName(12002, plan, "webm")).toBe("block-12002-figure-seed-1-ticks-0000-0600-30fps.webm");
    expect(() => checkVideoPlan({ ...plan, ticksPerFrame: 7 })).toThrow(/whole number of frames/);
    expect(() => checkVideoPlan({ ...plan, toTick: 0 })).toThrow(/ends after/);
    expect(() => checkVideoPlan({ ...plan, fps: 120 })).toThrow(/1–60/);
  });
});


describe("standalone replay lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  function page(reducedMotion = false, webGpu = true) {
    const elements = new Map<string, {
      value: string;
      hidden: boolean;
      textContent: string;
      disabled: boolean;
      onclick: () => void;
      onchange: () => void;
    }>();
    for (const selector of ["canvas", "#status", "#tick", "#play", "#speed", "#seed", "#grid", "#brush", "#again", "#download", "#poster"]) {
      elements.set(selector, { value: selector === "#grid" ? "128" : "1", hidden: selector === "canvas", textContent: "", disabled: false, onclick() {}, onchange() {} });
    }
    let close = () => {};
    vi.stubGlobal("document", { querySelector: (selector: string) => elements.get(selector) });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reducedMotion }), addEventListener: (_name: string, callback: () => void) => { close = callback; } });
    vi.stubGlobal("navigator", { gpu: webGpu ? {} : undefined });
    const pending: { options: FigureReplayOptions; resolve: (replay: FigureReplay) => void; reject: (error: Error) => void }[] = [];
    const create = (options: FigureReplayOptions) => new Promise<FigureReplay>((resolve, reject) => pending.push({ options, resolve, reject }));
    const start = vi.fn((_replay: FigureReplay, _options: ReplayLoopOptions) => ({ stop: vi.fn(), pause: vi.fn(), play: vi.fn() }) as unknown as ReplayLoop);
    const opening = runReplayPage(create, start, {} as FigureShaderSources, kept(), { hiddenNoise: 0, startDisc: 0, startBackground: 0, pixelsPerCell: 1 });
    return { elements, pending, start, opening, close: () => close() };
  }
  const settle = async () => { for (let count = 0; count < 5; count++) await Promise.resolve(); };

  it("aborts an older grid start and releases a late replay without displaying it", async () => {
    const test = page();
    test.elements.get("#grid")!.value = "256";
    test.elements.get("#grid")!.onchange();
    expect(test.pending[0].options.signal?.aborted).toBe(true);
    const current = { dispose: vi.fn() };
    test.pending[1].resolve(current as unknown as FigureReplay);
    await settle();
    const older = { dispose: vi.fn() };
    test.pending[0].resolve(older as unknown as FigureReplay);
    await test.opening;
    expect(older.dispose).toHaveBeenCalledOnce();
    expect(current.dispose).not.toHaveBeenCalled();
    expect(test.start).toHaveBeenCalledTimes(1);
    expect(test.start.mock.calls[0][0]).toBe(current);
    test.close();
  });

  it("closes an in-flight start before the page has initialized", async () => {
    const test = page();
    test.close();
    expect(test.pending[0].options.signal?.aborted).toBe(true);
    const replay = { dispose: vi.fn() };
    test.pending[0].resolve(replay as unknown as FigureReplay);
    await test.opening;
    expect(replay.dispose).toHaveBeenCalledOnce();
    expect(test.start).not.toHaveBeenCalled();
  });

  it("honors reduced motion and a Play click during initialization", async () => {
    const test = page(true);
    expect(test.elements.get("#play")!.textContent).toBe("Play");
    test.elements.get("#play")!.onclick();
    test.pending[0].resolve({ dispose: vi.fn() } as unknown as FigureReplay);
    await test.opening;
    expect(test.start.mock.calls[0][1]).toMatchObject({ playing: true });
    test.close();
  });
  it("shows a disabled Play control when WebGPU is unavailable", async () => {
    const test = page(false, false);
    await test.opening;
    expect(test.elements.get("#play")).toMatchObject({ textContent: "Play", disabled: true });
    expect(test.pending).toHaveLength(0);
  });

  it("disables playback after a failed start and enables it on a grid retry", async () => {
    const test = page();
    test.pending[0].reject(new Error("Device unavailable"));
    await test.opening;
    expect(test.elements.get("#play")).toMatchObject({ textContent: "Play", disabled: true });
    test.elements.get("#grid")!.onchange();
    expect(test.elements.get("#play")!.disabled).toBe(false);
    test.close();
    test.pending[1].reject(new Error("Aborted"));
    await settle();
  });

});
