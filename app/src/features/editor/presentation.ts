// Display conventions shared by the canvas, the cards and the columns. Inks: what the
// visitor painted, one per request. The accent: what the model does. Black: veiled.

import type { OptimizerScale, OptimizerStep, Token } from "../../recipe";
import type { InkPair } from "./inks";
import { tokenLabel as slotTokenLabel } from "../../library/roles";
import { cssColour } from "../../ui/css-colour";

/**
 * The editor's colours are the CSS tokens of styles.css, so the
 * canvas and the interface cannot drift apart. Each value is the token's computed
 * colour string, which both DOM styles and a canvas accept. The fallbacks are the
 * nearest sRGB of the same colours, for tests (no document) and a missing sheet.
 */
const PALETTE_TOKENS = {
  /** One ink per request position, green, amber, azure, rose; the canvas holds at most four requests. */
  inks: [
    ["--paint-1", "#3fac4a"],
    ["--paint-2", "#c28412"],
    ["--paint-3", "#0aa0d2"],
    ["--paint-4", "#e45d84"],
  ],
  /** Each ink's Appearance tone: a request's Appearance area is drawn in it, its Code area in the ink. */
  looks: [
    ["--paint-1-look", "#3cf0cb"],
    ["--paint-2-look", "#e0d653"],
    ["--paint-3-look", "#b9d2fc"],
    ["--paint-4-look", "#fec0b0"],
  ],
  /** Measured things drawn on the dark interface: the pointer's cell, the token's code. */
  measure: ["--measure", "#efece8"],
  /** What acts or is acted on, and the terms of the whole image: the ink (the language has no fixed accent). */
  ask: ["--ink", "#efece8"],
  muted: ["--ink-2", "#9c9994"],
  /** Context drawn behind the request: a block's recorded codes. */
  faint: ["--ink-3", "#5e5b57"],
  /** The page ground: veils over cells and source windows. */
  ground: ["--black", "#000000"],
  line: ["--line", "#242424"],
  /** Thin light strokes over the image: Protect's hatch and the cell grid. */
  text: ["--ink", "#efece8"],
} as const;

type TokenName = Exclude<keyof typeof PALETTE_TOKENS, "inks" | "looks">;
export type Palette = { inks: readonly string[]; looks: readonly string[] } & Record<TokenName, string>;

let cachedPalette: Palette | undefined;

/** The colours, read from the tokens once the editor's stylesheet has loaded. */
export function palette(): Palette {
  if (cachedPalette) return cachedPalette;
  const hasDocument = typeof document !== "undefined";
  const read = ([name, fallback]: readonly [`--${string}`, string]) => (hasDocument ? cssColour(name, fallback) : fallback);
  const colours: Palette = {
    inks: PALETTE_TOKENS.inks.map(read),
    looks: PALETTE_TOKENS.looks.map(read),
    measure: read(PALETTE_TOKENS.measure),
    ask: read(PALETTE_TOKENS.ask),
    muted: read(PALETTE_TOKENS.muted),
    faint: read(PALETTE_TOKENS.faint),
    ground: read(PALETTE_TOKENS.ground),
    line: read(PALETTE_TOKENS.line),
    text: read(PALETTE_TOKENS.text),
  };
  // Keep the values only once the inks come from the stylesheet, not from the fallbacks.
  const inksLoaded = hasDocument && cssColour("--paint-1", "") !== "";
  if (inksLoaded) cachedPalette = colours;
  return colours;
}

/**
 * One name and one plain sentence per term, named by what the term is: Response is the
 * response-vector error of a basis group, Appearance the
 * reference-appearance error. The sentence shows under a selected term only, in muted type.
 */
export const TERM_TEXT = {
  respond: { name: "Response", definition: "distance of these cells' response vectors to the token's response vector" },
  /** Response of a CLS or storage constraint, which has no area: the image's own token of that kind is measured. */
  respondPrefix: { name: "Response", definition: "distance of the image's matching token's response vector to the token's response vector" },
  look: {
    name: "Appearance",
    definition: "these cells take the look of the reference windows: the same channel statistics at four depths",
  },
  tv: { name: "Smoothness", definition: "penalize large differences between neighboring pixels" },
  l2: { name: "Restraint", definition: "pull every pixel toward the average color of DINO's training images" },
} as const;

/**
 * The card's "basis groups" stepper: its name, explanation, and why it cannot
 * ask more basis groups when the library has no selected-response files (the line then shows only
 * for a configuration that asks more than one) or the token's selected responses did not load.
 */
export const BLOCKS_TEXT = {
  name: "basis groups",
  definition:
    "How many of this token's basis groups to ask for. Every token is described by its 32 selected basis groups: 1 asks for this basis group alone, 32 for the whole token as it was recorded. More basis groups copy more of the token and leave less to the picture.",
  unavailable: "This library does not publish the tokens' 32 basis groups, so this constraint can ask fewer basis groups, not more.",
  failed: "The token's basis groups did not load, so the constraint cannot ask for more basis groups now.",
} as const;

