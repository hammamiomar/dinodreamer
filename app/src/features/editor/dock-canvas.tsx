// The editor dock shares the creation and run with Create. It appears in a block
// panel rail or a folding tray, with the title, canvas, request slots and brush.
// Over Create it also shows the open request's Appearance pictures. A folded tray
// is inert so keyboard focus stays on its tab.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { useEditorSession } from "../../app/editor-session";
import { BrushPalette } from "./canvas/brush-palette";
import { LockSquare } from "./canvas/lock-square";
import { CreationCanvas } from "./canvas/creation-canvas";
import { pixelsToCanvas } from "./canvas/draw";
import { selectedMatch } from "./canvas/match";
import { ReferenceStrip } from "./cards/picture-strip";
import { useCoarsePointer } from "./coarse-pointer";
import { dockSlots, dockSlotsLine, type DockSlot } from "./dock-slots";
import { findRequest, hasPaintedRespondArea, type AreaTerm } from "./model";
import { deliverStroke, primaryErasesFor, selectionErases } from "./noise";
import { BRUSH_HELP, FROM_GALLERY, NOISE_TEXT, TERM_TEXT } from "./presentation";
import { termInk } from "./inks";
import { modelLoadedBefore, runGate } from "./run/model-download";
import type { RunHandle } from "./run/use-run";
import { useStageImage, type StageStep } from "./run/stage-image";
import { paintableSelection, strokeScope, type EditorAction, type EditorState, type Selection } from "./state";
import { Segmented } from "../../ui/segmented";
import { fill } from "../../app/site-words";
import { CREATE_TEXT } from "./create-text";
import "./dock-canvas.css";

const WORDS = CREATE_TEXT.dock;

export type DockForm = "rail" | "tray";

export function DockCanvas({
  size = 320,
  form,
  blockOnShow = null,
  requestId = null,
  folded = false,
  onToggle,
}: {
  size?: number;
  /** In the panel's rail column, which draws the ground; or a tray, which draws its own. */
  form: DockForm;
  /** The block of the open panel; its request's slot is marked. */
  blockOnShow?: number | null;
  /** Over Create: the request the panel was opened from, whose Appearance pictures end the dock. */
  requestId?: number | null;
  /** The tray is folded to its tab. */
  folded?: boolean;
  /** Folds or opens the tray; absent in the rail, which never folds, and then there is no tab. */
  onToggle?(): void;
}) {
  const { state, dispatch, run, inks } = useEditorSession();
  const { session } = run;
  const coarse = useCoarsePointer();
  const [loadedBefore] = useState(() => modelLoadedBefore());
  const stage = useStageImage(state.openedPicture, session);
  const target = paintableSelection(state.recipe, state.selectedTerm);
  const scope = strokeScope(state, state.selectedTerm);
  const slots = dockSlots(state.recipe, state.heldRequest?.block ?? null, state.selectedTerm, blockOnShow, inks);
  const trayId = useId();
  const galleryRuleId = useId();
  // A folded tray is off the window below its tab: inert, so Tab and assistive technology pass over it.
  const tray = useRef<HTMLElement>(null);
  useEffect(() => {
    if (tray.current) tray.current.inert = folded;
  }, [folded]);

  return (
    <>
      {onToggle && <DockTab folded={folded} trayId={trayId} pixels={stage.pixels} onToggle={onToggle} />}
      <section
        ref={tray}
        id={trayId}
        className="dock"
        data-form={form}
        style={{ "--dock-canvas": `${size}px` } as CSSProperties}
        aria-label={WORDS.name}
      >
      <header className="dock-head">
        {/* A Gallery entry not yet changed (the gallery rule, state.ts): the line reads into its title. */}
        {state.fromGallery && (
          <p className="label dock-origin" title={FROM_GALLERY.rule}>
            {FROM_GALLERY.label}
            <span id={galleryRuleId} hidden>
              {FROM_GALLERY.rule}
            </span>
          </p>
        )}
        <input
          className="dock-title"
          aria-label={WORDS.title}
          aria-describedby={state.fromGallery ? galleryRuleId : undefined}
          value={state.title}
          onChange={(event) => dispatch({ type: "setTitle", title: event.currentTarget.value })}
        />
        {hasImage(run, stage) && <StepLabel image={stage} />}
        {/* The Atlas and the block viewer never start the download: Run shows once the model is in this browser. */}
        {runGate(run.engine, session, loadedBefore) === null && <RunChip run={run} />}
        <Link to="/create" className="chip" aria-label={WORDS.openName}>
          {WORDS.open}
        </Link>
      </header>
      <div className="dock-body">
        <CreationCanvas
          pixels={stage.pixels}
          recipe={state.recipe}
          inks={inks}
          opened={state.opened}
          selection={state.selectedTerm}
          brush={state.brush}
          primaryErases={primaryErasesFor(target, state.brush.erasing)}
          strokeScope={scope}
          match={selectedMatch(state.selectedTerm, session)}
          wheelNeedsButton
          refusal={state.refusal}
          onStroke={(stroke, target) => deliverStroke(target.selection, stroke, { dispatch, reseed: run.reseed }, target)}
          anchorPick={state.anchorPick}
          onAnchorCell={(cell) => dispatch({ type: "placePathAnchor", cell })}
          onCancelAnchor={() => dispatch({ type: "cancelPathAnchor" })}
          onBrushSize={(brushSize) => dispatch({ type: "setBrushSize", size: brushSize })}
        />
        <RequestSlots
          slots={slots}
          line={dockSlotsLine(slots)}
          onSlot={(slot) => dispatch(slotAction(slot))}
        />
        {target && (
          <div className="dock-brush" data-card="brush">
            <div className="dock-target-line">
              <BrushTarget
                state={state}
                target={target}
                linked={scope === "request"}
                onTerm={(requestId, term) => dispatch({ type: "select", selection: { kind: "term", requestId, term } })}
              />
              {target.kind === "term" && hasLock(state, target.requestId) && (
                <span className="dock-lock" style={{ "--paint": termInk(inks, target.requestId, "respond") } as CSSProperties}>
                  <LockSquare
                    linked={scope === "request"}
                    onChange={(linked) => dispatch({ type: "setAreasLinked", requestId: target.requestId, linked })}
                  />
                </span>
              )}
            </div>
            <BrushPalette
              brush={state.brush}
              coarse={coarse}
              paintsStrength={paintsStrength(target)}
              erases={selectionErases(target)}
              wheelNeedsButton
              onOpacity={(opacity) => dispatch({ type: "setBrushOpacity", opacity })}
              onSize={(brushSize) => dispatch({ type: "setBrushSize", size: brushSize })}
              onErase={(erasing) => dispatch({ type: "setBrushErasing", erasing })}
            />
            {paintsStrength(target) && <p className="dock-brush-help label">{BRUSH_HELP}</p>}
          </div>
        )}
        {requestId !== null && <ReferenceStrip requestId={requestId} />}
      </div>
      </section>
    </>
  );
}

