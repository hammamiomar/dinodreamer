import { describe, expect, it } from "vitest";
import { createRunState, type RunState } from "./run/session";
import { transportNote } from "./transport";

describe("the note line", () => {
  const running: RunState = { ...createRunState(), phase: "running", settledPhase: "running", wantsRunning: true };

  it("says nothing while a run goes on: the stride stays the visitor's from the first update to the last", () => {
    expect(transportNote(running)).toBeNull();
  });

  it("says what blocks the run", () => {
    const refused: RunState = { ...running, refused: { command: "run", message: "Nothing to optimize." } };
    expect(transportNote(refused)).toEqual({ text: "Play refused: Nothing to optimize.", passing: false });
  });
});
