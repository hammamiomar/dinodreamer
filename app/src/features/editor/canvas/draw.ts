// Drawing the creation canvas: the 256 × 256 image shown at 512 × 512 with its
// overlays on one <canvas>. Each overlay is a set of cells on the 16 × 16 grid; one
// cell is 32 display pixels. overlay.ts decides which areas are drawn and how strongly.

import { GRID, type Area } from "../../../recipe";
import { palette } from "../presentation";
import { OVERLAY_ALPHA, shownStrength, type AreaFill, type CanvasOverlay } from "./overlay";

export const DISPLAY_SIZE = 512;
export const CELL_SIZE = DISPLAY_SIZE / GRID;
/** The image the worker sends: 256 × 256 RGBA. */
export const IMAGE_SIZE = 256;
/** Opacities of the light strokes over the image. */
const HATCH_ALPHA = 0.55;
const GRID_ALPHA = 0.08;
/** The brush's footprint: each cell's own square, inset by this many display pixels so neighbours read apart. */
const FOOTPRINT_INSET = 2;
/**
 * A field's edge: a line in the field's tone over a dark halo, so the edge reads on dark,
 * light and busy pictures alike. Both fade with a cell's strength, as the fill does.
 */
const FIELD_EDGE = { width: 1.5, alpha: 0.95, haloWidth: 3, haloAlpha: 0.55 } as const;

export interface CanvasLayers {
  /** The latest pixels, already on a 256 × 256 canvas; undefined before the first frame. */
  image?: CanvasImageSource;
  /** The selected request's fields: the selected term filled, its other term's edge (overlay.ts). */
  overlay?: CanvasOverlay;
  /** The brush's ink: its footprint, and the held token's stroke. */
  brushColour?: string;
  showGrid: boolean;
  /**
   * The brush under the pointer: the cells one dab would touch, each with the percentage it would
   * receive (brush.ts dabFootprint), and the centre cell, which is outlined at full strength.
   */
  brushFootprint?: { cells: { cell: number; deposit: number }[]; centre: number };
}

export function drawCanvas(context: CanvasRenderingContext2D, layers: CanvasLayers): void {
  context.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
  drawImage(context, layers.image);
  const overlay = layers.overlay;
  if (overlay?.movement) drawMovement(context, overlay.movement);
  for (const outline of overlay?.outlines ?? []) outlineField(context, outline);
  if (overlay?.fill) {
    drawAreaFill(context, overlay.fill);
    outlineField(context, overlay.fill);
  }
  if (overlay?.protect) drawProtect(context, overlay.protect);
  if (layers.showGrid) drawGrid(context);
  if (layers.brushFootprint) drawFootprint(context, layers.brushFootprint, layers.brushColour ?? palette().measure);
}

function drawImage(context: CanvasRenderingContext2D, image: CanvasImageSource | undefined) {
  if (!image) {
    context.fillStyle = palette().line;
    context.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    return;
  }
  // The 256 × 256 image is scaled smoothly to the display. Drawn as hard 2 × 2 blocks
  // (4 × 4 device pixels at DPR 2), it would appear gridded.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
}

/** Paint density shows the stored percentage; Code error remains a separate readout. */
function drawAreaFill(context: CanvasRenderingContext2D, fill: AreaFill) {
  fill.area.forEach((strength, cell) => {
    if (strength === 0) return;
    context.globalAlpha = OVERLAY_ALPHA.fill * shownStrength(strength);
    context.fillStyle = fill.ink;
    fillCell(context, cell);
  });
  context.globalAlpha = 1;
}

/** The hovered movement map: each cell filled with the measure colour at its lightness, up to the fixed opacity. */
function drawMovement(context: CanvasRenderingContext2D, lightness: Float32Array) {
  context.fillStyle = palette().measure;
  lightness.forEach((value, cell) => {
    if (value <= 0) return;
    context.globalAlpha = OVERLAY_ALPHA.movement * value;
    fillCell(context, cell);
  });
  context.globalAlpha = 1;
}

/**
 * Each cell a dab would touch, as its own open square in the field-edge style, at the strength
 * the canvas would show for what the cell receives (overlay.ts shownStrength, so a faint outer
 * cell stays visible as a faint coat does); the centre cell at full strength, never filled, so
 * the pixels the visitor aims at stay in view. Halos first, then lines.
 */
function drawFootprint(context: CanvasRenderingContext2D, footprint: NonNullable<CanvasLayers["brushFootprint"]>, ink: string) {
  const side = CELL_SIZE - 2 * FOOTPRINT_INSET;
  for (const halo of [true, false]) {
    context.strokeStyle = halo ? palette().ground : ink;
    context.lineWidth = halo ? FIELD_EDGE.haloWidth : FIELD_EDGE.width;
    for (const { cell, deposit } of footprint.cells) {
      const shown = cell === footprint.centre ? 1 : shownStrength(deposit);
      if (shown <= 0) continue;
      context.globalAlpha = (halo ? FIELD_EDGE.haloAlpha : FIELD_EDGE.alpha) * shown;
      const { x, y } = cellOrigin(cell);
      context.strokeRect(x + FOOTPRINT_INSET, y + FOOTPRINT_INSET, side, side);
    }
  }
  context.globalAlpha = 1;
}