/**
 * The tray's tab, on its top edge at the window's right: the live thumbnail, "Canvas", and
 * a chevron that points the way the tray will move. It is the one control that folds and
 * opens the tray, so focus stays on it through both.
 */
function DockTab({ folded, trayId, pixels, onToggle }: { folded: boolean; trayId: string; pixels?: Uint8ClampedArray; onToggle(): void }) {
  return (
    <button type="button" className="dock-tab" aria-expanded={!folded} aria-controls={trayId} onClick={onToggle}>
      <DockThumbnail pixels={pixels} />
      <span className="dock-tab-name">{WORDS.tab}</span>
      <svg className="glyph dock-tab-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d={folded ? "M4 10 L8 6 L12 10" : "M4 6 L8 10 L12 6"} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}

type ChoosableSlot = Extract<DockSlot, { kind: "request" | "held" }>;

/** A click on a slot: it selects its request or the held token for the brush, or lets go of it when it is selected. */
function slotAction(slot: ChoosableSlot): EditorAction {
  if (slot.selected) return { type: "deselect" };
  if (slot.kind === "held") return { type: "select", selection: { kind: "held" } };
  return { type: "activateRequest", requestId: slot.requestId };
}

/** One slot per request the creation can hold; a request's slot, or the held token's, selects it for the brush. */
function RequestSlots({
  slots,
  line,
  onSlot,
}: {
  slots: DockSlot[];
  line: string;
  onSlot(slot: ChoosableSlot): void;
}) {
  return (
    <div className="dock-slots">
      <ul className="dock-slot-row" aria-label={WORDS.slots}>
        {slots.map((slot, index) => (
          <li key={slot.kind === "request" ? `request-${slot.requestId}` : `${slot.kind}-${index}`} className="dock-slot" data-kind={slot.kind}>
            <SlotContent slot={slot} onSlot={onSlot} />
          </li>
        ))}
      </ul>
      <p className="label dock-slots-line">{line}</p>
    </div>
  );
}

function SlotContent({ slot, onSlot }: { slot: DockSlot; onSlot(slot: ChoosableSlot): void }) {
  switch (slot.kind) {
    case "held":
      return (
        <button
          type="button"
          className="chip dock-slot-request dock-slot-held"
          aria-pressed={slot.selected}
          aria-label={fill(WORDS.heldSlot, { block: slot.block })}
          style={inkStyle(slot.ink)}
          onClick={() => onSlot(slot)}
        >
          <i className="dock-slot-ink" aria-hidden="true" />
          {slot.block}
        </button>
      );
    case "request":
      return (
        <button
          type="button"
          className="chip dock-slot-request"
          aria-pressed={slot.selected}
          aria-label={fill(WORDS.requestSlot, { block: slot.block })}
          data-on-show={slot.onShow || undefined}
          style={inkStyle(slot.ink)}
          onClick={() => onSlot(slot)}
        >
          <i className="dock-slot-ink" aria-hidden="true" />
          {slot.block}
        </button>
      );
    case "empty":
      return null;
  }
}

function inkStyle(ink: string): CSSProperties {
  return { "--paint": ink } as CSSProperties;
}

/**
 * The creation has an image to name a step for: a run applied its recipe, or the saved
 * picture shows. Run shows without one: a run asked for before the engine is ready starts
 * once the recipe is applied (run/session.ts).
 */
function hasImage(run: RunHandle, image: StageStep): boolean {
  return run.session.applied !== undefined || image.stored;
}

function StepLabel({ image }: { image: StageStep }) {
  return <span className="label mono dock-step">{fill(WORDS.step, { step: image.step ?? 0 })}</span>;
}

/** The transport's Play and Pause, as words. */
function RunChip({ run }: { run: RunHandle }) {
  const running = run.session.wantsRunning;
  return (
    <button type="button" className="chip dock-run" onClick={running ? run.pause : run.run}>
      {running ? WORDS.pause : WORDS.play}
    </button>
  );
}

/** The live image at 24 px on the tab, so the folded tray reads as the creation. */
const THUMBNAIL_SIZE = 24;

function DockThumbnail({ pixels }: { pixels?: Uint8ClampedArray }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scratch = useMemo(() => document.createElement("canvas"), []);
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext("2d");
    if (!target || !context) return;
    const side = Math.round(THUMBNAIL_SIZE * (window.devicePixelRatio || 1));
    target.width = side;
    target.height = side;
    if (pixels) context.drawImage(pixelsToCanvas(pixels, scratch), 0, 0, side, side);
  }, [pixels, scratch]);
  return <canvas ref={canvas} className="dock-thumbnail" aria-hidden="true" />;
}

