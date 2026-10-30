import { describe, expect, test } from "vitest";
import { fitCloud } from "./atlas-cloud-figure";

describe("the cloud figure", () => {
  test("the cloud fits its points, its ring and the lit point with one scale for both axes", () => {
    const cloud = { ring: 5, points: [{ x: 20, y: 2, band: 0 as const }, { x: -3, y: -4, band: 0 as const }] };
    const fit = fitCloud(cloud, [15, -1], 640, 512, 48);
    // x spans -5 to 20 (the ring and a point), y spans -5 to 5 (the ring): x decides the scale.
    expect(fit.scale).toBeCloseTo((640 - 96) / 25, 6);
    expect(fit.x(-5)).toBeCloseTo(48, 6);
    expect(fit.x(20)).toBeCloseTo(592, 6);
    // y grows up the page, centred on the figure.
    expect(fit.y(0)).toBeCloseTo(256, 6);
    expect(fit.y(5)).toBeLessThan(fit.y(0));
  });
});
