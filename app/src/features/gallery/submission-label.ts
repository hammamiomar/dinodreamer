/** Material labels are independent of the saved definition's generated name. */
export const MATERIAL_SUBMISSION_LIMITS = { titleCharacters: 80, creditCharacters: 40 } as const;

/** Both the form and Worker count trimmed Unicode code points, not UTF-16 code units. */
export function submissionLabelProblem(value: string, limit: number): "too-long" | "control-characters" | null {
  const trimmed = value.trim();
  if ([...trimmed].length > limit) return "too-long";
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "control-characters";
  return null;
}
