// One rule of the Image group as a row (Smoothness, Restraint): its name, the weight as an
// editable numeral and a switch on one line, and its sentence under the line while the row
// is open. The row has a stripe in its ink while open. Clicking the line opens or shuts the
// row; the weight and the switch are the exceptions, which edit the term.

import type { CSSProperties } from "react";
import { NumberInput } from "./number-input";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";
import "./cards.css";

export function TermRow({
  name,
  sentence,
  ink,
  enabled,
  weight,
  selected,
  onSelect,
  onEnabled,
  onWeight,
}: {
  name: string;
  /** Shown under the line while the row is open. */
  sentence: string;
  ink: string;
  enabled: boolean;
  weight: number;
  /** The row is open. */
  selected: boolean;
  onSelect(): void;
  onEnabled(enabled: boolean): void;
  onWeight(weight: number): void;
}) {
  return (
    <div className={`term-row${selected ? " selected" : ""}${enabled ? "" : " off"}`} style={{ "--paint": ink } as CSSProperties}>
      {/* The line is the click target; the button inside carries it for the keyboard (its click bubbles here). */}
      <div className="term-line" onClick={onSelect}>
        <button type="button" className="term-select" aria-pressed={selected}>
          {name}
        </button>
        <label className="term-weight label mono" onClick={(event) => event.stopPropagation()}>
          ×
          <NumberInput value={weight} label={fill(CREATE_TEXT.request.weightName, { name })} onCommit={onWeight} />
        </label>
        <TermSwitch on={enabled} label={name} onChange={onEnabled} />
      </div>
      {selected && <p className="term-sentence label">{sentence}</p>}
    </div>
  );
}

/** On or off, as a switch: a knob at the right of a filled track when on; the term's name is its accessible label. */
export function TermSwitch({ on, label, onChange }: { on: boolean; label: string; onChange(on: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="term-switch"
      onClick={(event) => {
        event.stopPropagation();
        onChange(!on);
      }}
    >
      <i aria-hidden="true" />
    </button>
  );
}