const TERM_SEGMENTS = [
  { value: "respond" as const, label: TERM_TEXT.respond.name },
  { value: "look" as const, label: TERM_TEXT.look.name },
];

/**
 * What a dock stroke paints, by name only: "Code and Appearance" for a linked request or
 * the held token, "Protect" or "Noise". An unlinked request offers its two term names, so
 * the visitor chooses which area the stroke paints; a CLS or storage request has one.
 */
function BrushTarget({
  state,
  target,
  linked,
  onTerm,
}: {
  state: EditorState;
  target: Selection;
  linked: boolean;
  onTerm(requestId: number, term: AreaTerm): void;
}) {
  if (target.kind === "term" && !linked) {
    const request = findRequest(state.recipe, target.requestId);
    if (request && hasPaintedRespondArea(request.respondLike.source)) {
      return <Segmented label={WORDS.brushArea} segments={TERM_SEGMENTS} value={target.term} onChange={(term) => onTerm(target.requestId, term)} />;
    }
  }
  return <span className="dock-target">{targetName(state, target)}</span>;
}

/** A request with a Code field has the lock between its two fields; a CLS or storage request has none. */
function hasLock(state: EditorState, requestId: number): boolean {
  const request = findRequest(state.recipe, requestId);
  return request !== undefined && hasPaintedRespondArea(request.respondLike.source);
}

/** Protect and Noise select cells; every other target takes strength, so its brush has an opacity. */
function paintsStrength(target: Selection): boolean {
  return target.kind !== "protect" && target.kind !== "noise";
}

function targetName(state: EditorState, target: Selection): string {
  if (target.kind === "protect") return WORDS.protect;
  if (target.kind === "noise") return NOISE_TEXT.name;
  const token = target.kind === "held" ? state.heldRequest?.token : findRequest(state.recipe, target.requestId)?.respondLike.source;
  // One area: a CLS or storage token's Appearance.
  if (token && !hasPaintedRespondArea(token)) return TERM_TEXT.look.name;
  return fill(CREATE_TEXT.areas.both, { respond: TERM_TEXT.respond.name, look: TERM_TEXT.look.name });
}
