import type { BlockCloud } from "../../library/block-cloud";
import { MATERIAL_REQUEST_MAX_POINTS, type MaterialRequest, type StrengthCuts } from "../../recipe";
import { pageToken, prepareCloud } from "./cloud-geometry";
import { evenSubsample, makeMaterialRequest } from "./material-request";
import { bandSelection } from "./request-anchor";
import { STRONGEST, type BandIndex } from "./strength-bands";

export { anchorToken } from "./cloud-token";

/**
 * The request "Start with the Strongest band" and Send make on the block page, without the
 * page: every loaded Strongest patch of the library (each occurrence once), anchored at the
 * band's public sample patch nearest the whole cloud's first axis, sent as at most 4,352
 * points spread evenly and keeping the anchor, with the coverage it was chosen from. Null
 * when the public sample has no Strongest patch to anchor it. /train?block=N calls this with
 * the cloud and the cuts it loads (blockCloud, sampleStrengthCuts).
 */
export function strongestBandRequest(cloud: BlockCloud, strength: StrengthCuts): MaterialRequest | null {
  return bandRequest(cloud, strength, STRONGEST);
}

/**
 * The same request for any response level: every loaded patch of the level, anchored at its public
 * sample patch nearest the first axis. Train's continuation of a saved definition offers the four
 * levels of the definition's basis group this way.
 */
export function bandRequest(cloud: BlockCloud, strength: StrengthCuts, band: BandIndex): MaterialRequest | null {
  const prepared = prepareCloud(cloud, [], strength);
  const selection = bandSelection(prepared.bands, prepared.repeats, prepared.own, band, cloud.sample, cloud.whole.axes[0], strength);
  if (selection.anchor === null) return null;
  const anchor = selection.anchor;
  return makeMaterialRequest({
    block: cloud.whole.block,
    token: (index) => pageToken(cloud, [], index),
    points: evenSubsample(selection.indices, MATERIAL_REQUEST_MAX_POINTS, anchor),
    anchor,
    strength,
    coverage: { source: cloud.source, loadedRows: prepared.libraryRows, blockRows: cloud.whole.rows, selectedPoints: selection.indices.length },
  });
}

/** Link to the Train page for a basis group, preserving an explicit fake-engine query parameter. */
export function trainPath(block: number, search: string): string {
  const engine = new URLSearchParams(search).get("engine");
  return `/train?block=${block}${engine === "fake" ? "&engine=fake" : ""}`;
}
