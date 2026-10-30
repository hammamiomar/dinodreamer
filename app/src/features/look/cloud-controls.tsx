// The cloud's tools and loading details. Advanced adds the wand and its reach;
// Clear is available whenever a region or an explicit reference patch is chosen.

import { Segmented, type Segment } from "../../ui/segmented";
import { Slider } from "../../ui/slider";
import type { LookTool } from "./cloud-view";
import { LOOK_TEXT } from "./look-text";

const BASIC_TOOLS: readonly Segment<LookTool>[] = [
  { value: "turn", label: LOOK_TEXT.cloud.turn },
  { value: "lasso", label: LOOK_TEXT.cloud.lasso },
];
const ADVANCED_TOOLS: readonly Segment<LookTool>[] = [...BASIC_TOOLS, { value: "wand", label: LOOK_TEXT.cloud.wand }];
/** The wand's reach in percent of the cloud's largest strength: the dial runs to 80. */
const REACH_MAX = 80;

export function CloudTools({ tool, onTool, advanced, onAdvanced, reach, onReach, reachUsed, region, canClear, onClear }: {
  tool: LookTool;
  onTool: (tool: LookTool) => void;
  advanced: boolean;
  onAdvanced: (open: boolean) => void;
  /** The wand's reach, 0 to 0.8 of the cloud's largest strength. */
  reach: number;
  onReach: (reach: number) => void;
  /** The wand is the tool or made the region: the reach changes something. */
  reachUsed: boolean;
  /** The region's patches, or null when there is none. */
  region: number | null;
  canClear: boolean;
  onClear: () => void;
}) {
  const percent = Math.round(reach * 100);
  return (
    <>
      <Segmented label={LOOK_TEXT.cloud.tools} segments={advanced ? ADVANCED_TOOLS : BASIC_TOOLS} value={tool} onChange={onTool} />
      {advanced && (
        <Slider label={LOOK_TEXT.reach} value={percent} min={0} max={REACH_MAX} valueText={LOOK_TEXT.reachValue(percent)}
          disabled={!reachUsed} onChange={(value) => onReach(value / 100)} />
      )}
      {region !== null && <span className="look-region-count" aria-live="polite">{LOOK_TEXT.region(region)}</span>}
      {canClear && <button className="button" onClick={onClear}>{LOOK_TEXT.clear}</button>}
      <label className="look-advanced">
        <input type="checkbox" checked={advanced} onChange={(event) => onAdvanced(event.target.checked)} />
        {LOOK_TEXT.cloud.advanced}
      </label>
    </>
  );
}

/** What the cloud draws, from which rows, and the way to draw more: one line, with a notice when loading failed. */
export function CloudDetails({ drawn, total, withoutPicture, sample, canLoadMore, loading, onLoadMore, wandLimit, notice }: {
  /** Distinct library patches drawn. */
  drawn: number;
  /** The block's patches in the library. */
  total: number;
  /** Drawn patches that have no public picture. */
  withoutPicture: number;
  /** The public sample the pictures and counts come from. */
  sample: number;
  canLoadMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** The rows the wand reaches, when Advanced is open and the cloud has more; else null. */
  wandLimit: number | null;
  notice: string | null;
}) {
  const text = LOOK_TEXT.details;
  return (
    <p className="look-details">
      <span>{text.drawn(drawn, total)}</span>
      {withoutPicture > 0 && <span>{text.withoutPicture(withoutPicture)}</span>}
      <span>{text.sample(sample)}</span>
      {wandLimit !== null && <span>{LOOK_TEXT.wandLimit(wandLimit)}</span>}
      {canLoadMore && (
        <span>
          <button className="link-control" disabled={loading} onClick={onLoadMore}>{loading ? LOOK_TEXT.loadingMore : text.more}</button>
        </span>
      )}
      {notice && <span className="look-notice" role="status">{notice}</span>}
    </p>
  );
}
