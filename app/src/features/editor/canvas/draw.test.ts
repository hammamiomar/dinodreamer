import { expect, it, vi } from "vitest";
import { CELLS } from "../../../recipe";
import { drawCanvas } from "./draw";

function canvasRecorder() {
  const fills: number[] = [];
  const outlines: number[] = [];
  const context = {
    globalAlpha: 1,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect() { fills.push(this.globalAlpha); },
    stroke() { outlines.push(this.globalAlpha); },
    strokeRect() { outlines.push(this.globalAlpha); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    setLineDash() {},
  };
  return { context: context as unknown as CanvasRenderingContext2D, fills, outlines, drawImage: context.drawImage };
}

it("draws selected fill and boundary by stored strength, a faint coat at a quarter of full opacity or more", () => {
  const { context, fills, outlines } = canvasRecorder();
  const area = new Array<number>(CELLS).fill(0);
  area[0] = 25;
  area[1] = 50;
  area[2] = 100;
  drawCanvas(context, { image: {} as CanvasImageSource, overlay: { outlines: [], fill: { area, ink: "green" } }, showGrid: false });
  // 0.35 × (0.25 + 0.75 s) for the fill; the edge's halo at 0.55 × (0.25 + 0.75 s), then its line at 0.95 × (0.25 + 0.75 s), for s = 0.25, 0.5 and 1.
  expect(fills.map((alpha) => Number(alpha.toFixed(6)))).toEqual([0.153125, 0.21875, 0.35]);
  expect(outlines.map((alpha) => Number(alpha.toFixed(6)))).toEqual([0.240625, 0.34375, 0.55, 0.415625, 0.59375, 0.95]);
});

it("draws the brush as its footprint: each cell's own open square at the strength the canvas shows, the centre at full strength", () => {
  const { context, fills, outlines } = canvasRecorder();
  // A size-3 dab at 30 %: corner 6, edge 15, centre 30 (brush.ts); a cell that would receive nothing is not drawn.
  const cells = [
    { cell: 0, deposit: 6 },
    { cell: 1, deposit: 15 },
    { cell: 2, deposit: 0 },
    { cell: 17, deposit: 30 },
  ];
  drawCanvas(context, { image: {} as CanvasImageSource, brushFootprint: { cells, centre: 17 }, brushColour: "violet", showGrid: false });
  expect(fills).toEqual([]);
  // Halos first at 0.55 × shown, then lines at 0.95 × shown, with shown = 0.25 + 0.75 s, and 1 at the centre.
  const shown = [0.25 + 0.75 * 0.06, 0.25 + 0.75 * 0.15, 1];
  const expected = [...shown.map((value) => 0.55 * value), ...shown.map((value) => 0.95 * value)];
  expect(outlines.map((alpha) => Number(alpha.toFixed(6)))).toEqual(expected.map((alpha) => Number(alpha.toFixed(6))));
});

it("draws only the picture when nothing is selected: an empty overlay, no grid, no brush", () => {
  const { context, fills, outlines, drawImage } = canvasRecorder();
  drawCanvas(context, { image: {} as CanvasImageSource, overlay: { outlines: [] }, showGrid: false });
  expect(drawImage).toHaveBeenCalledTimes(1);
  expect(fills).toEqual([]);
  expect(outlines).toEqual([]);
});
