// The movement map: what the latest update did to the image, one grey cell per grid
// cell, lightness = movement on the fixed scale of run/movement.ts, so maps compare
// across steps and runs and the image's settling shows as the map dimming. Drawn on a
// 16 × 16 canvas that the stylesheet sizes: the Objective column's width, so a cell is
// a readable square.

import { useEffect, useRef } from "react";
import { GRID } from "../../../recipe";
import { movementLightness } from "../run/movement";
import { CREATE_TEXT } from "../create-text";

export function MovementMap({ cells }: { cells?: Float32Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(GRID, GRID);
    const lightness = cells ? movementLightness(cells) : undefined;
    for (let cell = 0; cell < GRID * GRID; cell++) {
      const level = lightness ? Math.round(lightness[cell] * 255) : 0;
      image.data[cell * 4] = level;
      image.data[cell * 4 + 1] = level;
      image.data[cell * 4 + 2] = level;
      image.data[cell * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [cells]);
  return (
    <canvas
      ref={canvasRef}
      className="movement-map"
      width={GRID}
      height={GRID}
      role="img"
      aria-label={CREATE_TEXT.objective.movementMap}
    />
  );
}
