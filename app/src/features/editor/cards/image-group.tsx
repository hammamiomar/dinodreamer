// Image-wide controls: Protect and Noise paint cells; Smoothness and Restraint
// contribute loss terms; Zoom moves the image between updates. Protect and Noise
// keep their descriptions and brushes in place when deselected to avoid layout shifts.

import type { CSSProperties, Dispatch, ReactNode } from "react";
import { MAX_ZOOM_PER_UPDATE, type Recipe } from "../../../recipe";
import { areaSize, percentOfZoom, zoomFromPercent, type TermId } from "../model";
import { MOTION_TEXT, NOISE_TEXT, TERM_TEXT, palette } from "../presentation";
import type { EditorAction } from "../state";
import { Stepper } from "./stepper";
import type { StepRule } from "./stepping";
import { TermRow, TermSwitch } from "./term-row";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";

const WORDS = CREATE_TEXT.image;

/** A row without an area is "open" rather than selected: its sentence shows, nothing is painted. */
export type OpenRow = TermId | "zoom" | null;

export function ImageGroup({
  recipe,
  zoomWhenOn,
  open,
  selectedTool,
  brushPalette,
  noiseBrushPalette,
  onOpen,
  dispatch,
}: {
  recipe: Recipe;
  /** The zoom the switch turns on (state.ts): the stepper shows it, on or off. */
  zoomWhenOn: number;
  open: OpenRow;
  /** The painted image tool that is selected, if one is: Protect or Noise. */
  selectedTool: "protect" | "noise" | null;
  /** Protect's brush: live while Protect is selected, greyed otherwise. */
  brushPalette: ReactNode;
  /** The same brush for Noise, which only re-seeds: its hint says so and it offers no Erase. */
  noiseBrushPalette: ReactNode;
  onOpen(row: OpenRow): void;
  dispatch: Dispatch<EditorAction>;
}) {
  const accent = palette().ask;
  const rules = [
    { id: "rules:tv" as const, text: TERM_TEXT.tv, term: recipe.rules.tv },
    { id: "rules:l2" as const, text: TERM_TEXT.l2, term: recipe.rules.l2 },
  ];
  return (
    <section className="image-group" data-card="image" aria-label={WORDS.name}>
      <h3 className="label">{WORDS.name}</h3>
      <ProtectRow
        protect={recipe.protect}
        selected={selectedTool === "protect"}
        brushPalette={brushPalette}
        dispatch={dispatch}
      />
      <NoiseRow selected={selectedTool === "noise"} brushPalette={noiseBrushPalette} dispatch={dispatch} />
      {rules.map((rule) => (
        <TermRow
          key={rule.id}
          name={rule.text.name}
          sentence={rule.text.definition}
          ink={accent}
          enabled={rule.term.enabled}
          weight={rule.term.weight}
          selected={open === rule.id}
          onSelect={() => onOpen(open === rule.id ? null : rule.id)}
          onEnabled={(enabled) => dispatch({ type: "setTermEnabled", termId: rule.id, enabled })}
          onWeight={(weight) => dispatch({ type: "setTermWeight", termId: rule.id, weight })}
        />
      ))}
      <ZoomRow
        zoomPerUpdate={recipe.motion.zoomPerUpdate}
        zoomWhenOn={zoomWhenOn}
        open={open === "zoom"}
        onOpen={() => onOpen(open === "zoom" ? null : "zoom")}
        dispatch={dispatch}
      />
    </section>
  );
}

/**
 * Protected cells keep the base image's pixels: the image when the cells were protected.
 * With Motion on, the base image zooms with the image (engine image.rs), so they move too.
 */
