import { describe, expect, it } from "vitest";
import { CELLS, OPTIMIZER_DEFAULT, type Recipe, type Request } from "../../recipe";
import {
  INK_LOOK_NAMES,
  INK_PALETTE,
  inkName,
  paletteFor,
  sameColour,
  LOOK_RULE,
  NO_INK_CHOICES,
  clearRequestInk,
  clearTermInk,
  deriveLook,
  forgetInk,
  inkPair,
  inkTable,
  linkInk,
  parseColour,
  parseInkChoices,
  pickRequestInk,
  pickTermInk,
  termInk,
  toHex,
  type InkPair,
} from "./inks";

/** The palette's defaults (styles.css --paint-N, --paint-N-look). */
const DEFAULTS: InkPair[] = [
  { code: "oklch(66% 0.170 145)", look: "oklch(86% 0.150 175)" },
  { code: "oklch(66% 0.135 75)", look: "oklch(86% 0.150 105)" },
  { code: "oklch(66% 0.130 230)", look: "oklch(86% 0.065 260)" },
  { code: "oklch(66% 0.170 5)", look: "oklch(86% 0.075 35)" },
];

/** The twelve picker pairs: the Appearance tone of each. */
const PALETTE_LOOKS = [
  "oklch(86% 0.075 35)",
  "oklch(86% 0.090 60)",
  "oklch(86% 0.150 85)",
  "oklch(86% 0.150 105)",
  "oklch(86% 0.150 130)",
  "oklch(86% 0.150 155)",
  "oklch(86% 0.150 175)",
  "oklch(86% 0.145 205)",
  "oklch(86% 0.085 230)",
  "oklch(86% 0.065 260)",
  "oklch(86% 0.070 280)",
  "oklch(86% 0.075 10)",
];

const same = (a: string, b: string) => {
  const x = parseColour(a)!;
  const y = parseColour(b)!;
  return Math.abs(x.l - y.l) < 1e-9 && Math.abs(x.c - y.c) < 1e-9 && Math.abs(((x.h - y.h + 540) % 360) - 180) < 1e-9;
};

describe("the derive rule", () => {
  it("reproduces the four default pairs and the twelve picker pairs", () => {
    for (const pair of DEFAULTS) expect(same(deriveLook(pair.code), pair.look), pair.code).toBe(true);
    INK_PALETTE.forEach((colour, index) => expect(same(deriveLook(colour.code), PALETTE_LOOKS[index]!), colour.name).toBe(true));
  });

  it("turns pure red's hue by 30° at L 0.86, with its chroma lowered into sRGB", () => {
    const red = parseColour("#ff0000")!;
    const look = parseColour(deriveLook("#ff0000"))!;
    expect(look.l).toBeCloseTo(LOOK_RULE.lightness, 6);
    expect(look.h).toBeCloseTo(red.h + 30, 1);
    expect(look.h).toBeCloseTo(59.2, 1);
    expect(look.c).toBeLessThanOrEqual(LOOK_RULE.chroma);
    expect(toHex(deriveLook("#ff0000"))).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gives a near-grey ink a light grey", () => {
    const look = parseColour(deriveLook("#808080"))!;
    expect(look.l).toBeCloseTo(0.86, 6);
    expect(look.c).toBeLessThan(LOOK_RULE.grey);
  });

  it("reads a token's computed form, which has no percent sign", () => {
    expect(parseColour("oklch(0.66 0.17 145)")).toEqual(parseColour("oklch(66% 0.170 145)"));
    expect(toHex("oklch(0.66 0.17 145)")).toBe("#3fac4a");
  });

  it("keeps the Appearance chroma at most 0.15, however strong the ink", () => {
    expect(parseColour(deriveLook("oklch(60% 0.300 300)"))!.c).toBeLessThanOrEqual(0.15);
  });
});

describe("a request's pair", () => {
  const green = DEFAULTS[0]!;

  it("is the default pair without a pick, locked or not", () => {
    expect(inkPair(green, undefined, true)).toEqual(green);
    expect(inkPair(green, undefined, false)).toEqual(green);
  });

  it("follows one pick while the lock is closed: the Appearance tone is derived, a separate pick ignored", () => {
    const pair = inkPair(green, { code: "#ff0000", look: "#0000ff" }, true);
    expect(pair).toEqual({ code: "#ff0000", look: deriveLook("#ff0000") });
  });

  it("takes each term's pick while the lock is open, and derives the tone from an ink pick otherwise", () => {
    expect(inkPair(green, { code: "#ff0000", look: "#0000ff" }, false)).toEqual({ code: "#ff0000", look: "#0000ff" });
    expect(inkPair(green, { code: "#ff0000" }, false)).toEqual({ code: "#ff0000", look: deriveLook("#ff0000") });
    expect(inkPair(green, { look: "#0000ff" }, false)).toEqual({ code: green.code, look: "#0000ff" });
  });

  it("keeps the pair when the lock opens", () => {
    const choice = { code: "#ff0000" };
    expect(inkPair(green, choice, false)).toEqual(inkPair(green, choice, true));
  });
});

