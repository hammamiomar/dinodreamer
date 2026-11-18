import { describe, expect, it } from "vitest";
import { LIVE_HOLD_MS, LIVE_LOOP_STEPS, loopTurn } from "./live-loop";

describe("the live grid's loop for a set method", () => {
  it("grows to the loop's end, and says which turn reaches it", () => {
    expect(LIVE_LOOP_STEPS).toBe(400);
    expect(loopTurn(0, 400, 16, null, null, 0)).toEqual({ kind: "grow", steps: 16, reachesEnd: false });
    expect(loopTurn(384, 400, 16, null, null, 0)).toEqual({ kind: "grow", steps: 16, reachesEnd: true });
    // A turn never passes the end: an end of 300 at 16 steps a turn stops at 300.
    expect(loopTurn(288, 300, 16, null, null, 0)).toEqual({ kind: "grow", steps: 12, reachesEnd: true });
  });

  it("holds the end's picture for LIVE_HOLD_MS, then starts again", () => {
    expect(loopTurn(400, 400, 16, 1000, null, 1000 + LIVE_HOLD_MS - 1)).toEqual({ kind: "hold" });
    expect(loopTurn(400, 400, 16, 1000, null, 1000 + LIVE_HOLD_MS)).toEqual({ kind: "restart" });
    // A grid past the end (after the run, a held grid at its own step of 1,500) holds, then starts again.
    expect(loopTurn(1500, 400, 16, null, null, 5000)).toEqual({ kind: "hold" });
  });

  it("postpones the restart until LIVE_HOLD_MS after the latest brush stroke", () => {
    expect(loopTurn(400, 400, 16, 1000, 2400, 1000 + LIVE_HOLD_MS)).toEqual({ kind: "hold" });
    expect(loopTurn(400, 400, 16, 1000, 2400, 2400 + LIVE_HOLD_MS)).toEqual({ kind: "restart" });
    // A stroke while the grid grows does not stop it.
    expect(loopTurn(100, 400, 16, null, 2400, 2401)).toEqual({ kind: "grow", steps: 16, reachesEnd: false });
  });
});
