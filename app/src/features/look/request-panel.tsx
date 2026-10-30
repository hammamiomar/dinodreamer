import { Link } from "react-router";
import { MATERIAL_REQUEST_MAX_POINTS, PATCH_SLOT_OFFSET, GRID, type StrengthCuts } from "../../recipe";
import { cloudTokenPicture, type CloudToken } from "./cloud-token";
import { LOOK_TEXT } from "./look-text";
import type { LookSelection } from "./selection";
import { BandChip, LobeGauge, StrengthCounts, type GaugeMark } from "./strength-display";
import { BAND_NAMES, bandIndex, lobePosition, STRENGTH_BANDS, STRONGEST, type BandIndex } from "./strength-bands";
import { TokenPicture, TokenStrip } from "./token-pictures";

/** A lift found by nearestInBand, as a page index. */
export interface PageLift {
  index: number;
  degrees: number;
}

/** Whether the reference patch can go to the Canvas: none chosen, your own picture's (no recorded code), the Canvas full, or ready. */
export type CanvasState = "none" | "upload" | "full" | "ready";

/** Why the request asks for its anchor: the person chose it, or it follows the selection. */
export type AnchorReason = "chosen" | Exclude<LookSelection["kind"], "none">;

/** The bands a region can be made of, from the cloud's edge inward. */
const STRONGEST_FIRST: readonly BandIndex[] = [3, 2, 1, 0];

/**
 * The Advanced request builder: the reference patch, selected region and handoff.
 * Train reads the anchor; the downloaded request also carries the region.
 */
