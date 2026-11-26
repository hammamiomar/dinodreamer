import { figurePlayback, readingPictureSide, replayGridSides, type FigureMaterialFile, type FigurePlayback } from "../materials/material-file";
import { createFigureReplay, type FigureReplay, type FigureReplayOptions, type FigureRule } from "./figure-replay";
import { FIGURE_SHADERS, type FigureShaderSources } from "./figure-shaders";
import { materialLine, ownTitle } from "./material-facts";
import { REPLAY_SPEEDS, startReplayLoop, type ReplayLoop, type ReplayLoopOptions } from "./replay-loop";

// The embed: one JavaScript file that puts one automaton on any web page. The file holds the rule,
// the still image, the replay (figure-replay.ts), its loop (replay-loop.ts) and the shaders, and it
// loads nothing. When it runs, it defines one custom element. The element is only a canvas: the host
// page's CSS gives it its size and shape, and attributes set the seed, the speed, the grid and
// whether a visitor may draw on it. The downloaded page (replay-page.ts) is a plain page around the
// same element.

/** What the element needs of one automaton. The embed file holds it as JSON. */
export interface EmbeddedAutomaton {
  /** The rule's float32 values, little-endian, in base64, exactly as the definition stores them. */
  rule: string;
  fireRate: number;
  playback: FigurePlayback;
  /** The still image: the definition's saved frame, a PNG data URL of `stillPixels` pixels a side. */
  still: string;
  stillPixels: number;
  /** The seed and the grid (cells a side) the element grows from when no attribute names others. */
  seed: number;
  cells: number;
  /** The grids the `cells` attribute may name. */
  grids: number[];
  /** The canvas's accessible name. */
  label: string;
}

/** The embed file of one automaton, and the element it defines. */
export interface AutomatonEmbed {
  /** The custom element's name, such as "dinodreamer-2632-3fa9c1". */
  tagName: string;
  /** The file name: the tag name with ".js". */
  fileName: string;
  /** The whole file. */
  script: string;
}

/** Who made a published automaton: the gallery entry's title and credit, each "" when not given. */
export interface AutomatonMaker {
  title: string;
  credit: string;
}

/** The attributes the element reads. */
export const EMBED_ATTRIBUTES = ["seed", "speed", "cells", "draw", "paused"] as const;

/**
 * Defines the custom element `tagName` for one automaton. Like the replay and the loop, it has no
 * runtime imports and no enclosing values: the embed file and the downloaded page carry its source.
 *
 * The element grows the automaton only while it is in view, and releases the GPU when it leaves the
 * page. It shows the still image instead when the browser has no WebGPU, when the visitor asks for
 * reduced motion, when it is paused before its first frame, and after the replay fails.
 */
