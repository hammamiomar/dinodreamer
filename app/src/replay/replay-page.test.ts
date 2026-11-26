import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFigureMaterial, type FigureMaterialFile } from "../materials/material-file";
import { automatonTagName } from "./automaton-embed";
import { materialLine } from "./material-facts";
import { replayPageHtml, replayPageName, replayPageTitle, runReplayPage } from "./replay-page";
import { checkVideoPlan, videoFileName } from "./replay-video";

const kept = (): FigureMaterialFile => JSON.parse(readFileSync(
  new URL("../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8"));
const seedMaterial = (name: string): FigureMaterialFile => JSON.parse(readFileSync(
  new URL(`../../../gallery/seed/materials/${name}.material.json`, import.meta.url), "utf8"));
const unnamed = { title: "", credit: "" };

describe("standalone replay page", () => {
  it("embeds the element, the replay, the loop and the exact material file, with no network address", () => {
    const file = kept();
    const html = replayPageHtml(file, unnamed);
    const embedded = html.match(/const material = (.*);\n/)![1];
    expect(readFigureMaterial(JSON.parse(embedded)).file).toEqual(file);
    expect(html).toContain("const createReplay = async function createFigureReplay(");
    expect(html).toContain("function startReplayLoop(");
    expect(html).toContain("function defineAutomatonElement(");
    expect(html).toContain(`<${automatonTagName(file)} draw></${automatonTagName(file)}>`);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\bimport\s*[({"']/);
    expect(replayPageName(file)).toBe(`${automatonTagName(file)}.html`);
  });

  it("holds the rule and the still image once: the element takes them from the definition", () => {
    const file = kept();
    const html = replayPageHtml(file, unnamed);
    expect(html.split(file.rule.values).length - 1).toBe(1);
    expect(html.split(file.preview).length - 1).toBe(1);
    expect(html).toContain("rule: material.rule.values, still: material.preview");
  });

  it("plays a seeded material from its disc and a 2 px material at its own grids", () => {
    const seeded = seedMaterial("block-2632-figure-seeded-strongest-seed-0");
    expect(replayPageHtml(seeded, unnamed)).toContain('"playback":{"hiddenNoise":0,"startDisc":16,"startBackground":0,"pixelsPerCell":1}');
    expect(materialLine(seeded)).toMatch(/^Basis group 2632 · one grid · noise disc start · [\d,]+ optimizer updates$/);
    const coarse = seedMaterial("block-4009-figure-2px-strongest-seed-0");
    const html = replayPageHtml(coarse, unnamed);
    expect(html).toContain('<select id="grid"><option value="64" selected>64 cells</option><option value="128">128 cells</option></select>');
    expect(html).toContain('"pixelsPerCell":2}');
  });

  it("carries the pyramid's shaders, so an exported pyramid page replays both grids", () => {
    const html = replayPageHtml(seedMaterial("block-4009-figure-pyramid-strongest-seed-0"), unnamed);
    const shaders = JSON.parse(html.match(/const shaders = (.*);\n/)![1]);
    expect(Object.keys(shaders)).toEqual(["start", "step", "fineStep", "damage", "pack", "present", "pyramidPack", "pyramidPresent"]);
    expect(html).toContain('<select id="grid"><option value="128" selected>128 cells</option><option value="256">256 cells</option></select>');
  });

  it("starts at 1x, with the stage's six speeds", () => {
    expect(replayPageHtml(kept(), unnamed)).toContain('<select id="speed"><option value="0.25">¼x</option><option value="0.5">½x</option>'
      + '<option value="1" selected>1x</option><option value="2">2x</option><option value="4">4x</option><option value="8">8x</option></select>');
  });

  it("takes the title its maker gave and their name, escaped; else its basis group, never the definition's name", () => {
    const file = kept();
    expect(replayPageTitle(file, unnamed)).toBe("Basis group 12002");
    expect(replayPageTitle(file, { title: file.name, credit: "" })).toBe("Basis group 12002");
    const html = replayPageHtml(file, { title: "<b>Scales</b>", credit: "Ada & co" });
    expect(html).toContain("<title>&lt;b&gt;Scales&lt;/b&gt;</title>");
    expect(html).not.toContain("<b>Scales</b>");
    expect(html).toContain('<p class="line">Basis group 12002 · one grid · 1,000 optimizer updates · by Ada &amp; co</p>');
    expect(replayPageHtml(file, unnamed)).toContain('<p class="line">Basis group 12002 · one grid · 1,000 optimizer updates</p>');
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

describe("the page's controls set the element's attributes", () => {
  afterEach(() => vi.unstubAllGlobals());

  function page({ webGpu = true } = {}) {
    const control = () => ({ value: "", textContent: "", disabled: false, onclick: () => {}, onchange: (_event: unknown) => {} });
    const controls = new Map(["#play", "#speed", "#seed", "#again", "#grid", "#download", "#status"].map((selector) => [selector, control()]));
    const attributes = new Map<string, string>();
    const automaton = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      toggleAttribute: (name: string) => {
        if (attributes.delete(name)) return false;
        attributes.set(name, "");
        return true;
      },
      restart: vi.fn(),
    };
    const tagName = automatonTagName(kept());
    vi.stubGlobal("document", { querySelector: (selector: string) => (selector === tagName ? automaton : controls.get(selector)) });
    vi.stubGlobal("navigator", { gpu: webGpu ? {} : undefined });
    runReplayPage(tagName, kept());
    return { controls, attributes, automaton };
  }

  it("pauses and plays, and sets the speed, the grid and the seed", () => {
    const { controls, attributes, automaton } = page();
    controls.get("#play")!.onclick();
    expect(attributes.has("paused")).toBe(true);
    expect(controls.get("#play")!.textContent).toBe("Play");
    controls.get("#play")!.onclick();
    expect(attributes.has("paused")).toBe(false);
    controls.get("#speed")!.onchange({ target: { value: "4" } });
    controls.get("#grid")!.onchange({ target: { value: "256" } });
    controls.get("#seed")!.value = "7";
    controls.get("#again")!.onclick();
    expect(Object.fromEntries(attributes)).toEqual({ speed: "4", cells: "256", seed: "7" });
    expect(automaton.restart).toHaveBeenCalledOnce();
  });

  it("says why it shows the still image, and disables what cannot apply", () => {
    const noWebGpu = page({ webGpu: false });
    expect(noWebGpu.controls.get("#status")!.textContent).toMatch(/no WebGPU/);
    expect(["#play", "#speed", "#again", "#grid"].map((selector) => noWebGpu.controls.get(selector)!.disabled)).toEqual([true, true, true, true]);
    expect(noWebGpu.controls.get("#download")!.disabled).toBe(false);
  });
});