export function RequestPanel({ anchor, anchorReason, lift, strongest, selected, selectedSet, selection, growing, problem, bands, token, hasPictureAt, strength, partial, ready,
  uploadUrl, onHover, onSeed, onSelectAnchor, onFollow, onStartStrongest, onSelectBand, onSend, onDownload, canvasState, canvasProblem, onCanvas }: {
  anchor: number | null;
  anchorReason: AnchorReason | null;
  /** The lift from the anchor to Strongest, or null when the anchor is already Strongest. */
  lift: PageLift | null;
  strongest: number | null;
  selected: readonly number[];
  selectedSet: ReadonlySet<number>;
  selection: LookSelection;
  /** The wand's region is still being computed; until then it is its starts and cannot be sent. */
  growing: boolean;
  problem: string | null;
  bands: readonly BandIndex[];
  token: (index: number) => CloudToken;
  hasPictureAt: (index: number) => boolean;
  strength: StrengthCuts;
  /** The selection is of library patches from a loaded prefix, not the whole cloud. */
  partial: boolean;
  /** The pending Studio request's point counts when it is for this block. */
  ready: { sent: number; selected: number } | null;
  uploadUrl?: string;
  onHover: (index: number | null) => void;
  onSeed: (index: number, additive: boolean) => void;
  onSelectAnchor: (index: number) => void;
  onFollow: () => void;
  onStartStrongest: () => void;
  onSelectBand: (band: BandIndex) => void;
  onSend: () => void;
  onDownload: () => void;
  /** The Canvas, the experiment: whether the reference patch can go there, and why not. */
  canvasState: CanvasState;
  canvasProblem: string | null;
  onCanvas: () => void;
}) {
  const text = LOOK_TEXT;
  const point = anchor === null ? null : token(anchor);
  const band = point ? bandIndex(point.norm, strength) : null;
  const marks: GaugeMark[] = [];
  if (point) marks.push({ key: "anchor", norm: point.norm, kind: "anchor" });
  if (point && lift) marks.push({ key: "lift", norm: token(lift.index).norm, kind: "lift" });
  const regionCounts = [0, 0, 0, 0];
  for (const index of selected) regionCounts[bands[index]]++;
  const thinned = selected.length > MATERIAL_REQUEST_MAX_POINTS;
  const complete = point !== null && selected.length > 0 && !growing && problem === null;
  const pictured = selected.filter(hasPictureAt);
  return (
    <section className="look-request" aria-label={text.request.name} data-count={selected.length} data-anchor-band={band ?? undefined} data-pending={growing || undefined}>
      <h2 className="label">{text.request.title}</h2>
      <div className="look-request-anchor">
        {point && band !== null ? (
          <>
            <TokenPicture point={point} uploadUrl={uploadUrl} />
            <div className="look-request-words">
              <p className="label">{text.asksFor}</p>
              <p className="look-request-band"><BandChip band={band} /> {text.position(lobePosition(point.norm, strength))}</p>
              <p className="look-hint">
                {cloudTokenPicture(point)} · {patchName(point)} · {anchorReason === "chosen" ? text.anchorChosen : anchorReason ? text.anchorFollows[anchorReason] : ""}
                {anchorReason === "chosen" && <> · <button className="link-control" onClick={onFollow}>{text.followSelection}</button></>}
              </p>
              <LobeGauge strength={strength} marks={marks} arrow={lift ? { from: 0, to: 1 } : undefined} />
              {band <= 1 && <p className="look-warning">{text.weakAnchor}</p>}
              {band < STRONGEST && (lift ? (
                <div className="look-request-lift" onMouseEnter={() => onHover(lift.index)} onMouseLeave={() => onHover(null)}>
                  <TokenPicture point={token(lift.index)} />
                  <div>
                    <button className="button" onClick={() => onSelectAnchor(lift.index)}>{text.lift(STRONGEST)}</button>
                    <p className="look-hint">{text.liftNote(lift.degrees)}</p>
                  </div>
                </div>
              ) : <p className="look-hint">{text.noLift(STRONGEST)}</p>)}
            </div>
          </>
        ) : (
          <div className="look-request-words">
            <p className="label">{text.asksFor}</p>
            <p>{text.noAnchor}</p>
            {strongest !== null && <button className="button" onClick={onStartStrongest}>{text.startStrongest}</button>}
          </div>
        )}
      </div>
      <div className="look-request-region">
        <p className="look-request-count" aria-live="polite">
          {selected.length > 0 ? text.regionCount(selected.length) : text.regionEmpty}
          {selection.kind === "wand" && ` · ${text.regionFrom.wand(selection.seeds.length)}`}
          {growing && ` · ${text.growing}`}
          {selection.kind === "lasso" && ` · ${text.regionFrom.lasso(selection.passes)}`}
          {selection.kind === "picture" && ` · ${text.regionFrom.picture()}`}
          {selection.kind === "band" && ` · ${text.regionFrom.band(selection.band as BandIndex)}`}
        </p>
        {problem && <p className="look-warning" role="alert">{problem}</p>}
        <div className="look-request-bands" role="group" aria-label={text.selectBand}>
          <span className="label">{text.selectBand}</span>
          {STRONGEST_FIRST.map((value) => (
            <button key={value} className={`band ${STRENGTH_BANDS[value]}`} aria-pressed={selection.kind === "band" && selection.band === value}
              onClick={() => onSelectBand(value)}>{BAND_NAMES[value]}</button>
          ))}
        </div>
        {selected.length > 0 && <StrengthCounts counts={regionCounts} />}
        {pictured.length > 0 && <TokenStrip indices={pictured} token={token} label={text.request.selected} uploadUrl={uploadUrl} onHover={onHover} onSeed={onSeed} selected={selectedSet} />}
        {partial && selected.length > 0 && <p className="look-hint">{text.prefixNote}</p>}
      </div>
      <div className="look-request-actions">
        <button className="button" disabled={!complete} onClick={onSend}>{text.send}</button>
        <button className="button" disabled={!complete} onClick={onDownload}>{text.download}</button>
        <button className="link-control" disabled={canvasState !== "ready"} onClick={onCanvas}>{text.canvas}</button>
        {canvasState === "full" && <span className="look-hint">{text.canvasFull}</span>}
        {canvasState === "upload" && <span className="look-hint">{text.canvasLibraryOnly}</span>}
        {canvasProblem !== null && <span className="look-hint">{canvasProblem}</span>}
        {selected.length > 0 && point === null && <span className="look-hint">{text.needsAnchor}</span>}
        {thinned && <span className="look-hint">{text.thinned(MATERIAL_REQUEST_MAX_POINTS, selected.length)}</span>}
      </div>
      {ready !== null && (
        <p className="look-hint look-handoff" role="status">
          {text.sent(ready.sent, ready.selected)} <Link to="/train">{text.openGrow}</Link>. {text.keepRequest}
        </p>
      )}
    </section>
  );
}

function patchName(point: CloudToken): string {
  const cell = point.slot - PATCH_SLOT_OFFSET;
  return LOOK_TEXT.patchAt(cell % GRID + 1, Math.floor(cell / GRID) + 1);
}