/**
 * The brush's input in words: the tooltip of the brush control. The dock
 * floats over a scrolling page, so its wheel resizes only while a button is held. A touch
 * screen has no buttons and no wheel.
 */
export const BRUSH_HINT = {
  fine: "left paints, right erases, wheel resizes",
  dock: "left paints, right erases, wheel resizes while painting",
  coarse: "a finger paints; Erase makes it erase",
  /** Noise re-seeds what it paints; erasing has no meaning for it (noise.ts), so the hint does not offer it. */
  noise: "left re-seeds, wheel resizes",
  noiseDock: "left re-seeds, wheel resizes while painting",
  noiseCoarse: "a finger re-seeds",
  held: "left paints, wheel resizes",
  heldDock: "left paints, wheel resizes while painting",
  heldCoarse: "a finger paints",
} as const;

/**
 * What the brush's size and opacity mean, in the card's "?" and under the dock's brush: on a
 * touch screen there is no tooltip, so these words are the definition.
 */
export const BRUSH_HELP = "Size sets the brush's reach. Opacity sets the strength one stroke adds at its center. Separate strokes add coats. Erase subtracts strength.";

/**
 * A Gallery entry the visitor has not changed (the gallery rule, state.ts): the line over its
 * title, which reads as "from the gallery: doggy ear", and the rule in words for the line's
 * tooltip and the title's description.
 */
export const FROM_GALLERY = {
  label: "from the gallery:",
  rule: "Not in Saved images until you change it: a stroke, a drop, a run or a new title. Unchanged, it is not saved when you leave.",
} as const;

/** Noise is not a term: a stroke re-seeds the image under its cells (protocol.ts reseed). */
export const NOISE_TEXT = {
  name: "Noise",
  definition: "painted cells start again from fresh noise, and the engine grows them anew",
} as const;

/** Motion is not a term: it moves the image between updates (recipe.motion). */
export const MOTION_TEXT = {
  name: "Zoom",
  definition: "every optimizer update, the image is scaled up by this fraction about its center, like DeepDream's zoom",
} as const;

/**
 * Labels and explanations for recipe.optimizer, shared by the run controls.
 */
export const RUN_SETTING_TEXT = {
  step: {
    name: "stride",
    explanation:
      "How big each optimizer update's step is. A longer stride reaches the requested response vector sooner and changes more of the picture on the way; a shorter one keeps more of the starting picture.",
  },
  /** The recipe's `scale`, called detail on the Canvas (DETAIL_POSITIONS). */
  scale: {
    name: "detail",
    explanation: "How fine the change is. Fine can change single pixels; coarse changes mostly broad areas of color and tone.",
  },
  robustView: {
    name: "far view",
    explanation:
      "Each optimizer update measures the image twice, as it is and shifted. Far view blurs the shifted measurement by one pixel, so the constraints you paint also hold when the picture is seen smaller or from farther away. About a quarter more updates.",
  },
} as const;

/** The stride's positions: a half, one, two and four times the default step 0.025, each one glyph wide. */
export const STRIDE_POSITIONS: readonly { step: OptimizerStep; glyph: string; spoken: string }[] = [
  { step: 0.0125, glyph: "½", spoken: "one half" },
  { step: 0.025, glyph: "1", spoken: "1" },
  { step: 0.05, glyph: "2", spoken: "2" },
  { step: 0.1, glyph: "4", spoken: "4" },
];

/** Detail's positions by the recipe's `scale` value: the recipe keeps "even" and "coarse" (no format change). */
export const DETAIL_POSITIONS: Record<OptimizerScale, string> = { even: "fine", coarse: "coarse" };

/**
 * The colour picker's words: the dialog's head and its context
 * line, the pair's names, the free colour, and each swatch's name for assistive technology.
 */
export const INK_PICKER_TEXT = {
  title: "Colour",
  context: { request: "Response and Appearance", respond: "Response", look: "Appearance" },
  code: "Response",
  look: "Appearance",
  derived: "Appearance, from it",
  free: "any color",
  default: "Default",
  close: "Close",
  palette: "Colours",
} as const;

/** A swatch's accessible name: the constraint's colour while its lock is closed, else one term's. */
export function inkSwatchName(target: "request" | "respond" | "look", name: string): string {
  if (target === "request") return `Colour of this constraint: ${name}; Appearance follows`;
  return `${target === "look" ? "Appearance" : "Response"} colour: ${name}`;
}

/**
 * The palette's pairs by request position, from the stylesheet's tokens (--paint-N, --paint-N-look):
 * the defaults of inks.ts inkTable, which every screen reads a request's tones from.
 */
export function defaultInkPairs(): InkPair[] {
  const { inks, looks } = palette();
  return inks.map((code, index) => ({ code, look: looks[index]! }));
}

/** One wording with the block page: "patch (row, column)", "CLS token", "Storage 2 token". */
export function tokenLabel(token: Token): string {
  return slotTokenLabel(token.slot);
}

/** Readout numbers: two decimals in the usual range, two significant figures below 0.01. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0";
  if (magnitude < 0.01) return value.toPrecision(2);
  if (magnitude < 100) return value.toFixed(2);
  return value.toFixed(0);
}
