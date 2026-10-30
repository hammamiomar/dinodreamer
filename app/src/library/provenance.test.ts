import { describe, expect, it } from "vitest";
import { provenanceOf, SOURCE_PARTS, sourceParts, tokenParts, unstableParts } from "./provenance";
import type { Provenance } from "./records";

// Production block 1836 (patch): far above 1, carried below 0.
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

describe("a block's provenance as views show it", () => {
  it("gives five parts in order, signed and unclamped, that sum to the whole code", () => {
    const parts = sourceParts(SURROUND);
    expect(parts.map((part) => part.part)).toEqual(["itself", "nearby", "far", "picture", "constants"]);
    // Itself is the family rule's local share, so the bar and the family never disagree.
    expect(parts[0]!.share).toBe(SURROUND.local);
    expect(parts[2]!.share).toBe(1.1361258);
    expect(parts[3]!.share).toBeCloseTo(-0.0614329, 6);
    expect(parts[4]!.share).toBeCloseTo(-0.080428727 + 0.22485368, 9);
    expect(parts.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1, 6);
  });

  it("reads one token's five shares as the bar's parts, in its order", () => {
    // Block 1836's strongest patch example: itself, near, far, prefix, constants.
    const parts = tokenParts([-0.314951599, 0.228884667, 1.01253963, -0.0136509128, 0.0871782154]);
    expect(parts.map((part) => part.part)).toEqual(SOURCE_PARTS);
    expect(parts[2]).toEqual({ part: "far", share: 1.01253963 });
  });

  it("calls a prefix token's parts unstable outside −50 % to +150 %, where its small code meets the constants", () => {
    const parts = (shares: number[]) => shares.map((share, index) => ({ part: SOURCE_PARTS[index]!, share }));
    expect(unstableParts(parts([-0.5, 0, 0.3, 0, 1.2]), "storage2")).toBe(false);
    // Block 10586 in S2 and S3.
    expect(unstableParts(parts([4.74, 0, 0.83, 0, -4.56]), "storage2")).toBe(true);
    expect(unstableParts(parts([-0.75, 0, 0.04, -0.01, 1.72]), "storage3")).toBe(true);
    expect(unstableParts(parts([0.1, 0.2, 0.3, 0, 1.55]), "cls")).toBe(true);
    // A patch's code is not small: block 434's itself −54 % keeps its bars.
    expect(unstableParts(parts([-0.54, 0.19, 0.76, -0.04, 0.63]), "patch")).toBe(false);
  });

  it("finds a role's record, or none", () => {
    const file = { block: 1836, roles: { patch: SURROUND } };
    expect(provenanceOf(file, "patch")).toBe(SURROUND);
    expect(provenanceOf(file, "storage2")).toBeNull();
  });
});
