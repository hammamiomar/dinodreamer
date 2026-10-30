// The Create screen: measurements left (the Objective column), the canvas, its
// transport and the run settings in the middle, inputs right (the title, one card per
// request and the Image group). This component routes events to the editor's actions
// and the run handle; the rules live in model.ts, state.ts and run/session.ts.

import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useEditorSession } from "../../app/editor-session";
import { resolveTokenHandoff } from "../../app/handoff";
import { useLibrary } from "../../app/library-session";
import { canAddRequest, findRequest, lookTermId, respondTermId } from "./model";
import { BrushPalette } from "./canvas/brush-palette";
import { CreationCanvas } from "./canvas/creation-canvas";
import { selectedMatch } from "./canvas/match";
import { ImageGroup, type OpenRow } from "./cards/image-group";
import { HeldCard } from "./cards/held-card";
import { RequestCard } from "./cards/request-card";
import { SourceWindowEditor } from "./cards/source-window-editor";
import { termProblem } from "./cards/status";
import { CardCodeSpace } from "./detail/card-code-space";
import { ObjectiveColumn } from "./objective/objective-column";
import { measuredCodes } from "./objective/rows";
import { FROM_GALLERY } from "./presentation";
import { defaultPair, termInk } from "./inks";
import { movementLightness } from "./run/movement";
import { latestShown } from "./run/session";
import { useStageImage } from "./run/stage-image";
import { areasLinked, paintedTerms, strokeScope, type Selection } from "./state";
import { PrepareOverlay, Transport } from "./transport";
import { RunSettings } from "./run-settings";
import { useCoarsePointer } from "./coarse-pointer";
import { parseReferenceLink } from "./reference-link";
import { deliverStroke, primaryErasesFor } from "./noise";
import { canSaveClip } from "./run/recording";
import { modelLoadedBefore, runGate } from "./run/model-download";
import { saveClip } from "./video/save-clip";
import { saveImage } from "./video/save-image";
import { RELEASE_NAME } from "../../app/config";
import { keepOnModule } from "../../ui/module-snap";
import { forgetLastCreation } from "../../storage/last-creation";
import { fill } from "../../app/site-words";
import { CREATE_TEXT } from "./create-text";
import "./editor.css";

const WORDS = CREATE_TEXT.page;