describe("picks", () => {
  it("one colour for a locked request replaces both of its picks", () => {
    const choices = pickRequestInk({ 1: { code: "#111111", look: "#222222" } }, 1, "#ff0000");
    expect(choices).toEqual({ 1: { code: "#ff0000" } });
  });

  it("a term's colour keeps the other term's pick", () => {
    const choices = pickTermInk(pickTermInk(NO_INK_CHOICES, 1, "respond", "#ff0000"), 1, "look", "#0000ff");
    expect(choices).toEqual({ 1: { code: "#ff0000", look: "#0000ff" } });
  });

  it("Default clears both picks of a locked request, or one term's of an unlocked one", () => {
    const both = { 1: { code: "#ff0000", look: "#0000ff" }, 2: { code: "#00ff00" } };
    expect(clearRequestInk(both, 1)).toEqual({ 2: { code: "#00ff00" } });
    expect(clearTermInk(both, 1, "respond")).toEqual({ 1: { look: "#0000ff" }, 2: { code: "#00ff00" } });
    expect(clearTermInk(clearTermInk(both, 1, "respond"), 1, "look")).toEqual({ 2: { code: "#00ff00" } });
    expect(clearTermInk(both, 3, "look")).toBe(both);
  });

  it("closing the lock drops a separate Appearance pick, and keeps the ink's", () => {
    expect(linkInk({ 1: { code: "#ff0000", look: "#0000ff" } }, 1)).toEqual({ 1: { code: "#ff0000" } });
    expect(linkInk({ 1: { look: "#0000ff" } }, 1)).toEqual({});
    const none = { 1: { code: "#ff0000" } };
    expect(linkInk(none, 1)).toBe(none);
  });

  it("a removed request takes its picks with it", () => {
    expect(forgetInk({ 1: { code: "#ff0000" }, 2: { code: "#00ff00" } }, 1)).toEqual({ 2: { code: "#00ff00" } });
    expect(forgetInk(NO_INK_CHOICES, 1)).toBe(NO_INK_CHOICES);
  });

  it("reads stored picks back, keeping only readable colours", () => {
    expect(parseInkChoices({ 1: { code: "#ff0000", look: "oklch(86% 0.150 175)" }, x: { code: "#ff0000" }, 3: { code: "red" }, 4: "no" })).toEqual({
      1: { code: "#ff0000", look: "oklch(86% 0.150 175)" },
    });
    expect(parseInkChoices(undefined)).toEqual({});
  });
});

describe("the ink table", () => {
  const request = (id: number): Request => ({
    id,
    block: id,
    respondLike: { enabled: true, weight: 1, source: { imageId: 1, role: "patch", slot: 5 }, code: [1, 0, 0], where: new Array(CELLS).fill(0), alsoBlocks: [], target: { kind: "point" }, radius: 1 },
    lookLike: { enabled: true, weight: 1, references: [], where: new Array(CELLS).fill(0) },
  });
  const recipe: Recipe = {
    format: 7,
    release: "pass-003",
    seed: 1,
    requests: [request(7), request(9)],
    protect: new Array(CELLS).fill(false),
    rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: false, weight: 0 } },
    motion: { zoomPerUpdate: 0 },
    optimizer: OPTIMIZER_DEFAULT,
  };

  it("gives each request its position's default pair, or its picks, and follows the request when an earlier one goes", () => {
    const table = inkTable(recipe, { 9: { code: "#ff0000" } }, () => true, DEFAULTS);
    expect(table.pairs.get(7)).toEqual(DEFAULTS[0]);
    expect(table.pairs.get(9)).toEqual({ code: "#ff0000", look: deriveLook("#ff0000") });
    expect(termInk(table, 9, "respond")).toBe("#ff0000");
    expect(termInk(table, 9, "look")).toBe(deriveLook("#ff0000"));
    const later = inkTable({ ...recipe, requests: [request(9)] }, { 9: { code: "#ff0000" } }, () => true, DEFAULTS);
    expect(later.pairs.get(9)).toEqual(table.pairs.get(9));
  });
});

describe("the picker's colours and their names", () => {
  it("offers the twelve inks for Code and their twelve tones for Appearance, each named", () => {
    expect(paletteFor("respond").map((entry) => entry.name)).toEqual(INK_PALETTE.map((entry) => entry.name));
    expect(paletteFor("look").map((entry) => entry.name)).toEqual(INK_LOOK_NAMES);
    paletteFor("look").forEach((entry, index) => expect(same(entry.colour, PALETTE_LOOKS[index]!), entry.name).toBe(true));
  });

  it("names a palette colour in either notation, a default tone by its palette name, and anything else by its hex", () => {
    expect(inkName("oklch(66% 0.170 145)")).toBe("green");
    expect(inkName("oklch(0.66 0.17 145)")).toBe("green");
    expect(inkName("oklch(86% 0.150 175)")).toBe("mint");
    expect(inkName("oklch(86% 0.075 35)")).toBe("peach");
    expect(inkName("#123456")).toBe("#123456");
  });

  it("tells colours apart beyond rounding, and greys of any hue alike", () => {
    expect(sameColour("oklch(66% 0.170 145)", "oklch(0.66 0.17 145)")).toBe(true);
    expect(sameColour("oklch(66% 0.170 145)", "oklch(66% 0.170 146)")).toBe(false);
    expect(sameColour("oklch(50% 0.010 10)", "oklch(50% 0.010 200)")).toBe(true);
  });
});
