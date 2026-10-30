// A small editable numeral for an image-rule weight or the seed.
// It commits every finite value as it is typed, so the recipe follows the keystrokes, and
// keeps the typed representation while it describes the current value.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import "./number-input.css";

export function NumberInput({
  value,
  label,
  integer = false,
  width,
  onCommit,
}: {
  value: number;
  label: string;
  integer?: boolean;
  /**
   * Width in CSS pixels; 56 by default. Touch styles widen it with the digits.
   */
  width?: number;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  // The recipe changed elsewhere (a reopened save, a reset): show its value.
  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <input
      className="input mono number-input"
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      min={0}
      step={integer ? 1 : 0.05}
      aria-label={label}
      value={draft}
      style={width === undefined ? undefined : ({ "--field-width": `${width}px` } as CSSProperties)}
      onChange={(event) => {
        const text = event.currentTarget.value;
        setDraft(text);
        const parsed = integer ? Number.parseInt(text, 10) : Number(text);
        if (text !== "" && Number.isFinite(parsed) && parsed >= 0) onCommit(parsed);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