export function CreatePage() {
  const { state, dispatch, run, save, inks } = useEditorSession();
  const library = useLibrary();
  const { session } = run;
  // The run settings are a section: their top is kept on the 64 px module, 768 or 832 at 900 px high, whatever the transport's note adds above them.
  const stageColumn = useRef<HTMLDivElement>(null);
  useEffect(() => (stageColumn.current ? keepOnModule(stageColumn.current, ".run-settings") : undefined), []);
  const [windowTarget, setWindowTarget] = useState<{ requestId: number; imageId: number } | null>(null);
  /** The area of the Objective row under the pointer; the canvas shows it in place of the selection. */
  const [highlight, setHighlight] = useState<Selection | null>(null);
  /** The movement map is under the pointer: the canvas lays it over the image. */
  const [movementHovered, setMovementHovered] = useState(false);
  /** Save video: encoding in progress, and why the last save (of a video or an image) failed. */
  const [savingClip, setSavingClip] = useState(false);
  const [clipFailure, setClipFailure] = useState<string | null>(null);
  /** A row without an area whose sentence is open: an image rule or Zoom. */
  const [openRow, setOpenRow] = useState<OpenRow>(null);
  /** The armed palette's readout slot, where the canvas writes the cell under the pointer. */
  const [readoutSlot, setReadoutSlot] = useState<HTMLElement | null>(null);
  const coarse = useCoarsePointer();
  /** Whether this browser loaded the model on an earlier visit: then Run needs no question first. */
  const [loadedBefore] = useState(() => modelLoadedBefore());
  const galleryRuleId = useId();

  const shown = latestShown(session);
  // The saved picture of a reopened creation until the run has restored it, else the run's image.
  const stage = useStageImage(state.openedPicture, session);
  const selection = state.selectedTerm;
  const recipe = state.recipe;

  // Escape clears the selection, so the canvas shows the clean picture. An Escape a dialog
  // has already handled (the source window or the colour picker closing) is not also a deselect.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        dispatch({ type: "deselect" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  // A selected area closes an open sentence elsewhere: one explanation at a time.
  useEffect(() => {
    if (selection !== null) setOpenRow(null);
  }, [selection]);

  // Hold the linked patch after its record loads. Navigation cancels an obsolete handoff.
  const [search, setSearch] = useSearchParams();
  const linked = search.get("hold");
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  useEffect(() => {
    const reference = parseReferenceLink(linked);
    if (!reference) return;
    let current = true;
    setLinkProblem(null);
    const clean = () => setSearch({}, { replace: true });
    resolveTokenHandoff(library, reference).then(
      (handoff) => {
        if (!current) return;
        dispatch({ type: "holdRequest", handoff });
        clean();
      },
      (error: unknown) => {
        if (!current) return;
        setLinkProblem(fill(CREATE_TEXT.canvas.linkProblem, { message: error instanceof Error ? error.message : String(error) }));
        clean();
      },
    );
    return () => { current = false; };
  }, [linked, library, dispatch, setSearch]);

  function restartFromSeed(seed: number) {
    dispatch({ type: "setSeed", seed });
    run.restart(seed);
  }

  async function savePicture() {
    if (!stage.pixels) return;
    setClipFailure(null);
    try {
      await saveImage(stage.pixels, state.title, stage.step ?? 0);
    } catch (error) {
      setClipFailure(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveVideo() {
    setSavingClip(true);
    setClipFailure(null);
    try {
      await saveClip(run.recording, state.title, shown);
    } catch (error) {
      setClipFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingClip(false);
    }
  }

  /**
   * The brush for one card or row: live where the selection is, greyed in place elsewhere.
   * Each ends with the readout slot; the armed one's is where the canvas writes.
   */
  const paletteFor = (armed: boolean, erases: boolean, paintsStrength = true) => (
    <BrushPalette
      brush={state.brush}
      coarse={coarse}
      disabled={!armed}
      paintsStrength={paintsStrength}
      erases={erases}
      readout
      slotRef={armed ? setReadoutSlot : undefined}
      onOpacity={(opacity) => dispatch({ type: "setBrushOpacity", opacity })}
      onSize={(size) => dispatch({ type: "setBrushSize", size })}
      onErase={(erasing) => dispatch({ type: "setBrushErasing", erasing })}
    />
  );

  const windowRequest = windowTarget ? findRequest(recipe, windowTarget.requestId) : undefined;
  const windowReference = windowRequest?.lookLike.references.find((reference) => reference.token.imageId === windowTarget?.imageId);
  const movementOverlay = movementHovered && session.movement ? movementLightness(session.movement.cells) : undefined;

  return (
    <main className="create-page">
      <ObjectiveColumn
        recipe={recipe}
        inks={inks}
        session={session}
        selection={selection}
        openTerm={openRow === "zoom" ? null : openRow}
        onHighlight={setHighlight}
        onHoverMovement={setMovementHovered}
        onSelectRow={(row) => (row.select ? dispatch({ type: "select", selection: row.select }) : openSentence(row.termId))}
      />

      <div className="create-stage" ref={stageColumn}>
        <div className="canvas-wrap">
          <h1 className="label create-heading">{CREATE_TEXT.heading}</h1>
          <CreationCanvas
            pixels={stage.pixels}
            recipe={recipe}
            inks={inks}
            opened={state.opened}
            selection={selection}
            highlight={highlight}
            movement={movementOverlay}
            brush={state.brush}
            primaryErases={primaryErasesFor(selection, state.brush.erasing)}
            strokeScope={strokeScope(state, selection)}
            match={selectedMatch(selection, session)}
            emptyHint
            refusal={state.refusal}
            readoutTarget={readoutSlot}
            onStroke={(stroke, target) => deliverStroke(target.selection, stroke, { dispatch, reseed: run.reseed }, target)}
            anchorPick={state.anchorPick}
            onAnchorCell={(cell) => dispatch({ type: "placePathAnchor", cell })}
            onCancelAnchor={() => dispatch({ type: "cancelPathAnchor" })}
            onBrushSize={(size) => dispatch({ type: "setBrushSize", size })}
          />
          <PrepareOverlay session={session} />
          {linkProblem && <p className="muted" role="alert">{linkProblem}</p>}
        </div>
        <Transport
          session={session}
          seed={recipe.seed}
          storedStep={stage.stored ? stage.step : undefined}
          clip={{ ready: canSaveClip(run.recording), saving: savingClip, failure: clipFailure, onSave: () => void saveVideo() }}
          image={{ ready: stage.pixels !== undefined, onSave: () => void savePicture() }}
          gate={runGate(run.engine, session, loadedBefore)}
          onRun={run.run}
          onPause={run.pause}
          onStep={run.step}
          onSeed={(seed) => dispatch({ type: "setSeed", seed })}
          onReset={restartFromSeed}
        />
        <RunSettings optimizer={recipe.optimizer} onChange={(change) => dispatch({ type: "setOptimizer", change })} />
      </div>

      <aside className="requests" aria-label={WORDS.requests}>
        <div className="requests-head">
          {/* A Gallery entry not yet changed (the gallery rule, state.ts): the line reads into its title. */}
          {state.fromGallery && (
            <p className="label creation-origin" title={FROM_GALLERY.rule}>
              {FROM_GALLERY.label}
              <span id={galleryRuleId} hidden>
                {FROM_GALLERY.rule}
              </span>
            </p>
          )}
          <input
            className="creation-title display"
            aria-label={WORDS.title}
            aria-describedby={state.fromGallery ? galleryRuleId : undefined}
            value={state.title}
            onChange={(event) => dispatch({ type: "setTitle", title: event.currentTarget.value })}
          />
          <ClearControl saved={state.savedId !== undefined} onClear={clear} />
        </div>
        <div className="requests-scroll">
          {recipe.requests.length === 0 && !state.heldRequest && <p className="requests-empty label">{WORDS.noRequests}</p>}
          {recipe.requests.map((request) => {
            const measurement = measuredCodes(session, request);
            const selectedTerm = selection?.kind === "term" && selection.requestId === request.id ? selection.term : undefined;
            return (
              <RequestCard
                key={request.id}
                request={request}
                ink={termInk(inks, request.id, "respond")}
                look={termInk(inks, request.id, "look")}
                selectedTerm={selectedTerm}
                paints={paintedTerms(state, request.id)}
                linked={areasLinked(state, request.id)}
                problems={{
                  respond: termProblem(recipe, respondTermId(request.id)),
                  look: termProblem(recipe, lookTermId(request.id)),
                }}
                brushPalette={paletteFor(selectedTerm !== undefined, true)}
                codeSpace={
                  <CardCodeSpace
                    opened={state.opened}
                    request={request}
                    ink={termInk(inks, request.id, "respond")}
                    measurement={measurement}
                    trail={measurement ? (session.meanTrail[request.id] ?? []) : []}
                    dispatch={dispatch}
                  />
                }
                previewUrl={(imageId) => library.previewUrl(imageId)}
                dispatch={dispatch}
                onEditWindow={(imageId) => setWindowTarget({ requestId: request.id, imageId })}
              />
            );
          })}
          {state.heldRequest && (
            <HeldCard
              handoff={state.heldRequest}
              ink={defaultPair(inks, recipe.requests.length).code}
              selected={selection?.kind === "held"}
              brushPalette={paletteFor(selection?.kind === "held", false)}
              previewUrl={(imageId) => library.previewUrl(imageId)}
              dispatch={dispatch}
            />
          )}
          {!canAddRequest(recipe) && <p className="label">{WORDS.full}</p>}
          <ImageGroup
            recipe={recipe}
            zoomWhenOn={state.zoomWhenOn}
            open={openRow}
            selectedTool={selection?.kind === "protect" || selection?.kind === "noise" ? selection.kind : null}
            brushPalette={paletteFor(selection?.kind === "protect", true, false)}
            noiseBrushPalette={paletteFor(selection?.kind === "noise", false, false)}
            onOpen={(row) => (row === null ? setOpenRow(null) : openSentence(row))}
            dispatch={dispatch}
          />
          {save.kind === "failed" && <p className="label save-failed">{fill(WORDS.notSaved, { message: save.message })}</p>}
        </div>

        {windowTarget && windowReference && (
          <SourceWindowEditor
            reference={windowReference}
            src={library.previewUrl(windowReference.token.imageId)}
            onCommit={(source) => dispatch({ type: "setSourceWindow", requestId: windowTarget.requestId, imageId: windowTarget.imageId, source })}
            onRemove={() => {
              dispatch({ type: "removeReference", requestId: windowTarget.requestId, imageId: windowTarget.imageId });
              setWindowTarget(null);
            }}
            onClose={() => setWindowTarget(null)}
          />
        )}
      </aside>
    </main>
  );

  /** Clear: a new, empty creation; a reload must not bring the one before back. */
  function clear() {
    if (state.savedId) forgetLastCreation(state.savedId);
    dispatch({ type: "clear", release: RELEASE_NAME });
  }

  /** Opens one row's sentence; the brush is off meanwhile, as that row has no area. */
  function openSentence(row: Exclude<OpenRow, null>) {
    dispatch({ type: "deselect" });
    setOpenRow((current) => (current === row ? null : row));
  }
}

/**
 * Clear asks for confirmation beside the title: everything on the
 * canvas goes, while a saved creation stays in Saved. Escape or Keep closes the question.
 */
function ClearControl({ saved, onClear }: { saved: boolean; onClear(): void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="link-control clear-control" onClick={() => setAsking(true)}>
        {WORDS.clear}
      </button>
    );
  }
  return (
    <div
      className="clear-question"
      role="group"
      aria-label={WORDS.clearName}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setAsking(false);
        }
      }}
    >
      <p className="label">
        {WORDS.clearQuestion}
        {saved ? WORDS.clearSaved : ""}
      </p>
      <button
        type="button"
        className="button danger"
        // Focus moves to the question once, as it opens; a run's frames re-render it without moving focus.
        autoFocus
        onClick={() => {
          setAsking(false);
          onClear();
        }}
      >
        {WORDS.clear}
      </button>
      <button type="button" className="button" onClick={() => setAsking(false)}>
        {WORDS.keep}
      </button>
    </div>
  );
}
