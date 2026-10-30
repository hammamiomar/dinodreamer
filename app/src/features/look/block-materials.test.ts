import { describe, expect, it } from "vitest";
import type { MaterialEntry } from "../gallery/material-index";
import { materialReading } from "./block-materials";

const entry = (fired: boolean, strength: number | null) => ({ fired, strength }) as MaterialEntry;

describe("a material tile's reading", () => {
  it("is the strength reached, to two places, when the material fired", () => {
    expect(materialReading(entry(true, 1.5849))).toBe("1.58");
    expect(materialReading(entry(true, null))).toBe("");
  });

  it("says that the selection target was not met, whatever the stored value", () => {
    expect(materialReading(entry(false, 0.91))).toBe("selection target not met");
  });
});
