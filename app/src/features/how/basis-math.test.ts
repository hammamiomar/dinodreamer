import { describe, expect, it } from "vitest";
import { firstBasisGroup, projectBasis, reconstructBasis, relativeBasisResidual, turnBasisPoint } from "./basis-math";
import { WIDTH } from "./how-shapes";

describe("basis calculations", () => {
  it("keeps a selected preferred group and otherwise follows the strongest selected group", () => {
    const groups = new Uint16Array([4009, 8141, 3972]);
    expect(firstBasisGroup(groups, 8141)).toBe(8141);
    expect(firstBasisGroup(groups, 10731)).toBe(4009);
    expect(firstBasisGroup(groups, null)).toBe(4009);
  });
  const frame = new Float32Array(3 * WIDTH);
  frame[0] = 1; frame[WIDTH + 1] = 1; frame[2 * WIDTH + 2] = 1;
  const token = new Float32Array(WIDTH);
  token[0] = 3; token[1] = -4; token[2] = 12; token[3] = 5;
  it("projects signed responses without applying reconstruction gain", () => {
    expect(projectBasis(token, frame)).toEqual([3, -4, 12]);
  });
  it("adds the selected contributions in rank order and leaves the unrepresented coordinate", () => {
    const codes = new Float32Array([3, -4, 12]);
    expect([...reconstructBasis(codes, [frame], 2, 0)].every(value => value === 0)).toBe(true);
    const rebuilt = reconstructBasis(codes, [frame], 1, 1);
    expect([...rebuilt.slice(0, 4)]).toEqual([3, -4, 12, 0]);
    expect(relativeBasisResidual(token, rebuilt)).toBeCloseTo(5 / Math.sqrt(194));
    expect(reconstructBasis(codes, [frame], 2, 1)[2]).toBe(24);
  });
  it("preserves the response magnitude when the cloud turns", () => {
    const response = [3, -4, 12];
    expect(Math.hypot(...turnBasisPoint(response, 1.3, -0.8))).toBeCloseTo(13, 12);
    expect(turnBasisPoint(response, 0, 0)).toEqual(response);
  });
});
