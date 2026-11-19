import { hasUnsafeCharacter } from "../../visitor-text.ts";

/** Material labels are independent of the saved definition's generated name. */
export const MATERIAL_SUBMISSION_LIMITS = { titleCharacters: 80, creditCharacters: 40 } as const;

/** Both the form and Worker count trimmed Unicode code points, not UTF-16 code units. */
export function submissionLabelProblem(value: string, limit: number): "too-long" | "control-characters" | null {
  const trimmed = value.trim();
  if ([...trimmed].length > limit) return "too-long";
  // C0, DEL and C1 controls and the line separators (visitor-text.ts): the owner's terminal prints these labels.
  if (hasUnsafeCharacter(trimmed)) return "control-characters";
  return null;
}
