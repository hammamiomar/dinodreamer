import { describe, expect, it } from "vitest";
import { placeCloudPicture } from "./cloud-view";

describe("the picture beside a tapped cloud dot", () => {
  const plot = { left: 0, top: 0, right: 358, bottom: 358 };

  it("opens above and beside the dot without covering it", () => {
    expect(placeCloudPicture({ x: 180, y: 200 }, plot)).toEqual({ x: 192, y: 60, size: 128 });
  });

  it("changes sides at the right and top plot edges", () => {
    expect(placeCloudPicture({ x: 350, y: 20 }, plot)).toEqual({ x: 210, y: 32, size: 128 });
  });

  it("keeps the picture below the header when the plot is partly above the screen", () => {
    const visible = { ...plot, top: 100 };
    const position = placeCloudPicture({ x: 180, y: 180 }, visible);
    expect(position.y).toBe(192);
    expect(position.y + 128).toBeLessThanOrEqual(visible.bottom);
  });

  it("fits the picture when only a short part of the plot is visible", () => {
    const visible = { ...plot, bottom: 90 };
    expect(placeCloudPicture({ x: 180, y: 50 }, visible)).toEqual({ x: 192, y: 0, size: 90 });
  });

  it("keeps the picture above the screen edge when the plot continues below it", () => {
    const visible = { ...plot, bottom: 170 };
    const position = placeCloudPicture({ x: 180, y: 130 }, visible);
    expect(position.y).toBe(42);
    expect(position.y + 128).toBe(visible.bottom);
  });
});
