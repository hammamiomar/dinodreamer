import { describe, expect, it } from "vitest";
import { projectBasis } from "./basis-math";
import { WIDTH } from "./how-shapes";

describe("basis projection", () => {
  it("projects signed responses without applying reconstruction gain", () => {
    const frame = new Float32Array(3 * WIDTH);
    frame[0] = 1;
    frame[WIDTH + 1] = 1;
    frame[2 * WIDTH + 2] = 1;
    const token = new Float32Array(WIDTH);
    token[0] = 3;
    token[1] = -4;
    token[2] = 12;
    token[3] = 5;
    expect(projectBasis(token, frame)).toEqual([3, -4, 12]);
  });
});
