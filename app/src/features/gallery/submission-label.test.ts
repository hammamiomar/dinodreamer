import { describe, expect, it } from "vitest";
import { MATERIAL_SUBMISSION_LIMITS, submissionLabelProblem } from "./submission-label";

const limit = MATERIAL_SUBMISSION_LIMITS.titleCharacters;

describe("submission labels", () => {
  it.each(["", "   ", "Garden at dusk", "a".repeat(80), "🌿".repeat(80), ` ${"a".repeat(80)} `])("accepts a title of zero to eighty trimmed Unicode characters: %j", (title) => {
    expect(submissionLabelProblem(title, limit)).toBeNull();
  });
  it.each(["a".repeat(81), "🌿".repeat(81)])("rejects a title above eighty Unicode characters", (title) => {
    expect(submissionLabelProblem(title, limit)).toBe("too-long");
  });
  it("rejects control characters and applies the credit limit separately", () => {
    expect(submissionLabelProblem("bad\u0000title", limit)).toBe("control-characters");
    // C1 controls (U+009B is a terminal's single-byte CSI) and the line separators, which the owner's terminal and shader comments act on.
    for (const code of [0x1b, 0x7f, 0x85, 0x9b, 0x2028, 0x2029]) {
      expect(submissionLabelProblem(`bad${String.fromCodePoint(code)}title`, limit), code.toString(16)).toBe("control-characters");
    }
    expect(submissionLabelProblem("a".repeat(41), MATERIAL_SUBMISSION_LIMITS.creditCharacters)).toBe("too-long");
  });
});
