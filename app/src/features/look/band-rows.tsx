import type { CloudToken } from "./cloud-token";
import { LOOK_TEXT } from "./look-text";
import { formatShare } from "./strength-display";
import { BAND_NAMES, STRENGTH_BANDS, type BandIndex } from "./strength-bands";
import { TokenStrip } from "./token-pictures";

/**
 * A band's share of the uniform public sample, scaled to the block's full count.
 * The full file's first rows favour picture coverage, so they are not used for shares.
 */
export function estimatedBandRows(sampleCount: number, sampleTotal: number, blockRows: number): number {
  return sampleTotal > 0 ? sampleCount / sampleTotal * blockRows : 0;
}

/** Two significant figures above 100, so an estimate does not look like a count. */
export function aboutCount(value: number): string {
  if (value < 100) return Math.round(value).toLocaleString("en-US");
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  return (Math.round(value / step) * step).toLocaleString("en-US");
}

/** The bands from the cloud's edge inward, as the rows list them. */
const STRONGEST_FIRST: readonly BandIndex[] = [3, 2, 1, 0];

/**
 * Four rows under the cloud, Strongest first: the band's word frames its dots, followed by its
 * estimated patches and share, and every sample picture of the band, strongest first.
 */
export function BandRows({ members, sampleCounts, blockRows, token, selected, onHover, onPick, onShowBand }: {
  members: readonly number[][];
  sampleCounts: readonly number[];
  blockRows: number;
  token: (index: number) => CloudToken;
  selected: ReadonlySet<number>;
  onHover: (index: number | null) => void;
  onPick: (index: number, additive: boolean) => void;
  onShowBand: (band: BandIndex) => void;
}) {
  const sampleTotal = sampleCounts.reduce((sum, value) => sum + value, 0);
  return (
    <section className="look-bands" aria-label={LOOK_TEXT.bandsTitle}>
      {STRONGEST_FIRST.map((band) => {
        const share = sampleTotal > 0 ? sampleCounts[band] / sampleTotal : 0;
        return (
          <div className="look-band" key={band} data-band={band}>
            <div className="look-band-label">
              <button className={`band ${STRENGTH_BANDS[band]}`} aria-label={LOOK_TEXT.showBand(BAND_NAMES[band])} onClick={() => onShowBand(band)}>{BAND_NAMES[band]}</button>
              <span>{LOOK_TEXT.bandEstimate(aboutCount(estimatedBandRows(sampleCounts[band], sampleTotal, blockRows)), formatShare(share))}</span>
            </div>
            {members[band].length > 0
              ? <TokenStrip indices={members[band]} token={token} label={`${LOOK_TEXT.bandsTitle}: ${BAND_NAMES[band]}`} onHover={onHover} onSeed={onPick} selected={selected} />
              : <p className="look-band-empty">{LOOK_TEXT.emptyBand}</p>}
          </div>
        );
      })}
    </section>
  );
}
