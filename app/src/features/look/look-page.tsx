// The block view in the basis group panel: its strongest pictures and materials,
// followed by the interactive cloud, response bands and request builder.
// The initial read holds the header, sample and strongest rows. The full file's
// first prefix appends after them, so loading it never renumbers a selection.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router";
import { useCanHoldRequest, useEditorDispatch } from "../../app/editor-session";
import { resolveTokenHandoff, tokenRole } from "../../app/handoff";
import { useLibrary } from "../../app/library-session";
import { useMaterialRequest } from "../../app/material-request";
import { useUploadedPicture } from "../../app/uploaded-picture";
import { withFirstPrefix, withNoticeLine, type BlockCloud } from "../../library/block-cloud";
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
import { pictureAnchor, pictureGrowRequest } from "./grow-from-picture";
import { makeMaterialRequest, sentPoints } from "./material-request";
import { defaultOccurrence, leadingPictures, occurrenceRequest, type OccurrenceSource } from "./occurrence-request";
import { PictureSourceChip } from "./picture-entry";
import { PicturePlace } from "./picture-place";
import { anchorFollowingSelection, bandSelection, nearestInBand } from "./request-anchor";
import { RequestPanel, type AnchorReason, type CanvasState, type PageLift } from "./request-panel";
import { applyLasso, seedRegion, withinRegionRadius, REGION_SELECTION_DEFAULTS, REGION_GRAPH_ROWS, type LookSelection, type ProjectedPoint } from "./selection";
import { bandIndex, sampleStrengthCuts, STRONGEST, type BandIndex } from "./strength-bands";
import { BandChip } from "./strength-display";
import { StrongestPictures } from "./strongest-pictures";
import { growPath } from "./strongest-request";
import { TokenPicture, TokenPreview } from "./token-pictures";
import { useRegionDistances } from "./region-graph";
import "./look.css";

/** The first screen's row of Strongest pictures: eight across the module grid. */
const STRONGEST_PICTURES = 8;

export interface LookData {
  cloud: BlockCloud;
  /** The Atlas band rule on the cloud's public sample: the cuts the Atlas record stores. */
  strength: StrengthCuts;
}

/** What the view is drawn from: the block's cloud, and the band rule's cuts on its public sample. */
export function lookData(cloud: BlockCloud): LookData {
  return { cloud, strength: sampleStrengthCuts(cloud.whole.gateMedian, cloud.sample.norms) };
}

/** The view's sections, kept on the 64 px module in a band under 1280 px, where the picture rows' heights follow the width (look.css). */
const MODULE_EDGES = ".look-head, .look-origin, .look-fires, .look-materials, .look-cloud, .look-bands";

/**
 * The block view in the basis group panel (basis-group-panel.tsx). `origin` is the reference patch
 * of the automaton the panel was opened from: it leads the view and is the lit point of the cloud.
 * `scroller` keeps section spacing aligned inside the panel. A new picture remounts the block,
 * so no selection or anchor points at another picture's patches.
 */
export function LookContent({ data, origin, scroller }: { data: LookData; origin: CloudToken | null; scroller: RefObject<HTMLElement | null> }) {
  const upload = useUploadedPicture();
  const pictureRevision = upload.readout ? upload.revision : 0;
  const originKey = origin ? cloudTokenKey(origin) : "none";
  return <LookBlock key={`${data.cloud.whole.block}:${pictureRevision}:${originKey}`} data={data} origin={origin} scroller={scroller} />;
}

