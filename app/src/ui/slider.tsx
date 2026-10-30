// A slider (the sheet's slider): a label, a 1 px rail with a tick at each value the caller names,
// an ink line from the start to the value, a 12 px square thumb, and the value in words at the end.
// The input is the browser's own range, drawn by styles.css, so keyboard, touch and assistive
// technology work as they do everywhere; this component only draws the ticks and the line.

import type { CSSProperties } from "react";
import "./slider.css";

export interface SliderProps {
  /** The slider's name, shown before the rail and read by a screen reader: "Speed". */
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** The value in words after the rail, also read by a screen reader: "2x". */
  valueText: string;
  /** The values that get a tick on the rail; a stepped slider passes every step. */
  ticks?: readonly number[];
  disabled?: boolean;
  /** Keys that change the value from outside the slider, for assistive technology: "[ ]". */
  keyShortcuts?: string;
  onChange: (value: number) => void;
}

/** Where `value` sits along the rail, 0 at `min` to 1 at `max`, held to that span. */
export function railFraction(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function Slider({ label, value, min, max, step = 1, valueText, ticks = [], disabled, keyShortcuts, onChange }: SliderProps) {
  return (
    <div className="slider" data-disabled={disabled || undefined}>
      <span className="label" aria-hidden="true">
        {label}
      </span>
      <span className="slider-rail" style={{ "--at": railFraction(value, min, max) } as CSSProperties}>
        <span className="slider-ticks" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ "--at": railFraction(tick, min, max) } as CSSProperties} />
          ))}
        </span>
        <span className="slider-fill" aria-hidden="true" />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={valueText}
          aria-keyshortcuts={keyShortcuts}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
      <output className="slider-value" aria-hidden="true">
        {valueText}
      </output>
    </div>
  );
}