export function defineAutomatonElement(
  tagName: string,
  automaton: EmbeddedAutomaton,
  createReplay: (options: FigureReplayOptions, rule: FigureRule, shaders: FigureShaderSources) => Promise<FigureReplay>,
  startLoop: (replay: FigureReplay, options: ReplayLoopOptions) => ReplayLoop,
  shaders: FigureShaderSources,
): void {
  if (customElements.get(tagName)) return;
  // Speed 1 is the site's pace: 60 steps a second, whatever the screen's refresh rate.
  const STEPS_PER_SECOND = 60;
  const SLOWEST = 0.25;
  const FASTEST = 8;
  // The brush's radius: 12 cells of a 128-cell grid, the Automata page's default brush.
  const BRUSH_CELLS_PER_128 = 12;
  // The replay draws 1 to 16 canvas pixels per cell, on a canvas of at most 8,192 pixels a side.
  const MOST_PIXELS_PER_CELL = 16;
  const MOST_CANVAS_PIXELS = 8192;
  // Without host CSS the element is a 256-pixel square. The grid is a torus, so a box of another
  // shape shows it repeated. The still image is the box's background, under the canvas.
  const STYLE = ":host{display:block;position:relative;width:256px;aspect-ratio:1;overflow:hidden}"
    + ":host([hidden]){display:none}"
    + "div,canvas{position:absolute;inset:0;width:100%;height:100%}"
    + "div{background-repeat:repeat;image-rendering:pixelated}"
    + "canvas{display:block;visibility:hidden}"
    + ":host([draw]) canvas{touch-action:none;cursor:crosshair}";
  const bytes = Uint8Array.from(atob(automaton.rule), (character) => character.charCodeAt(0));
  const rule: FigureRule = { values: new Float32Array(bytes.buffer), fireRate: automaton.fireRate };
  const pixelsPerCell = automaton.playback.pixelsPerCell;
  const number = (text: string | null) => (text === null || text.trim() === "" ? Number.NaN : Number(text));

  class AutomatonElement extends HTMLElement {
    static observedAttributes = ["seed", "speed", "cells", "draw", "paused"];
    #canvas: HTMLCanvasElement;
    #still: HTMLElement;
    #replay: FigureReplay | null = null;
    #loop: ReplayLoop | null = null;
    #starting: AbortController | null = null;
    /** The canvas's size in device pixels, as the resize observer last measured it. */
    #box: { width: number; height: number } | null = null;
    /** Canvas pixels per cell of the open replay, for the brush. */
    #scale = 1;
    #inView = false;
    /** Why the replay stopped for good; the element then shows its still image. */
    #failure: string | null = null;
    #last: { x: number; y: number } | null = null;
    #resize = new ResizeObserver((records) => {
      const record = records[records.length - 1]!;
      const device = record.devicePixelContentBoxSize?.[0];
      this.#box = device
        ? { width: device.inlineSize, height: device.blockSize }
        : { width: Math.round(record.contentRect.width * devicePixelRatio), height: Math.round(record.contentRect.height * devicePixelRatio) };
      this.#fit();
      this.#update();
    });
    #view = new IntersectionObserver((records) => {
      this.#inView = records[records.length - 1]!.isIntersecting;
      this.#update();
    });

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>${STYLE}</style><div></div><canvas></canvas>`;
      this.#still = root.querySelector("div")!;
      this.#canvas = root.querySelector("canvas")!;
      this.#still.style.backgroundImage = `url("${automaton.still}")`;
      this.#canvas.setAttribute("role", "img");
      this.#canvas.setAttribute("aria-label", automaton.label);
      // A drag stamps soft discs along its path; holding still stamps nothing.
      this.#canvas.addEventListener("pointerdown", (event) => {
        if (!this.hasAttribute("draw") || !this.#loop) return;
        this.#canvas.setPointerCapture(event.pointerId);
        this.#last = this.#cellAt(event);
      });
      this.#canvas.addEventListener("pointermove", (event) => {
        if (!this.#last || !this.#loop || !this.hasAttribute("draw")) return;
        const next = this.#cellAt(event);
        const side = this.#cells();
        // The two places, moved together by whole grids so the first lies on the grid: the brush
        // measures distance on the torus, so a short stroke stays short.
        const shiftX = Math.floor(this.#last.x / side) * side;
        const shiftY = Math.floor(this.#last.y / side) * side;
        const radius = BRUSH_CELLS_PER_128 * side / 128;
        this.#loop.stroke(this.#last.x - shiftX, this.#last.y - shiftY, next.x - shiftX, next.y - shiftY, radius);
        this.#last = next;
      });
      const lift = () => { this.#last = null; };
      this.#canvas.addEventListener("pointerup", lift);
      this.#canvas.addEventListener("pointercancel", lift);
    }

    connectedCallback() {
      try {
        this.#resize.observe(this.#canvas, { box: "device-pixel-content-box" });
      } catch {
        this.#resize.observe(this.#canvas);
      }
      this.#view.observe(this);
      this.#update();
    }

    disconnectedCallback() {
      this.#resize.disconnect();
      this.#view.disconnect();
      this.#inView = false;
      this.#close();
    }

    attributeChangedCallback(name: string) {
      if (!this.isConnected) return;
      if (name === "cells") {
        this.#close();
        this.#fit();
        this.#update();
      } else if (name === "seed") {
        this.#loop?.reseed(this.#seed());
      } else if (name === "speed") {
        this.#loop?.setStepsPerSecond(STEPS_PER_SECOND * this.#speed());
      } else if (name === "paused") {
        this.#update();
      }
    }

    /** Grow again from the seed's start, at step 0. */
    restart() {
      this.#loop?.reseed(this.#seed());
    }

    #seed() {
      const value = number(this.getAttribute("seed"));
      return Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value : automaton.seed;
    }

    #speed() {
      const value = number(this.getAttribute("speed"));
      return value >= SLOWEST && value <= FASTEST ? value : 1;
    }

    #cells() {
      const value = number(this.getAttribute("cells"));
      return automaton.grids.includes(value) ? value : automaton.cells;
    }

    /**
     * The tiled canvas for the measured box: whole device pixels per picture pixel, as many as let one
     * picture fit the box's shorter side, so a whole grid always shows.
     */
    #tiled(side: number) {
      const width = Math.min(MOST_CANVAS_PIXELS, Math.max(1, this.#box?.width ?? 1));
      const height = Math.min(MOST_CANVAS_PIXELS, Math.max(1, this.#box?.height ?? 1));
      const fitting = Math.floor(Math.min(width, height) / (side * pixelsPerCell));
      const perPicturePixel = Math.min(Math.floor(MOST_PIXELS_PER_CELL / pixelsPerCell), Math.max(1, fitting));
      return { width, height, scale: perPicturePixel * pixelsPerCell, perPicturePixel };
    }

    /** Fits the still image and an open replay to the box. */
    #fit() {
      const tiled = this.#tiled(this.#cells());
      const ratio = this.#box && this.#canvas.clientWidth > 0 ? this.#box.width / this.#canvas.clientWidth : devicePixelRatio;
      this.#still.style.backgroundSize = `${automaton.stillPixels * tiled.perPicturePixel / ratio}px`;
      if (!this.#replay) return;
      this.#replay.setScale(tiled.scale);
      this.#replay.setTiled(tiled);
      this.#scale = tiled.scale;
      this.#loop?.redraw();
    }

    #cellAt(event: PointerEvent) {
      const box = this.#canvas.getBoundingClientRect();
      const perCssPixel = this.#canvas.width / box.width;
      return {
        x: (event.clientX - box.left) * perCssPixel / this.#scale,
        y: (event.clientY - box.top) * perCssPixel / this.#scale,
      };
    }

    /** The one rule for what the element shows: the still image, a paused replay or a growing one. */
    #update() {
      const still = this.#failure !== null || !("gpu" in navigator);
      if (still) {
        this.#close();
        return;
      }
      if (!this.#inView || this.#box === null) {
        this.#loop?.pause();
        return;
      }
      const paused = this.hasAttribute("paused");
      if (this.#replay === null) {
        // A replay that has never played would show its start; the still image stays until it plays.
        if (!paused && this.#starting === null) void this.#open();
        return;
      }
      if (paused) this.#loop?.pause();
      else this.#loop?.play();
    }

    async #open() {
      const starting = new AbortController();
      this.#starting = starting;
      const side = this.#cells();
      const tiled = this.#tiled(side);
      try {
        const replay = await createReplay({
          canvas: this.#canvas, side, seed: this.#seed(), scale: tiled.scale, tiled, ...automaton.playback,
          onDeviceLost: (message) => this.#fail(message), signal: starting.signal,
        }, rule, shaders);
        if (starting.signal.aborted) {
          replay.dispose();
          return;
        }
        this.#starting = null;
        this.#replay = replay;
        this.#scale = tiled.scale;
        this.#loop = startLoop(replay, {
          speed: 1, stepsPerSecond: STEPS_PER_SECOND * this.#speed(), playing: false,
          onFrame: () => { this.#canvas.style.visibility = "visible"; },
          onError: (error) => this.#fail(error),
        });
        // The box or the seed may have changed while the replay started.
        this.#fit();
        if (replay.seed !== this.#seed()) this.#loop.reseed(this.#seed());
        this.#update();
      } catch (error) {
        if (!starting.signal.aborted) this.#fail(error);
      }
    }

    #fail(error: unknown) {
      this.#failure = error instanceof Error ? error.message : String(error);
      console.warn(`<${tagName}> shows its still image: ${this.#failure}`);
      this.#update();
    }

    #close() {
      this.#starting?.abort();
      this.#starting = null;
      this.#loop?.stop();
      this.#replay?.dispose();
      this.#loop = null;
      this.#replay = null;
      this.#last = null;
      this.#canvas.style.visibility = "hidden";
    }
  }
  customElements.define(tagName, AutomatonElement);
}

