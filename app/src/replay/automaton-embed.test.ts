import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FigureMaterialFile } from "../materials/material-file";
import {
  automatonEmbed, automatonTagName, defineAutomatonElement, embeddedAutomaton, embedSnippet, type EmbeddedAutomaton,
} from "./automaton-embed";
import type { FigureReplay, FigureReplayOptions } from "./figure-replay";
import type { FigureShaderSources } from "./figure-shaders";
import type { ReplayLoop, ReplayLoopOptions } from "./replay-loop";

const kept = (): FigureMaterialFile => JSON.parse(readFileSync(
  new URL("../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8"));
const seedMaterial = (name: string): FigureMaterialFile => JSON.parse(readFileSync(
  new URL(`../../../gallery/seed/materials/${name}.material.json`, import.meta.url), "utf8"));
const unnamed = { title: "", credit: "" };

describe("the embed file", () => {
  it("names one element per automaton: its basis group and six hexadecimal digits of its id", () => {
    const file = kept();
    const tag = automatonTagName(file);
    expect(tag).toMatch(/^dinodreamer-12002-[0-9a-f]{6}$/);
    expect(automatonTagName(file)).toBe(tag);
    expect(automatonTagName({ ...file, id: `${file.id}-again` })).not.toBe(tag);
    const embed = automatonEmbed(file, unnamed);
    expect(embed).toMatchObject({ tagName: tag, fileName: `${tag}.js` });
  });

  it("holds the exact rule, the still image and the replay's settings, and loads nothing", () => {
    const file = seedMaterial("block-4009-figure-pyramid-strongest-seed-0");
    const { script } = automatonEmbed(file, unnamed);
    const automaton = JSON.parse(script.match(/const automaton = (.*);\n/)![1]) as EmbeddedAutomaton;
    expect(automaton).toEqual(embeddedAutomaton(file, unnamed));
    expect(automaton.rule).toBe(file.rule.values);
    expect(automaton.still).toBe(file.preview);
    expect(automaton).toMatchObject({ seed: file.reading.seed, cells: 128, grids: [128, 256], stillPixels: 128 });
    expect(script).toContain("const createReplay = async function createFigureReplay(");
    expect(script).toContain("function startReplayLoop(");
    expect(script).toContain('"pyramidPresent"');
    // The only addresses are in the header comment; the code fetches, imports and spawns nothing.
    const code = script.slice(script.indexOf("*/") + 2);
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).not.toMatch(/\bfetch\(|\bimport\s*[({"']|XMLHttpRequest|new Worker/);
    expect(code).not.toContain("</script");
    // It compiles as one classic script; compiling runs nothing.
    expect(() => new Script(script)).not.toThrow();
  });

  it("states who made it, how to place it, and its license, and never the research run's name", () => {
    const file = kept();
    const named = automatonEmbed(file, { title: "Scales", credit: "Ada" }).script;
    expect(named.split("\n")[1]).toBe(" * Scales: an automaton of basis group 12002, by Ada.");
    const research = automatonEmbed(file, { title: file.name, credit: "" }).script;
    expect(research.split("\n")[1]).toBe(" * Basis group 12002 · one grid · 1,000 optimizer updates.");
    expect(research).not.toContain(file.name);
    const tag = automatonTagName(file);
    expect(named).toContain(` *   <${tag}></${tag}>`);
    expect(named).toContain(" *   draw  visitors may draw on it with the pointer");
    expect(named).toContain(" * Copyright 2026 Omar Hammami, Apache License 2.0:\n * https://www.apache.org/licenses/LICENSE-2.0\n */");
  });

  it("keeps a title or a name inside the header comment, on one line", () => {
    const { script } = automatonEmbed(kept(), { title: "a */ b\nc", credit: "d\u2028e" });
    const header = script.slice(0, script.indexOf("*/") + 2);
    expect(header.split("\n")[1]).toBe(" * a * / b c: an automaton of basis group 12002, by d e.");
    expect(header.endsWith(" */")).toBe(true);
  });

  it("gives the two lines a visitor copies, with the file's own name, another address, or the draw attribute", () => {
    const embed = automatonEmbed(kept(), unnamed);
    expect(embedSnippet(embed)).toBe(`<script src="${embed.fileName}" defer></script>\n<${embed.tagName}></${embed.tagName}>`);
    expect(embedSnippet(embed, embed.fileName, { draw: true })).toBe(`<script src="${embed.fileName}" defer></script>\n<${embed.tagName} draw></${embed.tagName}>`);
    expect(embedSnippet(embed, "blob:x")).toMatch(/^<script src="blob:x" defer><\/script>\n/);
  });
});

/** A browser's custom-element surface, as small as the element uses. */
class FakePart {
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: unknown) => void>();
  width = 0;
  height = 0;
  clientWidth = 256;
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(type: string, listener: (event: unknown) => void) { this.listeners.set(type, listener); }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 256, height: 256 }; }
}
class FakeElement {
  attributes = new Map<string, string>();
  isConnected = false;
  still = new FakePart();
  canvas = new FakePart();
  attachShadow() {
    return { innerHTML: "", querySelector: (selector: string) => (selector === "div" ? this.still : this.canvas) };
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); this.changed(name); }
  removeAttribute(name: string) { this.attributes.delete(name); this.changed(name); }
  changed(name: string) { (this as unknown as { attributeChangedCallback(name: string): void }).attributeChangedCallback(name); }
}
interface ElementUnderTest extends FakeElement {
  connectedCallback(): void;
  disconnectedCallback(): void;
  restart(): void;
}

describe("the element", () => {
  let observers: { resize: ((records: unknown[]) => void)[]; view: ((records: unknown[]) => void)[] };
  let defined: Map<string, new () => ElementUnderTest>;
  let reducedMotion: boolean;
  let webGpu: boolean;
  let starts: { options: FigureReplayOptions; resolve: (replay: FigureReplay) => void; reject: (error: Error) => void }[];
  let loops: { options: ReplayLoopOptions; loop: Record<string, ReturnType<typeof vi.fn>> }[];
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    observers = { resize: [], view: [] };
    defined = new Map();
    reducedMotion = false;
    webGpu = true;
    starts = [];
    loops = [];
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("customElements", { get: (name: string) => defined.get(name), define: (name: string, type: new () => ElementUnderTest) => defined.set(name, type) });
    vi.stubGlobal("matchMedia", () => ({ get matches() { return reducedMotion; }, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("navigator", new Proxy({}, { has: (_target, key) => key === "gpu" && webGpu }));
    vi.stubGlobal("devicePixelRatio", 2);
    vi.stubGlobal("ResizeObserver", class { constructor(callback: (records: unknown[]) => void) { observers.resize.push(callback); } observe() {} disconnect() {} });
    vi.stubGlobal("IntersectionObserver", class { constructor(callback: (records: unknown[]) => void) { observers.view.push(callback); } observe() {} disconnect() {} });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  const settle = async () => { for (let turn = 0; turn < 5; turn++) await Promise.resolve(); };
  const replayDouble = (seed = 1) => ({ seed, setScale: vi.fn(), setTiled: vi.fn(), dispose: vi.fn() }) as unknown as FigureReplay & Record<string, ReturnType<typeof vi.fn>>;
  /** The element for one file, connected, in view or not, and measured at `width` × `height` device pixels. */
  function place(file: FigureMaterialFile, { inView = true, width = 512, height = 512, attributes = {} as Record<string, string> } = {}) {
    const create = (options: FigureReplayOptions) => new Promise<FigureReplay>((resolve, reject) => starts.push({ options, resolve, reject }));
    const start = (_replay: FigureReplay, options: ReplayLoopOptions) => {
      const loop = { play: vi.fn(), pause: vi.fn(), redraw: vi.fn(), reseed: vi.fn(), setStepsPerSecond: vi.fn(), stop: vi.fn(), stroke: vi.fn() };
      loops.push({ options, loop });
      return loop as unknown as ReplayLoop;
    };
    const tag = automatonTagName(file);
    defineAutomatonElement(tag, embeddedAutomaton(file, unnamed), create, start, {} as FigureShaderSources);
    const element = new (defined.get(tag)!)();
    for (const [name, value] of Object.entries(attributes)) element.attributes.set(name, value);
    element.isConnected = true;
    element.connectedCallback();
    observers.resize.at(-1)!([{ devicePixelContentBoxSize: [{ inlineSize: width, blockSize: height }], contentRect: { width: width / 2, height: height / 2 } }]);
    observers.view.at(-1)!([{ isIntersecting: inView }]);
    return element;
  }

  it("grows only in view, tiled at whole device pixels per cell, and pauses out of view", async () => {
    const element = place(kept(), { inView: false, width: 900, height: 512 });
    expect(starts).toHaveLength(0);
    expect(element.still.style.backgroundImage).toContain("data:image/png;base64,");
    observers.view.at(-1)!([{ isIntersecting: true }]);
    expect(starts).toHaveLength(1);
    // 512 device pixels hold a 128-cell grid at 4 pixels a cell; the wider side repeats it.
    expect(starts[0].options).toMatchObject({ side: 128, seed: kept().reading.seed, scale: 4, tiled: { width: 900, height: 512, scale: 4 } });
    starts[0].resolve(replayDouble(kept().reading.seed));
    await settle();
    expect(loops[0].options).toMatchObject({ stepsPerSecond: 60, playing: false });
    expect(loops[0].loop.play).toHaveBeenCalled();
    observers.view.at(-1)!([{ isIntersecting: false }]);
    expect(loops[0].loop.pause).toHaveBeenCalled();
  });

  it("draws a 2 px automaton at whole pixels per picture pixel, and its still image at the same size", () => {
    const element = place(seedMaterial("block-4009-figure-2px-strongest-seed-0"), { width: 600, height: 600 });
    // 600 device pixels hold the 128-pixel picture 4 times over: 4 pixels a picture pixel, 8 a cell.
    expect(starts[0].options).toMatchObject({ side: 64, scale: 8, pixelsPerCell: 2 });
    // 128 picture pixels × 4 device pixels, at 600 device pixels per 256 CSS pixels.
    expect(element.still.style.backgroundSize).toBe(`${128 * 4 / (600 / 256)}px`);
  });

  it("shows the still image without WebGPU, with reduced motion, and while paused before it ever played", async () => {
    webGpu = false;
    place(kept());
    reducedMotion = true;
    webGpu = true;
    place(kept());
    reducedMotion = false;
    const paused = place(kept(), { attributes: { paused: "" } });
    expect(starts).toHaveLength(0);
    paused.removeAttribute("paused");
    expect(starts).toHaveLength(1);
  });

  it("takes its seed, speed and grid from attributes, and ignores values it cannot use", async () => {
    const element = place(kept(), { attributes: { seed: "7", speed: "2", cells: "256" } });
    expect(starts[0].options).toMatchObject({ seed: 7, side: 256 });
    starts[0].resolve(replayDouble(7));
    await settle();
    expect(loops[0].options.stepsPerSecond).toBe(120);
    element.setAttribute("speed", "100");
    expect(loops[0].loop.setStepsPerSecond).toHaveBeenLastCalledWith(60);
    element.setAttribute("seed", "-1");
    expect(loops[0].loop.reseed).toHaveBeenLastCalledWith(kept().reading.seed);
    element.restart();
    expect(loops[0].loop.reseed).toHaveBeenCalledTimes(2);
    // Another grid is another replay.
    element.setAttribute("cells", "128");
    expect(loops[0].loop.stop).toHaveBeenCalled();
    expect(starts).toHaveLength(2);
    expect(starts[1].options).toMatchObject({ side: 128 });
  });

  it("releases its replay when it leaves the page, and a late start is released on arrival", async () => {
    const element = place(kept());
    element.disconnectedCallback();
    expect(starts[0].options.signal?.aborted).toBe(true);
    const late = replayDouble();
    starts[0].resolve(late);
    await settle();
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(loops).toHaveLength(0);
  });

  it("falls back to the still image for good when the replay fails, and says why in the console", async () => {
    const element = place(kept());
    starts[0].reject(new Error("No WebGPU adapter is available."));
    await settle();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("No WebGPU adapter is available."));
    expect(element.canvas.style.visibility).toBe("hidden");
    observers.view.at(-1)!([{ isIntersecting: true }]);
    expect(starts).toHaveLength(1);
  });

  it("draws only when the host allows it, along the pointer's path on the torus", async () => {
    const element = place(kept());
    starts[0].resolve(replayDouble(kept().reading.seed));
    await settle();
    element.canvas.width = 512;
    const pointer = (type: string, x: number, y: number) => element.canvas.listeners.get(type)!({ pointerId: 1, clientX: x, clientY: y });
    pointer("pointerdown", 10, 10);
    pointer("pointermove", 20, 10);
    expect(loops[0].loop.stroke).not.toHaveBeenCalled();
    element.attributes.set("draw", "");
    // 256 CSS pixels hold 512 canvas pixels at 4 a cell: a CSS pixel is half a cell.
    pointer("pointerdown", 10, 10);
    pointer("pointermove", 20, 10);
    expect(loops[0].loop.stroke).toHaveBeenCalledWith(5, 5, 10, 5, 12);
  });
});
