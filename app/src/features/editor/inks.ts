// The requests' inks: each request draws its Code field in its ink and its Appearance field
// in a lighter tone of a turned hue. By default a request
// takes the palette's tones by its position (styles.css --paint-N and --paint-N-look). The
// visitor can pick other colours (the picker on the request card); the picks live with the
// creation (editor state, the Saved record), never in the recipe.
//
// While the request's lock is closed, one pick colours the request: the Appearance tone is
// derived from the Code ink (`deriveLook`). While the lock is open, each term takes its own
// pick. Closing the lock drops a separate Appearance pick, so the tone follows the ink again
// and opening the lock later keeps the pair that was showing. "Default" clears a pick.
//
// Every consumer reads a request's tones from one table (`inkTable`), built once from the
// recipe, the picks and the lock states.

import type { Recipe } from "../../recipe";
import type { AreaTerm } from "./model";

/** A colour in OKLCH: lightness from 0 to 1, chroma, hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** A request's two tones, as CSS colours. */
export interface InkPair {
  /** The Code field's ink, also the card's and the row's. */
  code: string;
  /** The Appearance field's tone. */
  look: string;
}

/** The visitor's picks for one request; a missing tone is the default. */
export interface InkChoice {
  code?: string;
  look?: string;
}

/** The picks by request id. */
export type InkChoices = Readonly<Record<number, InkChoice>>;

/** What a pick colours: the whole request while its lock is closed, else one term. */
export type InkTarget = "request" | AreaTerm;

export const NO_INK_CHOICES: InkChoices = {};

/** Every request's tones by id, with the default pairs by position for requests still to come. */
export interface InkTable {
  pairs: ReadonlyMap<number, InkPair>;
  /** The default pairs by request position: the palette's four, repeated. */
  defaults: readonly InkPair[];
}

/**
 * The derive rule: the Appearance tone is lighter (L 0.86) with the hue
 * turned by 30°. Its chroma starts at 0.15 and drops in 0.005 steps until the colour is inside
 * sRGB, which is how the palette's pairs were made. A near-grey ink (chroma under 0.02, no
 * real hue) gives a light grey of the same small chroma and hue.
 */
export const LOOK_RULE = { lightness: 0.86, turn: 30, chroma: 0.15, step: 0.005, grey: 0.02 } as const;

/** The twelve colours of the picker: the Code rule (L 0.66, chroma as high as sRGB allows up to 0.17) at twelve hues outside the accent's band. */
export const INK_PALETTE: readonly { name: string; code: string }[] = [
  { name: "rose", code: "oklch(66% 0.170 5)" },
  { name: "coral", code: "oklch(66% 0.170 30)" },
  { name: "orange", code: "oklch(66% 0.160 55)" },
  { name: "amber", code: "oklch(66% 0.135 75)" },
  { name: "olive", code: "oklch(66% 0.135 100)" },
  { name: "lime", code: "oklch(66% 0.165 125)" },
  { name: "green", code: "oklch(66% 0.170 145)" },
  { name: "teal", code: "oklch(66% 0.120 175)" },
  { name: "cyan", code: "oklch(66% 0.110 200)" },
  { name: "azure", code: "oklch(66% 0.130 230)" },
  { name: "blue", code: "oklch(66% 0.170 250)" },
  { name: "pink", code: "oklch(66% 0.170 340)" },
];

/**
 * Names of the twelve Appearance tones, in INK_PALETTE's order, for assistive technology: what
 * the eye sees at L 86 %; "pale" only where the chroma is low.
 */
export const INK_LOOK_NAMES: readonly string[] = [
  "peach",
  "apricot",
  "gold",
  "yellow",
  "pale lime",
  "light green",
  "mint",
  "aqua",
  "sky",
  "pale blue",
  "lavender",
  "blush",
];

/** The palette's twelve colours for one term: the Code inks, or their Appearance tones by the derive rule. */
export function paletteFor(term: AreaTerm): { name: string; colour: string }[] {
  return INK_PALETTE.map((entry, index) =>
    term === "look" ? { name: INK_LOOK_NAMES[index]!, colour: deriveLook(entry.code) } : { name: entry.name, colour: entry.code },
  );
}

