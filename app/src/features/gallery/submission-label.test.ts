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
    expect(submissionLabelProblem("a".repeat(41), MATERIAL_SUBMISSION_LIMITS.creditCharacters)).toBe("too-long");
  });
});