function ProtectRow({
  protect,
  selected,
  brushPalette,
  dispatch,
}: {
  protect: boolean[];
  selected: boolean;
  brushPalette: ReactNode;
  dispatch: Dispatch<EditorAction>;
}) {
  const count = areaSize(protect);
  // Keep the zoom clause in place so toggling zoom does not move the rows below.
  const sentence = WORDS.protectSentence;
  return (
    <div className={`term-row${selected ? " selected" : ""}`} style={{ "--paint": palette().text } as CSSProperties}>
      <div className="term-line" onClick={() => dispatch(selected ? { type: "deselect" } : { type: "select", selection: { kind: "protect" } })}>
        <button type="button" className="term-select" aria-pressed={selected}>
          {WORDS.protect}
          {count > 0 && <span className="label term-scope"> · {count === 1 ? WORDS.oneCell : fill(WORDS.cells, { count })}</span>}
        </button>
        {count > 0 && (
          <button
            type="button"
            className="chip"
            onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: "clearProtect" });
            }}
          >
            {WORDS.clear}
          </button>
        )}
        <span className="label">{selected ? WORDS.painting : WORDS.paint}</span>
      </div>
      <p className="term-sentence label">{sentence}</p>
      {brushPalette}
    </div>
  );
}

/**
 * The Noise tool: painted like an area, but a stroke is not a recipe edit. When it ends,
 * the worker re-seeds the image under the painted cells (noise.ts); nothing stays painted.
 */
function NoiseRow({ selected, brushPalette, dispatch }: { selected: boolean; brushPalette: ReactNode; dispatch: Dispatch<EditorAction> }) {
  return (
    <div className={`term-row${selected ? " selected" : ""}`} style={{ "--paint": palette().ask } as CSSProperties}>
      <div className="term-line" onClick={() => dispatch(selected ? { type: "deselect" } : { type: "select", selection: { kind: "noise" } })}>
        <button type="button" className="term-select" aria-pressed={selected}>
          {NOISE_TEXT.name}
        </button>
        <span className="label">{selected ? WORDS.painting : WORDS.paint}</span>
      </div>
      <p className="term-sentence label">{NOISE_TEXT.definition}</p>
      {brushPalette}
    </div>
  );
}

/**
 * The zoom's stepper, in percent per update: 0.1 % a press, 1 % with Shift,
 * from 0.1 % to the recipe's maximum, 5 %. The switch is the off, so 0 is not a stepper value.
 */
const ZOOM_STEPS: StepRule = { step: 0.1, largeStep: 1, min: 0.1, max: percentOfZoom(MAX_ZOOM_PER_UPDATE) };

/**
 * The Zoom row, as a term's row is: the name, the
 * stepper, the switch. The switch turns the zoom off (0) or on (the stepper's amount); the
 * stepper stays live while off and shows what on will send. Its value keeps one decimal in a
 * fixed cell, so changing its value does not move the control under the pointer.
 */
function ZoomRow({
  zoomPerUpdate,
  zoomWhenOn,
  open,
  onOpen,
  dispatch,
}: {
  zoomPerUpdate: number;
  zoomWhenOn: number;
  open: boolean;
  onOpen(): void;
  dispatch: Dispatch<EditorAction>;
}) {
  return (
    <div className={`term-row${open ? " selected" : ""}${zoomPerUpdate > 0 ? "" : " off"}`} style={{ "--paint": palette().ask } as CSSProperties}>
      <div className="term-line" onClick={onOpen}>
        <button type="button" className="term-select" aria-pressed={open}>
          {MOTION_TEXT.name}
        </button>
        <span className="term-weight label mono" onClick={(event) => event.stopPropagation()}>
          <Stepper
            kind="zoom"
            value={percentOfZoom(zoomWhenOn)}
            label={WORDS.zoomName}
            subject={WORDS.zoomSubject}
            rule={ZOOM_STEPS}
            unit="%"
            format={(percent) => percent.toFixed(1)}
            spoken={(percent) => fill(WORDS.zoomSpoken, { percent: percent.toFixed(1) })}
            onCommit={(percent) => dispatch({ type: "setZoomAmount", zoomPerUpdate: zoomFromPercent(percent) })}
          />
        </span>
        <TermSwitch on={zoomPerUpdate > 0} label={MOTION_TEXT.name} onChange={(on) => dispatch({ type: "setZoomOn", on })} />
      </div>
      {open && <p className="term-sentence label">{MOTION_TEXT.definition}</p>}
    </div>
  );
}
