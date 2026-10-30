// The dictionary drawn as a square field of 16,384 small squares, one per block in number order,
// 128 a row (the home's code station, How's gate). Every block is a point, so the field reads as
// 16,384 places; the lit blocks fill their square and one chosen block is boxed. The caller sizes
// the field by CSS; the canvas redraws at its width.

import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { cssColour } from "./css-colour";
import "./dictionary-field.css";

/** The field's row: 128 blocks, so 16,384 make a square. */
export const FIELD_ROW = 128;

export function DictionaryField({ lit, chosen, className, snapToLit, onHover, onPick }: {
  /** The blocks to fill, in any order. */
  lit: readonly number[];
  /** The block to box, or none. */
  chosen: number | null;
  /** Sets the field's width; it is square. */
  className?: string;
  /** With it, the pointer takes the nearest lit block within that many squares, so a lit square a few pixels wide is easy to reach. */
  snapToLit?: number;
  /** The block under the pointer, or null when it leaves. */
  onHover?: (block: number | null) => void;
  onPick?: (block: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const { width } = element.getBoundingClientRect();
      if (!width) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(width * ratio);
      const context = element.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      const pitch = width / FIELD_ROW;
      const at = (number: number) => ({ x: (number % FIELD_ROW) * pitch, y: Math.floor(number / FIELD_ROW) * pitch });
      context.fillStyle = cssColour("--line-2", "rgb(255 255 255 / 0.28)");
      for (let number = 0; number < FIELD_ROW * FIELD_ROW; number++) {
        const { x, y } = at(number);
        context.fillRect(x + pitch / 2 - 0.5, y + pitch / 2 - 0.5, 1, 1);
      }
      for (const block of lit) {
        const { x, y } = at(block);
        context.fillStyle = cssColour(block === chosen ? "--ink" : "--ink-2", "#efece8");
        context.fillRect(x, y, pitch, pitch);
      }
      if (chosen !== null) {
        const { x, y } = at(chosen);
        context.strokeStyle = cssColour("--ink", "#efece8");
        context.lineWidth = 1;
        context.strokeRect(Math.round(x - 5) + 0.5, Math.round(y - 5) + 0.5, Math.round(pitch + 10), Math.round(pitch + 10));
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [lit, chosen]);
  const blockAt = (event: MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const pitch = box.width / FIELD_ROW;
    const column = Math.floor((event.clientX - box.left) / pitch);
    const row = Math.floor((event.clientY - box.top) / pitch);
    if (column < 0 || column >= FIELD_ROW || row < 0 || row >= FIELD_ROW) return null;
    const block = row * FIELD_ROW + column;
    if (!snapToLit || lit.includes(block)) return block;
    let nearest: number | null = null;
    let least = snapToLit + 0.5;
    for (const candidate of lit) {
      const distance = Math.hypot(candidate % FIELD_ROW - column, Math.floor(candidate / FIELD_ROW) - row);
      if (distance < least) { least = distance; nearest = candidate; }
    }
    return nearest ?? block;
  };
  return (
    <canvas
      ref={canvas}
      className={["dictionary-field", className].filter(Boolean).join(" ")}
      aria-hidden="true"
      onPointerMove={onHover && ((event) => onHover(blockAt(event)))}
      onPointerLeave={onHover && (() => onHover(null))}
      onClick={onPick && ((event) => {
        const block = blockAt(event);
        if (block !== null) onPick(block);
      })}
    />
  );
}
