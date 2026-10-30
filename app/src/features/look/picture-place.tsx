import type { StrengthCuts } from "../../recipe";
import type { CloudToken } from "./cloud-token";
import { LOOK_TEXT } from "./look-text";
import type { PageLift } from "./request-panel";
import { BandChip, LobeGauge, StrengthCounts, type GaugeMark } from "./strength-display";
import { bandIndex, lobePosition, STRONGEST } from "./strength-bands";
import { TokenPicture, TokenStrip } from "./token-pictures";

/**
 * Where your picture sits in this block: its patches by band, its strongest patch,
 * and the nearest Strongest patch in the same direction, so the lift is visible.
 */
export function PicturePlace({ ownByStrength, blockStrongest, token, strength, lift, anchor, selected, uploadUrl, onHover, onSeed, onSelectAnchor, onSelectOwn, onGrowFrom }: {
  ownByStrength: readonly number[];
  blockStrongest: readonly number[];
  token: (index: number) => CloudToken;
  strength: StrengthCuts;
  /** The lift from your strongest patch here, or null when it is already Strongest. */
  lift: PageLift | null;
  anchor: number | null;
  selected: ReadonlySet<number>;
  uploadUrl?: string;
  onHover: (index: number | null) => void;
  onSeed: (index: number, additive: boolean) => void;
  onSelectAnchor: (index: number) => void;
  onSelectOwn: () => void;
  /** Grow from this: the own patch from Strongly up, else the lift (grow-from-picture.ts); absent when neither exists. */
  onGrowFrom: (() => void) | null;
}) {
  const text = LOOK_TEXT.picture;
  if (ownByStrength.length === 0) {
    return (
      <section className="look-picture-here" aria-label={text.title}>
        <div className="look-section-head"><h2>{text.title}</h2></div>
        <p className="look-hint">{text.none}</p>
      </section>
    );
  }
  const main = ownByStrength[0];
  const mainPoint = token(main);
  const mainBand = bandIndex(mainPoint.norm, strength);
  const counts = [0, 0, 0, 0];
  for (const index of ownByStrength) counts[bandIndex(token(index).norm, strength)]++;
  const marks: GaugeMark[] = [{ key: "own", norm: mainPoint.norm, kind: "own" }];
  if (lift) marks.push({ key: "lift", norm: token(lift.index).norm, kind: "lift" });
  const span = { from: token(ownByStrength[ownByStrength.length - 1]).norm, to: mainPoint.norm };
  const liftPoint = lift ? token(lift.index) : null;
  return (
    <section className="look-picture-here" aria-label={text.title}>
      <div className="look-section-head">
        <h2>{text.title}</h2>
        <span>{text.patches(ownByStrength.length)} · {text.whiteRings}</span>
      </div>
      <StrengthCounts counts={counts} />
      <div className="look-lift">
        <figure className="look-lift-patch" onMouseEnter={() => onHover(main)} onMouseLeave={() => onHover(null)}>
          <figcaption>{text.strongestHere}</figcaption>
          <TokenPicture point={mainPoint} uploadUrl={uploadUrl} />
          <p><BandChip band={mainBand} /> {LOOK_TEXT.position(lobePosition(mainPoint.norm, strength))}</p>
          <button className="button" aria-pressed={anchor === main} disabled={anchor === main} onClick={() => onSelectAnchor(main)}>{anchor === main ? LOOK_TEXT.asking : LOOK_TEXT.askForIt}</button>
        </figure>
        {mainBand === STRONGEST ? <p className="look-hint">{text.alreadyStrongest}</p> : (
          <>
            <span className="look-lift-arrow" aria-hidden="true">→</span>
            {lift && liftPoint ? (
              <figure className="look-lift-patch" data-lift onMouseEnter={() => onHover(lift.index)} onMouseLeave={() => onHover(null)}>
                <figcaption>{text.nearest(STRONGEST)}</figcaption>
                <TokenPicture point={liftPoint} />
                <p><BandChip band={STRONGEST} /> {LOOK_TEXT.position(lobePosition(liftPoint.norm, strength))} · {LOOK_TEXT.liftNote(lift.degrees)}</p>
                <button className="button look-primary" aria-pressed={anchor === lift.index} disabled={anchor === lift.index} onClick={() => onSelectAnchor(lift.index)}>
                  {anchor === lift.index ? LOOK_TEXT.asking : LOOK_TEXT.lift(STRONGEST)}
                </button>
              </figure>
            ) : <p className="look-hint">{LOOK_TEXT.noLift(STRONGEST)}</p>}
          </>
        )}
      </div>
      <LobeGauge strength={strength} marks={marks} span={span} arrow={lift ? { from: 0, to: 1 } : undefined} />
      <p className="look-hint">{text.span}</p>
      <p className="look-hint">{text.move}</p>
      <div className="look-picture-actions">
        <button className="button" onClick={onSelectOwn}>{text.selectAll}</button>
        {onGrowFrom && <button className="button look-primary" onClick={onGrowFrom}>{text.growFrom}</button>}
      </div>
      <TokenStrip indices={ownByStrength} token={token} label={text.title} uploadUrl={uploadUrl} onHover={onHover} onSeed={onSeed} selected={selected} />
      {blockStrongest.length > 0 && (
        <>
          <h3 className="look-subhead">{text.blockStrongest}</h3>
          <TokenStrip indices={blockStrongest} token={token} label={text.blockStrongest} onHover={onHover} onSeed={onSeed} selected={selected} />
        </>
      )}
    </section>
  );
}
