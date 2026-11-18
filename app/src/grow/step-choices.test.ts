import { describe, expect, test } from "vitest";
import { lowestLossStep, stepSentence } from "./step-choices";
import type { TrainLadder } from "./protocol";

const ladder = (kept: number): TrainLadder => ({
  steps: [{ tick: 100, loss: 0.21, picture: "" }, { tick: 150, loss: 0.12, picture: "" }, { tick: 200, loss: 0.19, picture: "" }, { tick: 1500, loss: 0.4, picture: "" }],
  kept,
});

describe("the reading step's choice", () => {
  test("a run keeps the step of the lowest own loss, and the sentence says so", () => {
    expect(lowestLossStep(ladder(150))).toBe(150);
    expect(stepSentence(ladder(150), true)).toBe("The automaton is read at step 150, where its own loss is lowest.");
  });

  test("after another step is chosen, the sentence names both", () => {
    expect(stepSentence(ladder(1500), true)).toBe("The automaton is read at step 1,500. Its own loss is lowest at step 150.");
  });

  test("once the automaton is sent, the sentence says the step is fixed", () => {
    expect(stepSentence(ladder(200), false)).toBe("The automaton is read at step 200. The step is fixed once it is sent to the gallery.");
  });
});
