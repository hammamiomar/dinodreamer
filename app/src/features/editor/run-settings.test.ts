import { describe, expect, it } from "vitest";
import { CLOSED_STACK, toggleText, type TextStack } from "./run-settings";

const opened = (...keys: Parameters<typeof toggleText>[1][]): TextStack => keys.reduce(toggleText, CLOSED_STACK);
/** The open texts from the top of the stack down. */
const fromTop = (stack: TextStack) => [...stack.open].sort((a, b) => stack.slot[a] - stack.slot[b]);

describe("the run settings' text stack", () => {
  it("puts each opened text at the bottom, in the order they were opened", () => {
    const stack = opened("robustView", "scale", "step");
    expect(fromTop(stack)).toEqual(["robustView", "scale", "step"]);
  });

  it("leaves a closed text in its slot, so the texts below it keep their order and rise into it", () => {
    const stack = toggleText(opened("robustView", "scale", "step"), "scale");
    expect(stack.open).toEqual(["robustView", "step"]);
    expect(fromTop(stack)).toEqual(["robustView", "step"]);
    expect(stack.slot.scale).toBe(2);
  });

  it("puts a text opened again at the bottom", () => {
    const stack = toggleText(toggleText(opened("robustView", "scale", "step"), "scale"), "scale");
    expect(fromTop(stack)).toEqual(["robustView", "step", "scale"]);
  });
});