/** JSON in a script: no "<", so no "</script>", and not the two line separators older parsers reject. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** What the element needs of a definition. */
export function embeddedAutomaton(file: FigureMaterialFile, maker: AutomatonMaker): EmbeddedAutomaton {
  const grids = replayGridSides(file);
  const title = ownTitle(maker.title, file);
  return {
    rule: file.rule.values,
    fireRate: file.rule.fireRate,
    playback: figurePlayback(file),
    still: file.preview,
    stillPixels: readingPictureSide(file),
    seed: file.reading.seed,
    cells: grids.includes(file.reading.side) ? file.reading.side : grids[0]!,
    grids,
    label: title === "" ? `An automaton of basis group ${file.block}` : `${title}, an automaton of basis group ${file.block}`,
  };
}

/**
 * The element's name: the basis group and six hexadecimal digits of the definition's id (FNV-1a),
 * so that each automaton has its own element and several can share a page.
 */
export function automatonTagName(file: Pick<FigureMaterialFile, "id" | "block">): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < file.id.length; index++) {
    hash ^= file.id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `dinodreamer-${file.block}-${hash.toString(16).padStart(8, "0").slice(0, 6)}`;
}

/** A text for a comment: no comment end, one line. */
const commentText = (text: string) => text.replace(/\*\//g, "* /").replace(/[\r\n\u2028\u2029]+/g, " ");

/** The file's license, at the end of its header: the whole file, rule, image and code, is open. */
const EMBED_LICENSE = [
  "Copyright 2026 Omar Hammami, Apache License 2.0:",
  "https://www.apache.org/licenses/LICENSE-2.0",
];

/**
 * The file's first lines: what it is, who made it, how to place it, and the license. With no title
 * from its maker, the first line is the site's line for the automaton, never the definition's name.
 */
function embedHeader(file: FigureMaterialFile, maker: AutomatonMaker, tagName: string, automaton: EmbeddedAutomaton): string {
  const title = ownTitle(maker.title, file);
  const named = title === "" ? materialLine(file) : `${title}: an automaton of basis group ${file.block}`;
  const by = maker.credit === "" ? "" : `, by ${maker.credit}`;
  const speeds = `${REPLAY_SPEEDS[0]} to ${REPLAY_SPEEDS[REPLAY_SPEEDS.length - 1]}`;
  return [
    "/*",
    ` * ${commentText(named + by)}.`,
    " * Made with DinoDreamer: https://dinodreamer.computervision.vision",
    " *",
    " * Load this file once with a deferred script element. Then put this element where the automaton shows:",
    ` *   <${tagName}></${tagName}>`,
    " * Give it a size with CSS, as for an image. Without CSS it is 256 pixels square.",
    " * A box that is not square shows the automaton repeated.",
    " * Attributes, all optional:",
    ` *   seed="${automaton.seed}"  a whole number; each seed grows another variation`,
    ` *   speed="1"  ${speeds}; 1 is 60 steps a second`,
    ` *   cells="${automaton.cells}"  the grid, ${automaton.grids.join(" or ")} cells a side`,
    " *   draw  visitors may draw on it with the pointer",
    " *   paused  it does not grow",
    " * It grows with WebGPU and loads nothing. Without WebGPU, or when the visitor asks for",
    " * reduced motion, it shows its still image.",
    " *",
    ...EMBED_LICENSE.map((line) => ` * ${line}`),
    " */",
  ].join("\n");
}

/** The embed file of one automaton: a classic script that defines its element when it runs. */
export function automatonEmbed(file: FigureMaterialFile, maker: AutomatonMaker): AutomatonEmbed {
  const tagName = automatonTagName(file);
  const automaton = embeddedAutomaton(file, maker);
  const script = `${embedHeader(file, maker, tagName, automaton)}
(() => {
const createReplay = ${createFigureReplay.toString()};
const startLoop = ${startReplayLoop.toString()};
const shaders = ${scriptJson(FIGURE_SHADERS)};
const automaton = ${scriptJson(automaton)};
(${defineAutomatonElement.toString()})(${scriptJson(tagName)}, automaton, createReplay, startLoop, shaders);
})();
`;
  return { tagName, fileName: `${tagName}.js`, script };
}

/** The two lines a visitor puts on their page: the script, deferred so that it never holds up the page, then the element. */
export function embedSnippet(
  embed: Pick<AutomatonEmbed, "tagName" | "fileName">,
  src = embed.fileName,
  options?: { draw?: boolean },
): string {
  const attributes = options?.draw ? " draw" : "";
  return `<script src="${src}" defer></script>\n<${embed.tagName}${attributes}></${embed.tagName}>`;
}
