import { describe, expect, it } from "vitest";
import { kindLabel, readingRegion, recipeName, SEEDED_FIELD_AMPLITUDE, START_RADIUS, startField } from "./material-kind";

describe("the seeded field as a kind", () => {
  it("writes the disc on faint noise, reads the centre, and has its own recipe name", () => {
    expect(startField({ rule: "cell", start: "noise" })).toBeUndefined();
    expect(startField({ rule: "cell", start: "centre-disc" })).toEqual({ kind: "centre-disc", radius: START_RADIUS });
    expect(startField({ rule: "pyramid", start: "seeded-field" })).toEqual({ kind: "centre-disc", radius: START_RADIUS, backgroundAmplitude: SEEDED_FIELD_AMPLITUDE });
    expect(readingRegion({ rule: "cell", start: "seeded-field" })).toBe("centre-4x4");
    expect(readingRegion({ rule: "cell", start: "noise" })).toBeUndefined();
    expect(recipeName({ rule: "pyramid", start: "seeded-field" })).toBe("figure-pyramid-seeded-field-2026-11-02");
    expect(recipeName({ rule: "cell", start: "centre-disc" })).toBe("figure-seeded-2026-10-23");
    expect(kindLabel({ rule: "pyramid", start: "seeded-field" })).toBe("Coarse + fine · seeded field");
  });
});