/** A colour's name: a palette colour's or tone's name, else its hex. */
export function inkName(colour: string): string {
  const match = [...paletteFor("respond"), ...paletteFor("look")].find((entry) => sameColour(entry.colour, colour));
  return match?.name ?? toHex(colour);
}

/** Two colour strings name the same colour, whatever their notation (to 0.001 in L and C, 0.1° in hue). */
export function sameColour(a: string, b: string): boolean {
  const x = parseColour(a);
  const y = parseColour(b);
  if (!x || !y) return a === b;
  const hue = Math.abs(((x.h - y.h + 540) % 360) - 180);
  return Math.abs(x.l - y.l) < 0.001 && Math.abs(x.c - y.c) < 0.001 && (hue < 0.1 || (x.c < LOOK_RULE.grey && y.c < LOOK_RULE.grey));
}

// ---------------------------------------------------------------------------
// The tones of a request

/** The Appearance tone that goes with a Code ink, by the derive rule. */
export function deriveLook(code: string): string {
  const ink = parseColour(code);
  if (!ink) return code;
  if (ink.c < LOOK_RULE.grey) return formatOklch({ l: LOOK_RULE.lightness, c: ink.c, h: ink.h });
  const h = (ink.h + LOOK_RULE.turn) % 360;
  let c: number = LOOK_RULE.chroma;
  while (c > 0 && !inSrgb({ l: LOOK_RULE.lightness, c, h })) c = roundTo(c - LOOK_RULE.step, 3);
  return formatOklch({ l: LOOK_RULE.lightness, c: Math.max(c, 0), h });
}

/** A request's two tones from its default pair, its picks and its lock. */
export function inkPair(defaults: InkPair, choice: InkChoice | undefined, linked: boolean): InkPair {
  const code = choice?.code ?? defaults.code;
  const derived = choice?.code !== undefined ? deriveLook(choice.code) : defaults.look;
  const look = linked ? derived : (choice?.look ?? derived);
  return { code, look };
}

/** The table every consumer reads: each request's pair, by id, from its position's default pair. */
export function inkTable(recipe: Recipe, choices: InkChoices, linked: (requestId: number) => boolean, defaults: readonly InkPair[]): InkTable {
  const pairs = new Map(
    recipe.requests.map((request, position) => [request.id, inkPair(defaults[position % defaults.length]!, choices[request.id], linked(request.id))]),
  );
  return { pairs, defaults };
}

/** A request's tone for one term; a request the table does not know takes the first default pair. */
export function termInk(table: InkTable, requestId: number, term: AreaTerm): string {
  const pair = table.pairs.get(requestId) ?? table.defaults[0]!;
  return term === "look" ? pair.look : pair.code;
}

/** The pair a request at `position` will take before anyone picks for it: a held token or a drop still reading its code. */
export function defaultPair(table: InkTable, position: number): InkPair {
  return table.defaults[position % table.defaults.length]!;
}

// ---------------------------------------------------------------------------
// Picks

/** The lock is closed: one colour for the request; its Appearance tone follows by the derive rule. */
export function pickRequestInk(choices: InkChoices, requestId: number, colour: string): InkChoices {
  const choice = choices[requestId];
  if (choice?.code === colour && choice.look === undefined) return choices;
  return { ...choices, [requestId]: { code: colour } };
}

/** The lock is open: a colour for one term, the other kept. */
export function pickTermInk(choices: InkChoices, requestId: number, term: AreaTerm, colour: string): InkChoices {
  const key = term === "look" ? "look" : "code";
  if (choices[requestId]?.[key] === colour) return choices;
  return { ...choices, [requestId]: { ...choices[requestId], [key]: colour } };
}

/** "Default" with the lock closed: both tones return to the request's default pair. */
export function clearRequestInk(choices: InkChoices, requestId: number): InkChoices {
  return forgetInk(choices, requestId);
}

