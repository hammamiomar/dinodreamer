import { describe, expect, it } from "vitest";
import type { Provenance } from "../library/records";
import { borderShare, familyLine, familyName, formatShare, orderDescription, responseReading, sourceLine, splitPartnerText } from "./glossary";

const SURROUND: Provenance = {
  sampleTokens: 62,
  carried: -0.17147395,
  self: 0.0394295044,
  near: 0.304829389,
  far: 1.1361258,
  cls: -0.0585634187,
  storage: -0.00286953058,
  attentionBias: -0.080428727,
  mlp: -0.391902804,
  constant: 0.22485368,
  context: 1.3795222,
  local: -0.523947239,
  family: "surround",
  borderFraction: null,
  splitPartner: null,
};

/** The test's strings with plain spaces where the words join with no-break spaces. */
const plain = (text: string) => text.replaceAll("\u00a0", " ");

describe("provenance words", () => {
  it("prints a share as a whole percent with a true minus sign, unclamped", () => {
    expect(formatShare(1.1361258)).toBe("114\u00a0%");
    expect(plain(formatShare(-0.17147395))).toBe("−17 %");
    expect(plain(formatShare(-0.004))).toBe("0 %");
    expect(plain(formatShare(0))).toBe("0 %");
    expect(plain(formatShare(0.255))).toBe("26 %");
  });

  it("prints the line the panel and Create share", () => {
    expect(plain(sourceLine(SURROUND))).toBe(
      "made from · itself −52 % · its neighbors 30 % · the surrounding area 114 % · the whole picture −6 % · constants 14 %",
    );
    // A line breaks only between parts.
    expect(sourceLine(SURROUND).split(" ")).toEqual([
      "made\u00a0from",
      "·",
      "itself\u00a0−52\u00a0%",
      "·",
      "its\u00a0neighbors\u00a030\u00a0%",
      "·",
      "the\u00a0surrounding\u00a0area\u00a0114\u00a0%",
      "·",
      "the\u00a0whole\u00a0picture\u00a0−6\u00a0%",
      "·",
      "constants\u00a014\u00a0%",
    ]);
  });

  it("names the viewer's family line in the bar's words", () => {
    expect(familyLine("neighbourhood")).toBe("made mostly from its neighbors");
    expect(familyLine("position")).toBe("responds at a fixed place");
    // A family a later table adds keeps its own word.
    expect(familyLine("texture")).toBe("texture category");
  });

  it("reads a token's response as responding, weakly, or not at all", () => {
    expect(responseReading(4.214, true)).toBe("responds here, 4.21");
    // Outside the block's top 32 but not zero: weak, with its number, never "does not respond".
    expect(responseReading(1.5, false)).toBe("responds weakly here, 1.50");
    expect(responseReading(0, false)).toBe("does not respond here");
  });

  it("says where a Position block fires and which block a split block shares its tokens with", () => {
    expect(plain(borderShare(0.871))).toBe("87 % on the border");
    // "block 4584" never breaks apart.
    expect(splitPartnerText(4584)).toBe("shares most of its tokens with basis group\u00a04584");
  });

  it("names the four families and shows an unknown family's own word", () => {
    expect(["local", "neighbourhood", "surround", "global", "position"].map(familyName)).toEqual(["Own-token", "Near-patch", "Distant-patch", "Prefix-token", "Position-concentrated"]);
    expect(familyName("texture")).toBe("texture");
    expect(orderDescription("surround")).toBe("Made mostly from the surrounding area: the water around a fish.");
    expect(orderDescription("neighbourhood")).toBe("Made mostly from the patches next to the token: the ground at a person's feet.");
    expect(orderDescription("position")).toBe("Responds at a fixed place in the picture: corners and borders.");
    expect(orderDescription("local")).toBe("Made mostly from the token itself: skin, for example.");
    expect(orderDescription("texture")).toBeNull();
  });
});
