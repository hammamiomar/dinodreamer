// Basis group detail view inside the sliding panel: strongest patches, published automata,
// interactive 3-D response plot, response-level rows, and training target controls.
// The initial read holds header, sample, and strongest rows; appending the first prefix of the
// full file never renumbers existing selection indices.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router";
import { useCanHoldRequest, useEditorDispatch } from "../../app/editor-session";
import { resolveTokenHandoff, tokenRole } from "../../app/handoff";
import { useLibrary } from "../../app/library-session";
import { useMaterialRequest } from "../../app/material-request";
import { useUploadedPicture } from "../../app/uploaded-picture";
import { withFirstPrefix, withNoticeLine, type BlockCloud } from "../../library/block-cloud";
import type { Library } from "../../library/library";
import { GRID, PATCH_SLOT_OFFSET, type StrengthCuts } from "../../recipe";
import { downloadBlob } from "../../ui/files";
import { keepOnModule } from "../../ui/module-snap";
import { useMaterialIndex } from "../gallery/material-gallery";
import { materialsOfBlock } from "../gallery/material-index";
import { aboutCount, BandRows, estimatedBandRows } from "./band-rows";
import { BlockHead } from "./block-head";
import { BlockMaterials } from "./block-materials";
import { CloudDetails, CloudTools } from "./cloud-controls";
import { pageHasPicture, pageToken, prepareCloud } from "./cloud-geometry";
import { cloudTokenKey, hasPicture, type CloudToken } from "./cloud-token";
import { CloudView, type CloudViewHandle, type LookTool } from "./cloud-view";
import { LOOK_TEXT } from "./look-text";
import { pictureGrowRequest } from "./grow-from-picture";
import { makeMaterialRequest, sentPoints } from "./material-request";
import { defaultOccurrence, leadingPictures, occurrenceRequest, type OccurrenceSource } from "./occurrence-request";
import { PictureHere } from "./picture-here";
import { anchorFollowingSelection, bandSelection, nearestInBand } from "./request-anchor";
import { RequestPanel, type AnchorReason, type CanvasState, type PageLift } from "./request-panel";
import { applyLasso, seedRegion, withinRegionRadius, REGION_SELECTION_DEFAULTS, REGION_GRAPH_ROWS, type LookSelection, type ProjectedPoint } from "./selection";
import { bandIndex, sampleStrengthCuts, STRONGEST, type BandIndex } from "./strength-bands";
import { BandChip } from "./strength-display";
import { StrongestPictures } from "./strongest-pictures";
import { trainPath } from "./strongest-request";
import { TokenPicture, TokenPreview } from "./token-pictures";
import { useRegionDistances } from "./region-graph";
import "./block-materials.css";
import "./look.css";

const STRONGEST_PICTURES = 8;
const MODULE_EDGES = ".look-head, .look-origin, .look-fires, .look-materials, .look-cloud, .look-bands";
const NO_INDICES: number[] = [];
const NO_TOKENS: CloudToken[] = [];

export interface LookData {
  cloud: BlockCloud;
  /** Band cuts derived from the public sample, matching the Index record. */
  strength: StrengthCuts;
}

export function lookData(cloud: BlockCloud): LookData {
  return { cloud, strength: sampleStrengthCuts(cloud.whole.gateMedian, cloud.sample.norms) };
}

/**
 * Remounts `LookBlock` when the block, uploaded picture revision, or origin patch changes so no
 * selection or anchor points at another picture's patches.
 */
export function LookContent({ data, origin, scroller }: { data: LookData; origin: CloudToken | null; scroller: RefObject<HTMLElement | null> }) {
  const upload = useUploadedPicture();
  const pictureRevision = upload.readout ? upload.revision : 0;
  const originKey = origin ? cloudTokenKey(origin) : "none";
  return <LookBlock key={`${data.cloud.whole.block}:${pictureRevision}:${originKey}`} data={data} origin={origin} scroller={scroller} />;
}

