import { describe, expect, test } from "vitest";
import { faceSpeed } from "./live-faces";

/** The ticks a face visits on its way to rest, frame by frame, with the frames it takes. */
function wayToRest(restingTick: number): { ticks: number[]; frames: number } {
  const ticks = [0];
  for (let speed = faceSpeed(0, restingTick); speed > 0; speed = faceSpeed(ticks.at(-1)!, restingTick)) ticks.push(ticks.at(-1)! + speed);
  return { ticks, frames: ticks.length - 1 };
}

describe("a wall face comes to rest at its automaton's reading step", () => {
  test("it rests exactly on the step, for every step of the reading ladder and for 600", () => {
    for (const step of [100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000]) {
      expect(wayToRest(step).ticks.at(-1)).toBe(step);
      expect(faceSpeed(step, step)).toBe(0);
      expect(faceSpeed(step + 40, step)).toBe(0);
    }
  });

  test("the way to step 600 is as before: 8 ticks a frame to 160, then 2", () => {
    const { ticks, frames } = wayToRest(600);
    expect(ticks.slice(0, 3)).toEqual([0, 8, 16]);
    expect(ticks).toContain(160);
    expect(ticks[ticks.indexOf(160) + 1]).toBe(162);
    expect(frames).toBe(20 + 220);
  });

  test("a late step takes about as long as step 600, and an early one is shorter", () => {
    expect(wayToRest(2000).frames).toBeLessThanOrEqual(wayToRest(600).frames + 1);
    expect(wayToRest(100).frames).toBeLessThan(wayToRest(600).frames);
  });
});
