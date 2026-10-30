// A library picture with its selected patch, and consistent numerical labels for the diagrams.
import { useLayoutEffect, useRef } from "react";
import { cssColour } from "../../ui/css-colour";
import { LibraryImage } from "../../ui/library-image";
import { canvasPixelRatio } from "../../ui/page-scale";
import "./how-figures.css";

const VISIBLE = 0.02;

/** Redraw a CSS-sized canvas at its rendered resolution. Measurements change pixels, never layout. */
export function useFigureCanvas(draw: (context: CanvasRenderingContext2D, width: number, height: number) => void, inputs: unknown[]) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const render = () => {
      const style = getComputedStyle(element);
      // The layout box excludes animated transforms. A temporarily halved stack layer must keep
      // enough backing pixels for its full size when the transition ends.
      const width = parseFloat(style.width) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      const height = parseFloat(style.height) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
      if (width <= 0 || height <= 0) return;
      const ratio = canvasPixelRatio(element, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      const context = element.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      draw(context, width, height);
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(element);
    return () => observer.disconnect();
    // The inputs are the draw's own; the caller lists them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, inputs);
  return canvas;
}

/** The cell under a pointer, normalized to the CSS box rather than the canvas's backing pixels. */
export function figureCellAt(event: { clientX: number; clientY: number; currentTarget: HTMLElement }, columns: number, rows = columns): number | null {
  const bounds = event.currentTarget.getBoundingClientRect();
  const column = Math.floor((event.clientX - bounds.left) / bounds.width * columns);
  const row = Math.floor((event.clientY - bounds.top) / bounds.height * rows);
  return column >= 0 && column < columns && row >= 0 && row < rows ? row * columns + column : null;
}

export interface PictureProps {
  src: string;
  /** An explicit size for callers outside How. How's panes set the square's size in CSS. */
  side?: number;
  /** A size per patch (256) to lay over the picture as white of that share, or none. */
  heat?: Float32Array | null;
  /** The size that draws as full white. */
  heatScale?: number;
  pinned: number | null;
  inspected?: number | null;
  onHover?: (patch: number | null) => void;
  onPick?: (patch: number) => void;
  alt: string;
}

/**
 * A picture with the reader's 16 × 16 patch grid. A heat lays each patch's share over it as white,
 * the picture dimmed under it; the pinned patch has an ink outline, the inspected one a fainter one.
 * A library picture, not a material: nothing here is drawn on a material's cells.
 */
export function PictureWithPatches({ src, side, heat = null, heatScale = 1, pinned, inspected = null, onHover, onPick, alt }: PictureProps) {
  const canvas = useFigureCanvas((context, width) => {
    const patch = width / 16;
    if (heat) {
      context.fillStyle = "rgb(0 0 0 / 0.55)";
      context.fillRect(0, 0, width, width);
      for (let index = 0; index < 256; index++) {
        const share = Math.min(1, heat[index]! / heatScale);
        if (share < VISIBLE) continue;
        context.fillStyle = `rgb(255 255 255 / ${(0.85 * Math.sqrt(share)).toFixed(3)})`;
        context.fillRect((index % 16) * patch, Math.floor(index / 16) * patch, patch, patch);
      }
    }
    context.strokeStyle = "rgb(255 255 255 / 0.22)";
    context.lineWidth = 1;
    for (let line = 1; line < 16; line++) {
      const at = Math.round(line * patch) + 0.5;
      context.beginPath();
      context.moveTo(at, 0);
      context.lineTo(at, width);
      context.moveTo(0, at);
      context.lineTo(width, at);
      context.stroke();
    }
    const outline = (index: number, colour: string) => {
      context.strokeStyle = colour;
      context.strokeRect((index % 16) * patch + 0.5, Math.floor(index / 16) * patch + 0.5, patch - 1, patch - 1);
    };
    if (inspected !== null && inspected !== pinned) outline(inspected, "rgb(255 255 255 / 0.6)");
    if (pinned !== null) outline(pinned, cssColour("--ink", "#efece8"));
  }, [heat, heatScale, pinned, inspected]);
  return (
    <div
      className="how-picture"
      style={side === undefined ? undefined : { width: side, height: side }}
      onPointerMove={onHover && ((event) => onHover(figureCellAt(event, 16)))}
      onPointerLeave={onHover && (() => onHover(null))}
      onClick={onPick && ((event) => {
        const index = figureCellAt(event, 16);
        if (index !== null) onPick(index);
      })}
    >
      <LibraryImage src={src} alt={alt} width={side} height={side} draggable={false} />
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}

/** A number as the figures write it: three significant digits, tabular. */
export function formatValue(value: number): string {
  if (value === 0) return "0";
  const size = Math.abs(value);
  if (size >= 1000) return Math.round(value).toLocaleString("en-US");
  return value.toPrecision(3).replace(/\.?0+$/, (match) => (match.includes(".") ? "" : match));
}
