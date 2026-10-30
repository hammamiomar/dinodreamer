import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdRepeat, keyAction, stepTitle, stepValue, typedValue, type StepRule } from "./stepping";

/** Stepper rules: weights 0.1 and 1 from 0; size 1 within 1 to 9; opacity 5 % and 25 % within 0 to 100. */
const weight: StepRule = { step: 0.1, largeStep: 1, min: 0 };
const size: StepRule = { step: 1, largeStep: 1, min: 1, max: 9 };
const opacity: StepRule = { step: 5, largeStep: 25, min: 0, max: 100 };

describe("a step", () => {
  it("adds or takes one step, with no floating-point tail", () => {
    expect(stepValue(1, 1, weight)).toBe(1.1);
    expect(stepValue(0.2, 1, weight)).toBe(0.3);
    expect(stepValue(1, -1, weight)).toBe(0.9);
    expect(stepValue(3, 1, size)).toBe(4);
    expect(stepValue(100, -1, opacity)).toBe(95);
  });

  it("goes to the next multiple of the step in its direction", () => {
    expect(stepValue(0.25, 1, weight)).toBe(0.3);
    expect(stepValue(0.25, -1, weight)).toBe(0.2);
    expect(stepValue(1.25, 1, weight, true)).toBe(2);
    expect(stepValue(42, 1, opacity)).toBe(45);
    expect(stepValue(42, -1, opacity, true)).toBe(25);
  });

  it("takes the large step with Shift", () => {
    expect(stepValue(1, 1, weight, true)).toBe(2);
    expect(stepValue(50, 1, opacity, true)).toBe(75);
  });

  it("stays within the bounds", () => {
    expect(stepValue(0, -1, weight)).toBe(0);
    expect(stepValue(0.05, -1, weight)).toBe(0);
    expect(stepValue(9, 1, size)).toBe(9);
    expect(stepValue(1, -1, size)).toBe(1);
    expect(stepValue(90, 1, opacity, true)).toBe(100);
  });
});

describe("a button's title", () => {
  it("names the step, and the Shift step where it differs", () => {
    expect(stepTitle(-1, weight)).toBe("Decrease by 0.1. With Shift, by 1.");
    expect(stepTitle(1, opacity, "%")).toBe("Increase by 5 %. With Shift, by 25 %.");
    expect(stepTitle(-1, size)).toBe("Decrease by 1.");
  });
});

describe("the keys in the value", () => {
  it("step with the arrows, take the large step with Shift or the page keys, and go to the bounds with Home and End", () => {
    expect(keyAction("ArrowUp", false, weight)).toEqual({ kind: "step", direction: 1, large: false });
    expect(keyAction("ArrowDown", true, weight)).toEqual({ kind: "step", direction: -1, large: true });
    expect(keyAction("PageUp", false, opacity)).toEqual({ kind: "step", direction: 1, large: true });
    expect(keyAction("PageDown", false, opacity)).toEqual({ kind: "step", direction: -1, large: true });
    expect(keyAction("Home", false, size)).toEqual({ kind: "to", value: 1 });
    expect(keyAction("End", false, size)).toEqual({ kind: "to", value: 9 });
  });

  it("do nothing for End without a maximum, or for any other key", () => {
    expect(keyAction("End", false, weight)).toBeNull();
    expect(keyAction("a", false, weight)).toBeNull();
    expect(keyAction("Enter", false, size)).toBeNull();
  });
});

describe("a typed number", () => {
  it("commits a finite value at least the minimum, with a comma as a decimal point", () => {
    expect(typedValue("1.5", false, 0)).toBe(1.5);
    expect(typedValue("1,5", false, 0)).toBe(1.5);
    expect(typedValue("7", true, 1)).toBe(7);
    // "0." is 0 already; the field keeps the text until the next digit.
    expect(typedValue("0.", false, 0)).toBe(0);
  });

  it("commits nothing for a partial or out-of-range text", () => {
    expect(typedValue("", false, 0)).toBeNull();
    expect(typedValue("-", false, 0)).toBeNull();
    expect(typedValue("-1", false, 0)).toBeNull();
    expect(typedValue("0", true, 1)).toBeNull();
    expect(typedValue("abc", false, 0)).toBeNull();
  });

  it("enforces the same upper bound as the step buttons", () => {
    expect(typedValue("101", false, 0, 100)).toBeNull();
    expect(typedValue("100", false, 0, 100)).toBe(100);
    expect(typedValue("10", true, 1, 9)).toBeNull();
  });

  it("does not turn incomplete or fractional integer input into a different value", () => {
    expect(typedValue("12x", true, 1)).toBeNull();
    expect(typedValue("1e", true, 1)).toBeNull();
    expect(typedValue("2.5", true, 1)).toBeNull();
    expect(typedValue("2.0", true, 1)).toBe(2);
  });
});

describe("a held press", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("steps once at once, then repeats every 80 ms after 400 ms until it is released", () => {
    const onStep = vi.fn(() => true);
    const press = holdRepeat(onStep, { delay: 400, interval: 80 });
    expect(onStep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(399);
    expect(onStep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1 + 80 * 3);
    expect(onStep).toHaveBeenCalledTimes(4);
    press.stop();
    vi.advanceTimersByTime(1000);
    expect(onStep).toHaveBeenCalledTimes(4);
  });

  it("gives one step for a quick tap", () => {
    const onStep = vi.fn(() => true);
    holdRepeat(onStep, { delay: 400, interval: 80 }).stop();
    vi.advanceTimersByTime(1000);
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it("stops at a bound", () => {
    let value = 7;
    const onStep = vi.fn(() => {
      const next = stepValue(value, 1, size);
      if (next === value) return false;
      value = next;
      return true;
    });
    holdRepeat(onStep, { delay: 400, interval: 80 });
    vi.advanceTimersByTime(400 + 80 * 10);
    expect(value).toBe(9);
    // 7 -> 8 at once, 8 -> 9 at the first repeat, then the bound ends it.
    expect(onStep).toHaveBeenCalledTimes(3);
  });
});
