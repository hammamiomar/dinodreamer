import type { CSSProperties } from "react";
import type { StrengthCuts } from "../../recipe";
import { BAND_COLOURS, BAND_NAMES, lobePosition, STRENGTH_BANDS, type BandIndex } from "./strength-bands";
import { LOOK_TEXT } from "./look-text";
import "./strength.css";

/** A response level's name in its band colour (styles.css .band). */
export function BandChip({ band }: { band: BandIndex }) {
  return <b className={`band ${STRENGTH_BANDS[band]} look-band-chip`} data-band={band}>{BAND_NAMES[band]}</b>;
}

/** Patches per band, as the Atlas card's strip: each segment's width is its share of the patches. */
export function StrengthCounts({ counts, describe = countAndShare }: { counts: readonly number[]; describe?: (count: number, share: number) => string }) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  return (
    <div className="look-strength-counts" aria-label={LOOK_TEXT.countsName}>
      <div className="look-strength-bar">
        {counts.map((value, band) => value > 0 && (
          <span key={band} style={{ flexGrow: value, background: BAND_COLOURS[band] }} />
        ))}
      </div>
      <ol>
        {counts.map((value, band) => (
          <li key={band} style={{ "--band": BAND_COLOURS[band] } as CSSProperties}>
            <b>{BAND_NAMES[band]}</b> {describe(value, total > 0 ? value / total : 0)}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function formatShare(share: number): string {
  if (share > 0 && share < 0.01) return LOOK_TEXT.share.underOne;
  return LOOK_TEXT.share.percent(Math.round(share * 100));
}

function countAndShare(count: number, share: number): string {
  return `${count.toLocaleString("en-US")} · ${formatShare(share)}`;
}

export interface GaugeMark {
  key: string;
  norm: number;
  kind: "own" | "anchor" | "lift";
}

// The gauge runs from a short stretch inside the ring to the strongest sampled patch,
// and farther when a marked patch lies beyond it.
const INSIDE_RING = 0.2;

/**
 * One axis of strength: the four bands as equal quarters from the ring outward.
 * Marks show where particular patches sit; an arrow joins a patch to its lift;
 * a span shows the weakest to the strongest of a set of patches, in norms.
 */
export function LobeGauge({ strength, marks, arrow, span }: {
  strength: StrengthCuts;
  marks: readonly GaugeMark[];
  arrow?: { from: number; to: number };
  span?: { from: number; to: number };
}) {
  const positions = marks.map((mark) => lobePosition(mark.norm, strength));
  const spanAt = span && [lobePosition(span.from, strength), lobePosition(span.to, strength)];
  const end = Math.max(1, ...positions, ...(spanAt ?? []));
  const at = (position: number) => `${(Math.max(-INSIDE_RING, position) + INSIDE_RING) / (end + INSIDE_RING) * 100}%`;
  const quarter = `${0.25 / (end + INSIDE_RING) * 100}%`;
  return (
    <div className="look-gauge">
      <div className="look-gauge-track">
        <span className="look-gauge-inside" style={{ width: at(0) }} />
        {BAND_NAMES.map((name, band) => (
          <span key={name} className="look-gauge-band" style={{ left: at(band / 4), width: quarter, background: BAND_COLOURS[band] }} />
        ))}
        {end > 1 && <span className="look-gauge-beyond" style={{ left: at(1), right: 0 }} />}
        {spanAt && <span className="look-gauge-span" style={{ left: at(spanAt[0]), width: `calc(${at(spanAt[1])} - ${at(spanAt[0])})` }} />}
        {arrow && (
          <span className="look-gauge-arrow" style={{
            left: at(Math.min(positions[arrow.from], positions[arrow.to])),
            width: `calc(${at(Math.max(positions[arrow.from], positions[arrow.to]))} - ${at(Math.min(positions[arrow.from], positions[arrow.to]))})`,
          }} data-direction={positions[arrow.to] >= positions[arrow.from] ? "out" : "in"} />
        )}
        {marks.map((mark, index) => (
          <i key={mark.key} className="look-gauge-mark" data-kind={mark.kind} style={{ left: at(positions[index]) }} />
        ))}
      </div>
      <div className="look-gauge-scale" aria-hidden="true">
        <span data-align="end" style={{ left: at(0) }}>{LOOK_TEXT.ring}</span>
        {BAND_NAMES.map((name, band) => <span key={name} style={{ left: at(band / 4 + 1 / 8), color: BAND_COLOURS[band] }}>{name}</span>)}
      </div>
    </div>
  );
}