/** Interactive cloud selection, wand region expansion, anchor policy, and lift geometry. */
function useCloudSelection({
  cloud,
  prepared,
  strength,
  origin,
}: {
  cloud: BlockCloud;
  prepared: ReturnType<typeof prepareCloud>;
  strength: StrengthCuts;
  origin: CloudToken | null;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [inspected, setInspected] = useState<number | null>(prepared.ownByStrength[0] ?? prepared.strongest);
  const [advanced, setAdvanced] = useState(false);
  const [tool, setTool] = useState<LookTool>("turn");
  const [selection, setSelection] = useState<LookSelection>({ kind: "none" });
  const [chosenAnchor, setChosenAnchor] = useState<number | null>(null);
  const [radiusFraction, setRadiusFraction] = useState<number>(REGION_SELECTION_DEFAULTS.radiusFraction);

  const graphRows = Math.min(prepared.count, REGION_GRAPH_ROWS);
  const seeds = selection.kind === "wand" ? selection.seeds : NO_INDICES;
  const { distances, failed: regionFailed } = useRegionDistances(prepared.native, graphRows, seeds, advanced);
  const growing = selection.kind === "wand" && distances === null && !regionFailed;

  const selected = useMemo(() => {
    let indices: readonly number[] = NO_INDICES;
    if (selection.kind === "wand") indices = distances ? withinRegionRadius(distances, radiusFraction * strength.maximum) : selection.seeds;
    else if (selection.kind !== "none") indices = selection.indices;
    return indices.filter((index) => prepared.repeats[index] === 0);
  }, [selection, distances, radiusFraction, strength.maximum, prepared.repeats]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const followed = anchorFollowingSelection(selection, selected, prepared.norms);
  const anchor = chosenAnchor ?? followed;
  const anchorReason: AnchorReason | null = chosenAnchor !== null ? "chosen" : followed !== null && selection.kind !== "none" ? selection.kind : null;

  // The Level 4 library patch nearest a patch's direction, for any level: the lift below Level 4, a comparison at it.
  const nearestStrongest = useCallback((index: number): PageLift | null => {
    const near = nearestInBand(cloud.sample, prepared.native[index], STRONGEST, strength);
    return near && { index: prepared.own + near.index, degrees: near.degrees };
  }, [cloud.sample, prepared, strength]);
  const liftToStrongest = useCallback((index: number | null | undefined): PageLift | null => {
    if (index === null || index === undefined || prepared.bands[index] === STRONGEST) return null;
    return nearestStrongest(index);
  }, [prepared, nearestStrongest]);

  const anchorLift = useMemo(() => liftToStrongest(anchor), [liftToStrongest, anchor]);
  const ownMain = origin === null ? prepared.ownByStrength[0] ?? null : null;
  const ownLift = useMemo(() => liftToStrongest(ownMain), [liftToStrongest, ownMain]);
  // Keep object identity stable across hover re-renders so the WebGL dot layer does not redraw.
  const cloudLift = useMemo(() => {
    if (anchor !== null && anchorLift) return { from: anchor, to: anchorLift.index };
    if (ownMain !== null && ownLift) return { from: ownMain, to: ownLift.index };
    return null;
  }, [anchor, anchorLift, ownMain, ownLift]);

  function chooseSeed(index: number, additive: boolean) {
    setInspected(index);
    setTool("wand");
    setSelection((current) => seedRegion(current, index, additive));
  }

  function pickPatch(index: number, additive: boolean) {
    if (tool === "wand") chooseSeed(index, additive);
    else setInspected(index);
  }

  function ask(index: number) {
    setInspected(index);
    setChosenAnchor(index);
  }

  function selectBand(band: BandIndex) {
    setSelection(bandSelection(prepared.bands, prepared.repeats, prepared.own, band, cloud.sample, cloud.whole.axes[0], strength));
  }

  function selectOwn() {
    setSelection({ kind: "picture", indices: prepared.ownByStrength });
  }

  function clear() {
    setSelection({ kind: "none" });
    setChosenAnchor(null);
  }

  function openAdvanced(open: boolean) {
    setAdvanced(open);
    if (!open && tool === "wand") setTool("turn");
  }

  function finishLasso(positions: readonly ProjectedPoint[], polygon: readonly ProjectedPoint[]) {
    const next = applyLasso(selection, positions, polygon, selection.kind === "none" ? null : selected);
    setSelection(next);
    if (next.kind === "lasso" && next.indices.length > 0) setInspected(anchorFollowingSelection(next, next.indices, prepared.norms));
  }

  return {
    hovered,
    setHovered,
    inspected,
    setInspected,
    shown: hovered ?? inspected ?? anchor,
    advanced,
    openAdvanced,
    tool,
    setTool,
    selection,
    chosenAnchor,
    setChosenAnchor,
    radiusFraction,
    setRadiusFraction,
    seeds,
    regionFailed,
    growing,
    selected,
    selectedSet,
    anchor,
    anchorReason,
    anchorLift,
    ownMain,
    ownLift,
    cloudLift,
    nearestStrongest,
    chooseSeed,
    pickPatch,
    ask,
    selectBand,
    selectOwn,
    clear,
    finishLasso,
  };
}

/** Resolves a library anchor into a Painter request and navigates to `/create`. */
function useCanvasHandoff(block: number, anchorPoint: CloudToken | null, library: Library) {
  const dispatch = useEditorDispatch();
  const canHold = useCanHoldRequest();
  const navigate = useNavigate();
  const [canvasProblem, setCanvasProblem] = useState<string | null>(null);
  const canvasOperation = useRef(0);
  useEffect(() => () => { canvasOperation.current++; }, []);

  const canvasState: CanvasState = anchorPoint === null ? "none" : anchorPoint.source !== "library" ? "upload" : !canHold ? "full" : "ready";

  async function sendToCanvas() {
    if (!anchorPoint || anchorPoint.source !== "library") return;
    const current = ++canvasOperation.current;
    setCanvasProblem(null);
    try {
      const reference = {
        token: { imageId: anchorPoint.imageId, role: tokenRole(anchorPoint.slot), slot: anchorPoint.slot },
        block,
        code: [anchorPoint.code[0], anchorPoint.code[1], anchorPoint.code[2]] as [number, number, number],
      };
      const handoff = await resolveTokenHandoff(library, reference);
      if (current !== canvasOperation.current) return;
      dispatch({ type: "holdRequest", handoff });
      navigate("/create");
    } catch (error) {
      if (current === canvasOperation.current) setCanvasProblem(error instanceof Error ? error.message : String(error));
    }
  }

  return { canvasState, canvasProblem, sendToCanvas };
}

function LookBlock({ data, origin, scroller }: { data: LookData; origin: CloudToken | null; scroller: RefObject<HTMLElement | null> }) {
  const page = useRef<HTMLElement>(null);
  const cloudSection = useRef<HTMLElement>(null);
  const cloudView = useRef<CloudViewHandle>(null);
  useEffect(() => (page.current ? keepOnModule(page.current, MODULE_EDGES, undefined, scroller.current) : undefined), [scroller]);

  const library = useLibrary();
  const location = useLocation();
  const navigate = useNavigate();
  const upload = useUploadedPicture();
  const materialIndex = useMaterialIndex();
  const { request, setRequest } = useMaterialRequest();
  const { strength } = data;

  const [cloud, setCloud] = useState(data.cloud);
  const awaitingRows = data.cloud.source === "full" && data.cloud.rows.count === 0 && data.cloud.canLoadMore;
  const [loading, setLoading] = useState(awaitingRows);
  const block = cloud.whole.block;
  useEffect(() => {
    if (!awaitingRows) return;
    let live = true;
    library.blockCloud(block).then(
      (read) => { if (live) setCloud((current) => withFirstPrefix(current, read)); },
      (error: unknown) => {
        if (live) setCloud((current) => ({ ...current, canLoadMore: false, notice: withNoticeLine(current.notice, String(error instanceof Error ? error.message : error)) }));
      },
    ).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [library, block, awaitingRows]);

  const ownTokens = upload.readout?.byBlock.get(block)?.tokens ?? NO_TOKENS;
  const own = useMemo(() => (origin ? [origin] : ownTokens), [origin, ownTokens]);
  const prepared = useMemo(() => prepareCloud(cloud, own, strength), [cloud, own, strength]);
  const token = useCallback((index: number) => pageToken(cloud, own, index), [cloud, own]);
  const originWithoutPicture = origin?.source === "upload";
  const hasPictureAt = useCallback((index: number) => !(originWithoutPicture && index === 0) && pageHasPicture(cloud, prepared.own, index),
    [cloud, prepared.own, originWithoutPicture]);
  const highlighted = useMemo(() => new Set(prepared.ownByStrength), [prepared]);

  const source = useMemo<OccurrenceSource>(() => ({ cloud, prepared, strength, token }), [cloud, prepared, strength, token]);
  const growsToward = useMemo(() => defaultOccurrence(source), [source]);
  const strongestRow = useMemo(() => leadingPictures(prepared.members[STRONGEST], growsToward, STRONGEST_PICTURES), [prepared, growsToward]);
  const [growHovered, setGrowHovered] = useState(false);

  const cloudState = useCloudSelection({ cloud, prepared, strength, origin });
  const anchorPoint = cloudState.anchor === null ? null : token(cloudState.anchor);
  const { canvasState, canvasProblem, sendToCanvas } = useCanvasHandoff(block, anchorPoint, library);

  async function loadMore() {
    setLoading(true);
    try {
      setCloud(await library.loadMoreRows(cloud));
    } finally {
      setLoading(false);
    }
  }

  function growFrom(index: number) {
    const usesPicture = origin === null && index < prepared.own;
    setRequest(occurrenceRequest(source, index), usesPicture && upload.picture ? { name: upload.picture.name, preview: upload.picture.preview } : null);
    navigate(trainPath(block, location.search));
  }

  function growMaterial() {
    if (growsToward === null) navigate(trainPath(block, location.search));
    else growFrom(growsToward);
  }

  /** Train from your picture toward `reference`: one of your patches or a library patch, null for your strongest patch. */
  function growFromPicture(reference: number | null) {
    const grow = pictureGrowRequest(cloud, own, strength, reference, prepared);
    if (grow === null) return;
    setRequest(grow.request, upload.picture ? { name: upload.picture.name, preview: upload.picture.preview, lift: grow.reason === "lift" } : null);
    navigate(trainPath(block, location.search));
  }

  function material(points: readonly number[]) {
    if (cloudState.anchor === null) throw new Error("A training target needs a reference patch.");
    return makeMaterialRequest({
      block,
      token,
      points,
      anchor: cloudState.anchor,
      strength,
      coverage: { source: cloud.source, loadedRows: prepared.libraryRows, blockRows: cloud.whole.rows, selectedPoints: cloudState.selected.length },
    });
  }

  function download() {
    downloadBlob(new Blob([JSON.stringify(material(cloudState.selected), null, 2) + "\n"], { type: "application/json" }), `block-${block}-material-request.json`);
  }

  function sendToGrow() {
    const next = material(sentPoints(cloudState.selected, token, cloudState.anchor!));
    const usesPicture = next.anchor?.source === "upload" || next.points.some((point) => point.source === "upload");
    setRequest(next, usesPicture && upload.picture ? { name: upload.picture.name, preview: upload.picture.preview } : null);
  }

  const sampleTotal = prepared.sampleCounts.reduce((sum, value) => sum + value, 0);
  const strongestAbout = aboutCount(estimatedBandRows(prepared.sampleCounts[STRONGEST], sampleTotal, cloud.whole.rows));
  const materials = materialIndex.status === "ready" ? materialsOfBlock(materialIndex.index, block).length : null;
  const uploadUrl = origin === null ? upload.previewUrl ?? undefined : undefined;

  return (
    <main ref={page} className="look-page">
      <BlockHead block={block} patches={cloud.whole.rows} materials={materials} growHref={trainPath(block, location.search)}
        onGrow={growMaterial} onGrowHover={setGrowHovered} />
      {origin && (
        <OriginPlace origin={origin} strength={strength} onShow={() => {
          cloudState.setInspected(0);
          cloudSection.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        }} onGrow={origin.source === "library" ? () => growFrom(0) : null} />
      )}
      {upload.readout && upload.picture && uploadUrl && !origin && (
        <div className="look-own">
          <PictureHere pictureName={upload.picture.name} uploadUrl={uploadUrl} ownByStrength={prepared.ownByStrength} token={token} strength={strength}
            chosen={cloudState.chosenAnchor} nearestStrongest={cloudState.nearestStrongest}
            onChoose={(reference) => (reference === null ? cloudState.setChosenAnchor(null) : cloudState.ask(reference))}
            onHover={cloudState.setHovered}
            onShowInPlot={() => {
              cloudState.selectOwn();
              cloudSection.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            }}
            onTrain={cloudState.ownMain === null ? null : growFromPicture} onRemove={upload.clear} />
        </div>
      )}
      <StrongestPictures indices={strongestRow} about={strongestAbout} token={token} lit={growHovered ? growsToward : null}
        onHover={cloudState.setHovered} onGrow={growFrom} />
      <BlockMaterials block={block} index={materialIndex} />
      <section ref={cloudSection} className="look-cloud" aria-labelledby="look-cloud-title">
        <h2 id="look-cloud-title" className="heading">{LOOK_TEXT.cloud.title}</h2>
        <div className="look-workspace">
          <CloudView ref={cloudView} codes={prepared.display} bands={prepared.bands} extent={prepared.extent} strength={strength} colours={prepared.colours}
            hovered={cloudState.hovered} onHover={cloudState.setHovered} onPick={cloudState.setInspected} onSeed={cloudState.chooseSeed}
            tool={cloudState.tool} selected={cloudState.selectedSet} seeds={cloudState.seeds}
            pointPicture={(index) => <TokenPicture point={token(index)} uploadUrl={uploadUrl} />}
            highlighted={highlighted} anchor={cloudState.anchor} lift={cloudState.cloudLift} onLasso={cloudState.finishLasso} advanced={cloudState.advanced}
            tools={
              <CloudTools tool={cloudState.tool} onTool={cloudState.setTool} advanced={cloudState.advanced} onAdvanced={cloudState.openAdvanced}
                reach={cloudState.radiusFraction} onReach={cloudState.setRadiusFraction} reachUsed={cloudState.selection.kind === "wand" || cloudState.tool === "wand"}
                region={cloudState.selection.kind === "none" ? null : cloudState.selected.length}
                canClear={cloudState.selection.kind !== "none" || cloudState.chosenAnchor !== null} onClear={cloudState.clear} />
            } />
          {cloudState.shown !== null && !(originWithoutPicture && cloudState.shown === 0) && (
            <TokenPreview point={token(cloudState.shown)} strength={strength} uploadUrl={uploadUrl} onGrow={() => growFrom(cloudState.shown!)}
              advanced={cloudState.advanced} isAnchor={cloudState.anchor === cloudState.shown}
              onSelectAround={() => cloudState.chooseSeed(cloudState.shown!, false)} onSelectAnchor={() => cloudState.ask(cloudState.shown!)} />
          )}
        </div>
        {cloudState.advanced && (
          <RequestPanel anchor={cloudState.anchor} anchorReason={cloudState.anchorReason} lift={cloudState.anchorLift} strongest={prepared.strongest}
            selected={cloudState.selected} selectedSet={cloudState.selectedSet} selection={cloudState.selection} growing={cloudState.growing}
            problem={cloudState.selection.kind === "wand" && cloudState.regionFailed ? LOOK_TEXT.regionFailed : null}
            bands={prepared.bands} token={token} hasPictureAt={hasPictureAt}
            strength={strength} partial={cloud.source === "full" && cloud.rows.count < cloud.whole.rows && cloudState.selection.kind !== "picture"}
            ready={request?.block === block ? { sent: request.points.length, selected: request.coverage?.selectedPoints ?? request.points.length } : null}
            uploadUrl={uploadUrl} onHover={cloudState.setHovered} onSeed={cloudState.chooseSeed} onSelectAnchor={cloudState.ask}
            onFollow={() => cloudState.setChosenAnchor(null)} onStartStrongest={() => cloudState.selectBand(STRONGEST)} onSelectBand={cloudState.selectBand}
            onSend={sendToGrow} onDownload={download} canvasState={canvasState} canvasProblem={canvasProblem} onCanvas={sendToCanvas} />
        )}
        <BandRows members={prepared.members} sampleCounts={prepared.sampleCounts} blockRows={cloud.whole.rows} token={token}
          selected={cloudState.selectedSet} onHover={cloudState.setHovered} onPick={cloudState.pickPatch} onShowBand={(band) => cloudView.current?.showBand(band)} />
        <CloudDetails drawn={prepared.libraryRows} total={cloud.whole.rows} withoutPicture={prepared.withoutPicture} sample={cloud.sample.count}
          canLoadMore={cloud.canLoadMore} loading={loading} onLoadMore={() => void loadMore()}
          wandLimit={cloudState.advanced && prepared.count > REGION_GRAPH_ROWS ? REGION_GRAPH_ROWS : null} notice={cloud.notice} />
      </section>
    </main>
  );
}

/** Reference patch summary shown at the top of the panel when opened from an automaton. */
function OriginPlace({ origin, strength, onShow, onGrow }: {
  origin: CloudToken;
  strength: StrengthCuts;
  onShow: () => void;
  onGrow: (() => void) | null;
}) {
  const cell = origin.slot - PATCH_SLOT_OFFSET;
  return (
    <section className="look-origin" aria-labelledby="look-origin-title">
      <h2 id="look-origin-title" className="heading">{LOOK_TEXT.origin.title}</h2>
      <div className="look-origin-body">
        {origin.source === "library" && hasPicture(origin) && <TokenPicture point={origin} large />}
        <div className="look-origin-words">
          <p className="look-preview-where"><BandChip band={bandIndex(origin.norm, strength)} /></p>
          <p className="look-preview-from">
            {origin.source === "library" ? LOOK_TEXT.patchOf(cell % GRID + 1, Math.floor(cell / GRID) + 1, false) : LOOK_TEXT.origin.upload}
          </p>
          <p className="look-origin-actions">
            <button type="button" className="link-control" onClick={onShow}>{LOOK_TEXT.origin.show}</button>
            {onGrow && <button type="button" className="link-control" onClick={onGrow}>{LOOK_TEXT.cloud.growFrom}</button>}
          </p>
        </div>
      </div>
    </section>
  );
}
