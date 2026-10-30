import { describe, expect, it } from "vitest";
import { firingCells } from "./strongest-blocks";

describe("firing cells as an overlay", () => {
  it("marks the listed cells and nothing else", () => {
    const responses = firingCells([0, 255]);
    expect(responses.gated.filter(Boolean).length).toBe(2);
    expect(responses.gated[0]).toBe(true);
    expect(responses.gated[255]).toBe(true);
    expect(responses.norm[0]).toBe(1);
    expect(responses.norm[1]).toBe(0);
  });
});
