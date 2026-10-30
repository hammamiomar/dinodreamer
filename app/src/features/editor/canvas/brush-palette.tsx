// Shared brush controls for size, opacity and paint/erase. Opacity controls future
// deposits, independently of term weight. The size glyph shows the 9 × 9 footprint
// at its falloff. On Create, the palette ends with a fixed-height cell readout slot.

import type { Ref } from "react";
import { Segmented } from "../../../ui/segmented";
import { Stepper } from "../cards/stepper";
import { BrushGlyph, EraserGlyph, OpacityGlyph } from "../glyphs";
import { BRUSH_HINT } from "../presentation";
import { BRUSH_OPACITY_STEPS, BRUSH_SIZE_STEPS, FOOTPRINT_GLYPH_SIDE, clampBrushOpacity, clampBrushSize, footprintGlyph, type Brush } from "./brush";
import { shownStrength } from "./overlay";
import { CREATE_TEXT } from "../create-text";
import "./canvas.css";

const WORDS = CREATE_TEXT.brush;

/** Paint or erase as two glyphs; each glyph's word is its accessible name. Erase off means paint. */
const STROKE_SEGMENTS = [
  {
    value: "paint" as const,
    label: (
      <>
        <BrushGlyph />
        <span className="glyph-name">{WORDS.paint}</span>
      </>
    ),
  },
  {
    value: "erase" as const,
    label: (
      <>
        <EraserGlyph />
        <span className="glyph-name">{WORDS.erase}</span>
      </>
    ),
  },
];

export function BrushPalette({
  brush,
  coarse,
  disabled = false,
  erases = true,
  paintsStrength = true,
  wheelNeedsButton = false,
  readout = false,
  slotRef,
  onOpacity,
  onSize,
  onErase,
}: {
  brush: Brush;
  coarse: boolean;
  /** Greyed in its place: the brush paints another selection. */
  disabled?: boolean;
  erases?: boolean;
  /** Protect and Noise select cells and have no opacity control. */
  paintsStrength?: boolean;
  wheelNeedsButton?: boolean;
  /** Ends with the readout slot (Create); the slot is there, empty, in a greyed palette too, so nothing moves. */
  readout?: boolean;
  /** The armed palette's slot, where the canvas writes its readout. */
  slotRef?: Ref<HTMLParagraphElement>;
  onOpacity(opacity: number): void;
  onSize(size: number): void;
  onErase(on: boolean): void;
}) {
  return (
    // A fieldset, so one attribute takes every control of the brush out of use.
    <fieldset className="brush-palette" disabled={disabled} title={brushHint(coarse, wheelNeedsButton, erases, paintsStrength)}>
      {/* A span, not a label: a label would pass a click on its glyph to the stepper's − button. */}
      <span className="brush-group" title={WORDS.sizeTitle}>
        <FootprintGlyph size={brush.size} selects={!paintsStrength} />
        <Stepper kind="size" value={brush.size} label={WORDS.sizeName} rule={BRUSH_SIZE_STEPS} integer onCommit={(size) => onSize(clampBrushSize(size))} />
      </span>
      {/* Opacity and paint or erase wrap together onto a second line in a narrow card; size stays by the lock. */}
      {(paintsStrength || erases) && (
        <span className="brush-groups">
          {paintsStrength && (
            <span className="brush-group" title={WORDS.opacityTitle}>
              <OpacityGlyph />
              <Stepper
                kind="opacity"
                value={brush.opacity}
                label={WORDS.opacityName}
                rule={BRUSH_OPACITY_STEPS}
                integer
                unit="%"
                onCommit={(opacity) => onOpacity(clampBrushOpacity(opacity))}
              />
            </span>
          )}
          {erases && (
            <span className="brush-group brush-stroke">
              <Segmented label={WORDS.stroke} segments={STROKE_SEGMENTS} value={brush.erasing ? "erase" : "paint"} onChange={(stroke) => onErase(stroke === "erase")} />
            </span>
          )}
        </span>
      )}
      {readout && <p className="brush-slot" ref={slotRef} />}
    </fieldset>
  );
}

/** One glyph cell, in glyph units: the cells are 3 units apart with a 0.4 gap, so they read as a grid. */
const GLYPH_CELL = { pitch: 3, gap: 0.4 } as const;
/** The empty cells, fainter than the faintest touched cell (a quarter), so the 9 × 9 square shows. */
const GLYPH_EMPTY_OPACITY = 0.08;

/**
 * The brush's footprint as the size's glyph: the 9 × 9 cells around a dab's centre, the cells
 * one dab touches filled at their falloff as the canvas shows a coat (overlay.ts shownStrength:
 * 0.25 + 0.75 × falloff, so the soft edge of a large brush stays in view), in the card's ink.
 * Protect and Noise take every touched cell whole, so their cells are filled solid.
 */
function FootprintGlyph({ size, selects }: { size: number; selects: boolean }) {
  const side = FOOTPRINT_GLYPH_SIDE * GLYPH_CELL.pitch;
  return (
    <svg className="glyph footprint-glyph" viewBox={`0 0 ${side} ${side}`} width={side} height={side} aria-hidden="true">
      {footprintGlyph(size).map((falloff, index) => (
        <rect
          key={index}
          x={(index % FOOTPRINT_GLYPH_SIDE) * GLYPH_CELL.pitch}
          y={Math.floor(index / FOOTPRINT_GLYPH_SIDE) * GLYPH_CELL.pitch}
          width={GLYPH_CELL.pitch - GLYPH_CELL.gap}
          height={GLYPH_CELL.pitch - GLYPH_CELL.gap}
          fill="currentColor"
          fillOpacity={falloff > 0 ? (selects ? 1 : shownStrength(falloff * 100)) : GLYPH_EMPTY_OPACITY}
        />
      ))}
    </svg>
  );
}

export function brushHint(coarse: boolean, wheelNeedsButton: boolean, erases: boolean, paintsStrength = true): string {
  if (!erases && !paintsStrength) return coarse ? BRUSH_HINT.noiseCoarse : wheelNeedsButton ? BRUSH_HINT.noiseDock : BRUSH_HINT.noise;
  if (!erases) return coarse ? BRUSH_HINT.heldCoarse : wheelNeedsButton ? BRUSH_HINT.heldDock : BRUSH_HINT.held;
  if (coarse) return BRUSH_HINT.coarse;
  return wheelNeedsButton ? BRUSH_HINT.dock : BRUSH_HINT.fine;
}