/** Protected cells are hatched: a constraint, not a loss. */
function drawProtect(context: CanvasRenderingContext2D, protect: boolean[]) {
  context.strokeStyle = palette().text;
  context.globalAlpha = HATCH_ALPHA;
  context.lineWidth = 1.5;
  const spacing = CELL_SIZE / 4;
  protect.forEach((isProtected, cell) => {
    if (!isProtected) return;
    const { x, y } = cellOrigin(cell);
    context.save();
    context.beginPath();
    context.rect(x, y, CELL_SIZE, CELL_SIZE);
    context.clip();
    context.beginPath();
    for (let offset = -CELL_SIZE; offset < CELL_SIZE; offset += spacing) {
      context.moveTo(x + offset, y + CELL_SIZE);
      context.lineTo(x + offset + CELL_SIZE, y);
    }
    context.stroke();
    context.restore();
  });
  context.globalAlpha = 1;
}

function drawGrid(context: CanvasRenderingContext2D) {
  context.strokeStyle = palette().text;
  context.globalAlpha = GRID_ALPHA;
  context.lineWidth = 1;
  context.beginPath();
  for (let line = 1; line < GRID; line++) {
    context.moveTo(line * CELL_SIZE + 0.5, 0);
    context.lineTo(line * CELL_SIZE + 0.5, DISPLAY_SIZE);
    context.moveTo(0, line * CELL_SIZE + 0.5);
    context.lineTo(DISPLAY_SIZE, line * CELL_SIZE + 0.5);
  }
  context.stroke();
  context.globalAlpha = 1;
}

/** A field's edge: every halo first, then every line, so no halo covers a neighbour's line. */
function outlineField(context: CanvasRenderingContext2D, field: AreaFill) {
  const cells = areaCells(field.area);
  outlineCells(context, cells, palette().ground, FIELD_EDGE.haloWidth, FIELD_EDGE.haloAlpha, field.area);
  outlineCells(context, cells, field.ink, FIELD_EDGE.width, FIELD_EDGE.alpha, field.area);
}

/** Outlines the boundary of a set of cells: an edge is drawn where a cell's neighbour is outside the set. */
function outlineCells(
  context: CanvasRenderingContext2D,
  cells: number[],
  colour: string,
  width: number,
  alpha: number,
  strengths: Area,
) {
  const inside = new Set(cells);
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.globalAlpha = alpha;
  context.setLineDash([]);
  for (const cell of cells) {
    context.globalAlpha = alpha * shownStrength(strengths[cell]!);
    context.beginPath();
    const row = Math.floor(cell / GRID);
    const column = cell % GRID;
    const { x, y } = cellOrigin(cell);
    if (row === 0 || !inside.has(cell - GRID)) edge(context, x, y, x + CELL_SIZE, y);
    if (row === GRID - 1 || !inside.has(cell + GRID)) edge(context, x, y + CELL_SIZE, x + CELL_SIZE, y + CELL_SIZE);
    if (column === 0 || !inside.has(cell - 1)) edge(context, x, y, x, y + CELL_SIZE);
    if (column === GRID - 1 || !inside.has(cell + 1)) edge(context, x + CELL_SIZE, y, x + CELL_SIZE, y + CELL_SIZE);
    context.stroke();
  }
  context.setLineDash([]);
  context.globalAlpha = 1;
}

function edge(context: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  context.moveTo(x0, y0);
  context.lineTo(x1, y1);
}

function fillCell(context: CanvasRenderingContext2D, cell: number) {
  const { x, y } = cellOrigin(cell);
  context.fillRect(x, y, CELL_SIZE, CELL_SIZE);
}

function cellOrigin(cell: number): { x: number; y: number } {
  return { x: (cell % GRID) * CELL_SIZE, y: Math.floor(cell / GRID) * CELL_SIZE };
}

export function areaCells(area: Area): number[] {
  return area.flatMap((inside, cell) => (inside ? [cell] : []));
}

/** Copies 256 × 256 RGBA pixels onto a reusable offscreen canvas for scaled drawing. */
export function pixelsToCanvas(pixels: Uint8ClampedArray, target: HTMLCanvasElement): HTMLCanvasElement {
  target.width = IMAGE_SIZE;
  target.height = IMAGE_SIZE;
  const context = target.getContext("2d");
  // ImageData needs a plain ArrayBuffer-backed array; copying 256 kB per frame is negligible.
  if (context) context.putImageData(new ImageData(new Uint8ClampedArray(pixels), IMAGE_SIZE, IMAGE_SIZE), 0, 0);
  return target;
}
