// Pure stepper rules: stepping on a numeric grid, keyboard actions, typed values and
// held-button repeats.

import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";

const WORDS = CREATE_TEXT.stepper;

/** A field's steps and bounds: one step per press, the large step with Shift. */
export interface StepRule {
  step: number;
  largeStep: number;
  min: number;
  max?: number;
}

/**
 * The value one step away, in `direction`, kept within min and max. It goes to the next
 * multiple of the step that way: 1 + gives 1.1, 0.25 + gives 0.3 and 0.25 − gives 0.2 with a
 * 0.1 step; 1.25 with Shift and + gives 2. It is computed in whole steps and rounded to the
 * step's decimals, so 0.1 + 0.2 shows 0.3.
 */
export function stepValue(value: number, direction: 1 | -1, rule: StepRule, large = false): number {
  const step = large ? rule.largeStep : rule.step;
  const lines = value / step;
  const nearest = Math.round(lines);
  // On a multiple, within rounding: one whole step. Between two: the next multiple that way.
  const onMultiple = Math.abs(lines - nearest) < 1e-9;
  const steps = onMultiple ? nearest + direction : direction > 0 ? Math.ceil(lines) : Math.floor(lines);
  const target = Number((steps * step).toFixed(decimalsOf(step)));
  return Math.min(rule.max ?? Number.POSITIVE_INFINITY, Math.max(rule.min, target));
}

function decimalsOf(step: number): number {
  const text = String(step);
  const point = text.indexOf(".");
  return point < 0 ? 0 : text.length - point - 1;
}

/** A button's title: "Decrease by 0.1. With Shift, by 1."; "Increase by 5 %. With Shift, by 25 %."; "Decrease by 1." */
export function stepTitle(direction: 1 | -1, rule: StepRule, unit?: string): string {
  const amount = (step: number) => (unit ? fill(WORDS.amountWithUnit, { step, unit }) : String(step));
  const shift = rule.largeStep === rule.step ? "" : fill(WORDS.withShift, { amount: amount(rule.largeStep) });
  return fill(direction < 0 ? WORDS.decreaseBy : WORDS.increaseBy, { amount: amount(rule.step) }) + shift;
}

/** What a key in the value does: a step (small or large), a jump to a bound, or nothing. */
export type KeyAction = { kind: "step"; direction: 1 | -1; large: boolean } | { kind: "to"; value: number } | null;

/** ArrowUp and ArrowDown step, with Shift the large step; PageUp and PageDown take the large step; Home and End go to the bounds that exist. */
export function keyAction(key: string, shift: boolean, rule: StepRule): KeyAction {
  switch (key) {
    case "ArrowUp":
      return { kind: "step", direction: 1, large: shift };
    case "ArrowDown":
      return { kind: "step", direction: -1, large: shift };
    case "PageUp":
      return { kind: "step", direction: 1, large: true };
    case "PageDown":
      return { kind: "step", direction: -1, large: true };
    case "Home":
      return { kind: "to", value: rule.min };
    case "End":
      return rule.max === undefined ? null : { kind: "to", value: rule.max };
    default:
      return null;
  }
}

/**
 * The number typed so far, if it is one to commit: finite and within the bounds. A comma
 * is a decimal point too. Empty or invalid text gives no value, and the field keeps it.
 */
export function typedValue(text: string, integer: boolean, min: number, max = Number.POSITIVE_INFINITY): number | null {
  const normal = text.trim().replace(",", ".");
  if (normal === "") return null;
  const parsed = Number(normal);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) return null;
  return parsed;
}

/** A held press steps immediately, waits `delay`, then starts an `interval` timer. */
export interface HoldTiming {
  delay: number;
  interval: number;
}

type Timers = Pick<typeof globalThis, "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval">;

/**
 * Runs `onStep` for a press: once at the start, then repeatedly while it is held. `onStep`
 * returns false at a bound, which ends the repeat; `stop` ends it too. The timers are the
 * page's, or fake ones in a test.
 */
export function holdRepeat(onStep: () => boolean, timing: HoldTiming, timers: Timers = globalThis): { stop(): void } {
  let wait: ReturnType<typeof setTimeout> | undefined;
  let repeat: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (wait !== undefined) timers.clearTimeout(wait);
    if (repeat !== undefined) timers.clearInterval(repeat);
    wait = repeat = undefined;
  };
  if (onStep()) {
    wait = timers.setTimeout(() => {
      repeat = timers.setInterval(() => {
        if (!onStep()) stop();
      }, timing.interval);
    }, timing.delay);
  }
  return { stop };
}
