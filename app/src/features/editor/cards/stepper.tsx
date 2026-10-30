// A typed value with decrement and increment buttons. Pointer presses step immediately
// and repeat while held; the keyboard uses the value field. Each change commits
// immediately, and the run session coalesces edits while an apply is pending.

import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { MinusGlyph, PlusGlyph } from "../glyphs";
import { holdRepeat, keyAction, stepTitle, stepValue, typedValue, type StepRule } from "./stepping";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";
import "./stepper.css";

/** Start the 80 ms repeat timer after a 400 ms delay, without acceleration. */
const HOLD = { delay: 400, interval: 80 } as const;

export function Stepper({
  kind,
  value,
  label,
  subject = label,
  rule,
  integer = false,
  unit,
  format = String,
  spoken,
  disabled = false,
  onCommit,
}: {
  /** Which field it is, for the value cell's width (stepper.css). */
  kind: "weight" | "size" | "opacity" | "zoom" | "blocks";
  value: number;
  /** The field's name: the value's accessible name. */
  label: string;
  /** What the buttons change, in their names ("Decrease zoom per update"); the label when absent. */
  subject?: string;
  rule: StepRule;
  integer?: boolean;
  unit?: string;
  /** The value as the field shows it; the zoom's keeps one decimal, so its width never changes. */
  format?: (value: number) => string;
  /** The value as assistive technology reads it; with a unit, "95 %" when absent. */
  spoken?: (value: number) => string;
  /** Nothing to change: both buttons are off and the value cannot be typed. */
  disabled?: boolean;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(format(value));
  // The value changed elsewhere (a step, a reopened save): show it, unless the text already reads it.
  useEffect(() => {
    setDraft((current) => (typedValue(current, integer, rule.min, rule.max) === value ? current : format(value)));
    // format is a rendering rule that does not change for a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, integer, rule.min, rule.max]);

  // The value a step starts from: the last one committed, which the page may not show yet.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const commit = (next: number) => {
    latest.current = next;
    setDraft(format(next));
    onCommit(next);
  };
  /** One step from the latest value; false at a bound, where nothing changes. */
  const step = (direction: 1 | -1, large: boolean): boolean => {
    const next = stepValue(latest.current, direction, rule, large);
    if (next === latest.current) return false;
    commit(next);
    return true;
  };

  const [held, setHeld] = useState<1 | -1 | null>(null);
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => release.current?.(), []);

  /** A press on − or +: a step at once, then the repeat while it is held, with Shift read as it changes. */
  const press = (direction: 1 | -1) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // The press takes no focus and opens no phone keyboard.
    event.preventDefault();
    release.current?.();
    let large = event.shiftKey;
    const onKey = (key: KeyboardEvent) => {
      large = key.shiftKey;
    };
    const repeat = holdRepeat(() => step(direction, large), HOLD);
    // A button at its bound turns off and hears no more of the pointer, so the window ends the press.
    const end = () => {
      repeat.stop();
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      release.current = null;
      setHeld(null);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    release.current = end;
    setHeld(direction);
  };

  const button = (direction: 1 | -1) => (
    <button
      type="button"
      className="stepper-button"
      aria-label={fill(direction < 0 ? CREATE_TEXT.stepper.decrease : CREATE_TEXT.stepper.increase, { subject })}
      title={stepTitle(direction, rule, unit)}
      disabled={disabled || stepValue(value, direction, rule) === value}
      data-held={held === direction || undefined}
      onPointerDown={press(direction)}
      onPointerLeave={() => release.current?.()}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        // An assistive technology's click has no press: one step.
        if (event.detail === 0) step(direction, event.shiftKey);
      }}
    >
      {direction < 0 ? <MinusGlyph /> : <PlusGlyph />}
    </button>
  );

  return (
    <span className="stepper" data-kind={kind}>
      {button(-1)}
      <span className="stepper-value">
        <input
          className="stepper-input"
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          role="spinbutton"
          disabled={disabled}
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={rule.min}
          aria-valuemax={rule.max}
          aria-valuetext={spoken ? spoken(value) : unit ? `${value} ${unit}` : undefined}
          value={draft}
          onChange={(event) => {
            const text = event.currentTarget.value;
            setDraft(text);
            const typed = typedValue(text, integer, rule.min, rule.max);
            if (typed === null) return;
            latest.current = typed;
            onCommit(typed);
          }}
          onKeyDown={(event) => {
            const action = keyAction(event.key, event.shiftKey, rule);
            if (!action) return;
            event.preventDefault();
            if (action.kind === "step") step(action.direction, action.large);
            else if (action.value !== latest.current) commit(action.value);
          }}
          onBlur={() => setDraft(format(value))}
        />
        {unit && (
          <span className="stepper-unit" aria-hidden="true">
            {unit}
          </span>
        )}
      </span>
      {button(1)}
    </span>
  );
}