/** "Default" with the lock open: one term's tone returns to its default; the other pick stays. */
export function clearTermInk(choices: InkChoices, requestId: number, term: AreaTerm): InkChoices {
  const choice = choices[requestId];
  if (!choice || choice[term === "look" ? "look" : "code"] === undefined) return choices;
  const kept = term === "look" ? choice.code : choice.look;
  if (kept === undefined) return forgetInk(choices, requestId);
  return { ...choices, [requestId]: term === "look" ? { code: kept } : { look: kept } };
}

/** Closing the lock: a separate Appearance pick goes, so the tone follows the ink again. */
export function linkInk(choices: InkChoices, requestId: number): InkChoices {
  const choice = choices[requestId];
  if (choice?.look === undefined) return choices;
  return choice.code === undefined ? forgetInk(choices, requestId) : { ...choices, [requestId]: { code: choice.code } };
}

/**
 * The requests with their own Appearance colour. Such a pick exists only while the lock is
 * open (closing it drops the pick), so they reopen unlocked and every pair shows as saved.
 */
export function unlockedByInks(choices: InkChoices): number[] {
  return Object.entries(choices).flatMap(([id, choice]) => (choice.look !== undefined ? [Number(id)] : []));
}

/** A removed request takes its picks with it. */
export function forgetInk(choices: InkChoices, requestId: number): InkChoices {
  if (!(requestId in choices)) return choices;
  const { [requestId]: _forgotten, ...kept } = choices;
  return kept;
}

/**
 * Picks read from a stored record: kept only where they are colours this module can read,
 * keyed by request id. A record saved before the picker has none.
 */
export function parseInkChoices(value: unknown): InkChoices {
  if (typeof value !== "object" || value === null) return NO_INK_CHOICES;
  const choices: Record<number, InkChoice> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isSafeInteger(id) || typeof entry !== "object" || entry === null) continue;
    const { code, look } = entry as Record<string, unknown>;
    const choice: InkChoice = {
      ...(typeof code === "string" && parseColour(code) ? { code } : {}),
      ...(typeof look === "string" && parseColour(look) ? { look } : {}),
    };
    if (choice.code !== undefined || choice.look !== undefined) choices[id] = choice;
  }
  return choices;
}

// ---------------------------------------------------------------------------
// Colour arithmetic: OKLab (Björn Ottosson, 2020) over linear sRGB

/**
 * Reads "oklch(66% 0.170 145)", the computed form "oklch(0.66 0.17 145)" that a stylesheet's
 * token reads back as, or a "#rrggbb" hex colour; anything else is undefined.
 */
export function parseColour(text: string): Oklch | undefined {
  const oklch = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(text.trim());
  if (oklch) return { l: Number(oklch[1]) / (oklch[2] ? 100 : 1), c: Number(oklch[3]), h: Number(oklch[4]) % 360 };
  const hex = /^#([0-9a-f]{6})$/i.exec(text.trim());
  if (!hex) return undefined;
  const channel = (offset: number) => toLinear(parseInt(hex[1]!.slice(offset, offset + 2), 16) / 255);
  return linearSrgbToOklch([channel(0), channel(2), channel(4)]);
}

/** "oklch(86% 0.150 175)": lightness to a tenth of a percent, chroma to 0.001, hue to a tenth of a degree. */
export function formatOklch({ l, c, h }: Oklch): string {
  return `oklch(${roundTo(l * 100, 1)}% ${c.toFixed(3)} ${roundTo(h, 1)})`;
}

/** The colour as "#rrggbb" for the native colour input, clipped into sRGB. */
export function toHex(text: string): string {
  const colour = parseColour(text);
  if (!colour) return "#000000";
  const [r, g, b] = oklchToLinearSrgb(colour).map((value) => Math.round(toGamma(Math.min(1, Math.max(0, value))) * 255));
  return `#${[r, g, b].map((value) => value!.toString(16).padStart(2, "0")).join("")}`;
}

export function inSrgb(colour: Oklch): boolean {
  return oklchToLinearSrgb(colour).every((value) => value >= -1e-6 && value <= 1 + 1e-6);
}

function oklchToLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

function linearSrgbToOklch([r, g, b]: [number, number, number]): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: lightness, c: Math.hypot(a, bb), h: hue < 0 ? hue + 360 : hue };
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function toGamma(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