function LookBlock({ data, origin, scroller }: { data: LookData; origin: CloudToken | null; scroller: RefObject<HTMLElement | null> }) {
  const page = useRef<HTMLElement>(null);
  useEffect(() => (page.current ? keepOnModule(page.current, MODULE_EDGES, undefined, scroller.current) : undefined), [scroller]);
  const library = useLibrary();
  const location = useLocation();
  const navigate = useNavigate();
  const upload = useUploadedPicture();
  const materialIndex = useMaterialIndex();
  const { request, setRequest } = useMaterialRequest();
  const { strength } = data;
  const [cloud, setCloud] = useState(data.cloud);
  // The full file's first prefix, while it is read after the initial cloud: Load more waits for it.
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
  // The automaton's reference patch, when the panel was opened from one, takes the place of your picture's patches.
  const ownTokens = upload.readout?.byBlock.get(block)?.tokens ?? NO_TOKENS;
  const own = useMemo(() => (origin ? [origin] : ownTokens), [origin, ownTokens]);
  const prepared = useMemo(() => prepareCloud(cloud, own, strength), [cloud, own, strength]);
  const token = useCallback((index: number) => pageToken(cloud, own, index), [cloud, own]);
  // A reference patch of the person's own picture has no picture here: that picture stayed on its device.
  const originWithoutPicture = origin?.source === "upload";
  const hasPictureAt = useCallback((index: number) => !(originWithoutPicture && index === 0) && pageHasPicture(cloud, prepared.own, index),
    [cloud, prepared.own, originWithoutPicture]);
  const highlighted = useMemo(() => new Set(prepared.ownByStrength), [prepared]);

  // Grow a material grows toward Grow's default occurrence; the Strongest row opens with its picture.
  const source = useMemo<OccurrenceSource>(() => ({ cloud, prepared, strength, token }), [cloud, prepared, strength, token]);
  const growsToward = useMemo(() => defaultOccurrence(source), [source]);
  const strongestRow = useMemo(() => leadingPictures(prepared.members[STRONGEST], growsToward, STRONGEST_PICTURES), [prepared, growsToward]);
  const [growHovered, setGrowHovered] = useState(false);

  const [hovered, setHovered] = useState<number | null>(null);
  const [inspected, setInspected] = useState<number | null>(prepared.ownByStrength[0] ?? prepared.strongest);
  const [advanced, setAdvanced] = useState(false);
  const [tool, setTool] = useState<LookTool>("turn");
  const [selection, setSelection] = useState<LookSelection>({ kind: "none" });
  const [chosenAnchor, setChosenAnchor] = useState<number | null>(null);
  const [radiusFraction, setRadiusFraction] = useState<number>(REGION_SELECTION_DEFAULTS.radiusFraction);
  const cloudView = useRef<CloudViewHandle>(null);

  // Selection: the wand's graph covers the first REGION_GRAPH_ROWS points and lives in a
  // worker; its distances change with the seeds, and the reach dial only filters them.
  // Loading more rows appends past that window, so it does not rebuild the graph.
  // While the worker computes, the wand's region is its starts.
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

  // Request: an anchor the person chose, or the one that follows the selection.
  const followed = anchorFollowingSelection(selection, selected, prepared.norms);
  const anchor = chosenAnchor ?? followed;
  const anchorReason: AnchorReason | null = chosenAnchor !== null ? "chosen" : followed !== null && selection.kind !== "none" ? selection.kind : null;
  const liftToStrongest = useCallback((index: number | null | undefined): PageLift | null => {
    if (index === null || index === undefined || prepared.bands[index] === STRONGEST) return null;
    const lift = nearestInBand(cloud.sample, prepared.native[index], STRONGEST, strength);
    return lift && { index: prepared.own + lift.index, degrees: lift.degrees };
  }, [cloud.sample, prepared, strength]);
  const anchorLift = useMemo(() => liftToStrongest(anchor), [liftToStrongest, anchor]);
  // Your picture's strongest patch, for its lift and Grow from your picture; an automaton's reference patch is not one.
  const ownMain = origin === null ? prepared.ownByStrength[0] ?? null : null;
  const ownLift = useMemo(() => liftToStrongest(ownMain), [liftToStrongest, ownMain]);
  // The cloud's arrow: from the anchor to its lift, or else from your strongest patch to its lift.
  // Kept as one object while its ends stay: the cloud redraws every dot when it changes, and a hover re-renders this page.
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
  /** A picture or a dot clicked: the wand grows a region from it; the other tools show it beside the cloud. */
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
  function clear() {
    setSelection({ kind: "none" });
    setChosenAnchor(null);
  }
  function openAdvanced(open: boolean) {
    setAdvanced(open);
    if (!open && tool === "wand") setTool("turn");
  }
  // A lasso shows the patch Grow from this patch would use: the strongest it drew around.
  function finishLasso(positions: readonly ProjectedPoint[], polygon: readonly ProjectedPoint[]) {
    const next = applyLasso(selection, positions, polygon, selection.kind === "none" ? null : selected);
    setSelection(next);
    if (next.kind === "lasso" && next.indices.length > 0) setInspected(anchorFollowingSelection(next, next.indices, prepared.norms));
  }
  async function loadMore() {
    setLoading(true);
    try {
      setCloud(await library.loadMoreRows(cloud));
    } finally {
      setLoading(false);
    }
  }

  // Grow from one occurrence: the band's request at it, then Grow (occurrence-request.ts).
  function growFrom(index: number) {
    // Carry the uploaded picture only for its own patches, not an automaton's reference patch.
    const usesPicture = origin === null && index < prepared.own;
    setRequest(occurrenceRequest(source, index), usesPicture && upload.picture ? { name: upload.picture.name, preview: upload.picture.preview } : null);
    navigate(growPath(block, location.search));
  }
  // Without a Strongest picture there is no default occurrence; Grow then says so and links back here.
  function growMaterial() {
    if (growsToward === null) navigate(growPath(block, location.search));
    else growFrom(growsToward);
  }
  // Train from this, for your picture: toward the reference patch you chose, else your own strongest patch (grow-from-picture.ts).
  const pictureGrow = ownMain === null ? null : pictureAnchor(ownMain, chosenAnchor, ownLift?.index ?? null);
  function growFromPicture() {
    const grow = pictureGrowRequest(cloud, own, strength, chosenAnchor, prepared);
    if (grow === null) return;
    setRequest(grow.request, upload.picture ? { name: upload.picture.name, preview: upload.picture.preview, lift: grow.reason === "lift" } : null);
    navigate(growPath(block, location.search));
  }

  // Advanced: the region as a request, sent or downloaded. The download carries the whole region; Send carries what Grow accepts.
  function material(points: readonly number[]) {
    if (anchor === null) throw new Error("A training target needs a reference patch.");
    return makeMaterialRequest({
      block,
      token,
      points,
      anchor,
      strength,
      coverage: { source: cloud.source, loadedRows: prepared.libraryRows, blockRows: cloud.whole.rows, selectedPoints: selected.length },
    });
  }
  function download() {
    downloadBlob(new Blob([JSON.stringify(material(selected), null, 2) + "\n"], { type: "application/json" }), `block-${block}-material-request.json`);
  }
  function sendToGrow() {
    // A large region is evenly spread, keeping the anchor and the patches of the set Train would take from all of it.
    const next = material(sentPoints(selected, token, anchor));
    const usesPicture = next.anchor?.source === "upload" || next.points.some((point) => point.source === "upload");
    setRequest(next, usesPicture && upload.picture ? { name: upload.picture.name, preview: upload.picture.preview } : null);
  }

  // The Painter holds the library patch and its recorded code until the first stroke.
  const dispatch = useEditorDispatch();
  const canHold = useCanHoldRequest();
  const [canvasProblem, setCanvasProblem] = useState<string | null>(null);
  const canvasOperation = useRef(0);
  useEffect(() => () => { canvasOperation.current++; }, []);
  const anchorPoint = anchor === null ? null : token(anchor);
  const canvasState: CanvasState = anchorPoint === null ? "none" : anchorPoint.source !== "library" ? "upload" : !canHold ? "full" : "ready";
  async function sendToCanvas() {
    if (!anchorPoint || anchorPoint.source !== "library") return;
    const current = ++canvasOperation.current;
    setCanvasProblem(null);
    try {
      const reference = { token: { imageId: anchorPoint.imageId, role: tokenRole(anchorPoint.slot), slot: anchorPoint.slot }, block, code: [anchorPoint.code[0], anchorPoint.code[1], anchorPoint.code[2]] as [number, number, number] };
      const handoff = await resolveTokenHandoff(library, reference);
      if (current !== canvasOperation.current) return;
      dispatch({ type: "holdRequest", handoff });
      navigate("/create");
    } catch (error) {
      if (current === canvasOperation.current) setCanvasProblem(error instanceof Error ? error.message : String(error));
    }
  }

  const shown = hovered ?? inspected ?? anchor;
  const sampleTotal = prepared.sampleCounts.reduce((sum, value) => sum + value, 0);
  const strongestAbout = aboutCount(estimatedBandRows(prepared.sampleCounts[STRONGEST], sampleTotal, cloud.whole.rows));
  const materials = materialIndex.status === "ready" ? materialsOfBlock(materialIndex.index, block).length : null;
  const uploadUrl = origin === null ? upload.previewUrl ?? undefined : undefined;
  return (
    <main ref={page} className="look-page">
      <BlockHead block={block} patches={cloud.whole.rows} materials={materials} growHref={growPath(block, location.search)}
        onGrow={growMaterial} onGrowHover={setGrowHovered} />
      {origin && (
        <OriginPlace origin={origin} strength={strength} onShow={() => {
          setInspected(0);
          page.current?.querySelector(".look-cloud")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        }} onGrow={origin.source === "library" ? () => growFrom(0) : null} />
      )}
      {upload.readout && !origin && (
        <div className="look-own">
          <PictureSourceChip />
          <PicturePlace ownByStrength={prepared.ownByStrength} blockStrongest={prepared.members[STRONGEST]} token={token} strength={strength}
            lift={ownLift} growsToward={pictureGrow?.index ?? null} selected={selectedSet} uploadUrl={uploadUrl} onHover={setHovered} onSeed={chooseSeed} onSelectAnchor={ask}
            onSelectOwn={() => setSelection({ kind: "picture", indices: prepared.ownByStrength })}
            onGrowFrom={pictureGrow === null ? null : growFromPicture} />
        </div>
      )}
      <StrongestPictures indices={strongestRow} about={strongestAbout} token={token} lit={growHovered ? growsToward : null}
        onHover={setHovered} onGrow={growFrom} />
      <BlockMaterials block={block} index={materialIndex} />
      <section className="look-cloud" aria-labelledby="look-cloud-title">
        <h2 id="look-cloud-title" className="heading">{LOOK_TEXT.cloud.title}</h2>
        <div className="look-workspace">
          <CloudView ref={cloudView} codes={prepared.display} bands={prepared.bands} extent={prepared.extent} strength={strength} colours={prepared.colours}
            hovered={hovered} onHover={setHovered} onPick={setInspected} onSeed={chooseSeed} tool={tool} selected={selectedSet} seeds={seeds}
            pointPicture={(index) => <TokenPicture point={token(index)} uploadUrl={uploadUrl} />}
            highlighted={highlighted} anchor={anchor} lift={cloudLift} onLasso={finishLasso} advanced={advanced}
            tools={
              <CloudTools tool={tool} onTool={setTool} advanced={advanced} onAdvanced={openAdvanced}
                reach={radiusFraction} onReach={setRadiusFraction} reachUsed={selection.kind === "wand" || tool === "wand"}
                region={selection.kind === "none" ? null : selected.length} canClear={selection.kind !== "none" || chosenAnchor !== null} onClear={clear} />
            } />
          {shown !== null && !(originWithoutPicture && shown === 0) && (
            <TokenPreview point={token(shown)} strength={strength} uploadUrl={uploadUrl} onGrow={() => growFrom(shown)} advanced={advanced}
              isAnchor={anchor === shown} onSelectAround={() => chooseSeed(shown, false)} onSelectAnchor={() => ask(shown)} />
          )}
        </div>
        {advanced && (
          <RequestPanel anchor={anchor} anchorReason={anchorReason} lift={anchorLift} strongest={prepared.strongest}
            selected={selected} selectedSet={selectedSet} selection={selection} growing={growing} problem={selection.kind === "wand" && regionFailed ? LOOK_TEXT.regionFailed : null} bands={prepared.bands} token={token} hasPictureAt={hasPictureAt}
            strength={strength} partial={cloud.source === "full" && cloud.rows.count < cloud.whole.rows && selection.kind !== "picture"}
            ready={request?.block === block ? { sent: request.points.length, selected: request.coverage?.selectedPoints ?? request.points.length } : null} uploadUrl={uploadUrl}
            onHover={setHovered} onSeed={chooseSeed} onSelectAnchor={ask} onFollow={() => setChosenAnchor(null)}
            onStartStrongest={() => selectBand(STRONGEST)} onSelectBand={selectBand}
            onSend={sendToGrow} onDownload={download} canvasState={canvasState} canvasProblem={canvasProblem} onCanvas={sendToCanvas} />
        )}
        <BandRows members={prepared.members} sampleCounts={prepared.sampleCounts} blockRows={cloud.whole.rows} token={token}
          selected={selectedSet} onHover={setHovered} onPick={pickPatch} onShowBand={(band) => cloudView.current?.showBand(band)} />
        <CloudDetails drawn={prepared.libraryRows} total={cloud.whole.rows} withoutPicture={prepared.withoutPicture} sample={cloud.sample.count}
          canLoadMore={cloud.canLoadMore} loading={loading} onLoadMore={() => void loadMore()}
          wandLimit={advanced && prepared.count > REGION_GRAPH_ROWS ? REGION_GRAPH_ROWS : null} notice={cloud.notice} />
      </section>
    </main>
  );
}

const NO_INDICES: number[] = [];
const NO_TOKENS: CloudToken[] = [];

/**
 * The automaton's reference patch, first under the head when the panel was opened from an automaton:
 * its picture with the patch marked (or a line when it was the person's own picture), its level, and
 * the way to its point in the cloud.
 */
function OriginPlace({ origin, strength, onShow, onGrow }: {
  origin: CloudToken;
  strength: StrengthCuts;
  onShow: () => void;
  /** Train from the reference patch; null for a patch of the person's own picture, which is not here to train toward. */
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
