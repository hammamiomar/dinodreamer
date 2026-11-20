import { useMemo, useState, type CSSProperties } from "react";
import type { TokenResponses } from "../../library/records";
import { CELLS, PATCH_SLOT_OFFSET, type StrengthCuts } from "../../recipe";
import type { CloudToken } from "./cloud-token";
import { WARNED_BELOW } from "./grow-from-picture";
import { LOOK_TEXT } from "./look-text";
import { PatchMap } from "./patch-map";
import type { PageLift } from "./request-panel";
import { BandChip, StrengthCounts } from "./strength-display";
import { BAND_COLOURS, bandIndex, STRONGEST } from "./strength-bands";
import { TokenPicture } from "./token-pictures";

const text = LOOK_TEXT.pictureHere;

/**
 * Your picture on a basis group's page: how strongly it shows the group against the library, what a
 * Level 4 patch of the same kind looks like, and Train. The levels of your patches come first. Then your
 * picture, one map with your patches lit by response magnitude, beside the Level 4 library patch nearest
 * your patch's direction; each picture has its level's colour around it, its caption and its own Train
 * button. Choosing a lit patch makes it your patch and the page's reference patch (look-page.tsx), which
 * the response plot and Advanced share.
 */
export function PictureHere({ pictureName, uploadUrl, ownByStrength, token, strength, chosen, nearestStrongest, onChoose, onHover, onShowInPlot, onTrain, onRemove }: {
  pictureName: string;
  uploadUrl: string;
  /** Page indices of your patches in this group, the strongest first. */
  ownByStrength: readonly number[];
  token: (index: number) => CloudToken;
  strength: StrengthCuts;
  /** The page's reference patch; null is your strongest patch. */
  chosen: number | null;
  /** The Level 4 library patch nearest a patch's direction, at any level of that patch. */
  nearestStrongest: (index: number) => PageLift | null;
  onChoose: (reference: number | null) => void;
  onHover: (index: number | null) => void;
  onShowInPlot: () => void;
  /** Train toward a reference patch (null: your strongest); null without a patch here. */
  onTrain: ((reference: number | null) => void) | null;
  onRemove: () => void;
}) {
  const own = useMemo(() => new Set(ownByStrength), [ownByStrength]);
  const ownAtCell = useMemo(() => new Map(ownByStrength.map((index) => [token(index).slot - PATCH_SLOT_OFFSET, index])), [ownByStrength, token]);
  const lit = useMemo(() => litPatches(ownByStrength.map(token)), [ownByStrength, token]);
  // The patch the map shows as yours: the reference when it is one of your patches, else the last you chose.
  const [picked, setPicked] = useState<number | null>(null);
  const head = (
    <div className="look-section-head">
      <h2 id="picture-here-title">{text.title}</h2>
      <span>{pictureName} · <button type="button" className="link-control" aria-label={text.removeName} onClick={onRemove}>{text.remove}</button></span>
    </div>
  );
  if (ownByStrength.length === 0) {
    return (
      <section className="picture-here" aria-labelledby="picture-here-title">
        {head}
        <p className="look-hint">{text.none}</p>
      </section>
    );
  }
  const main = ownByStrength[0]!;
  const yourPatch = chosen !== null && own.has(chosen) ? chosen : picked ?? main;
  const yourBand = bandIndex(token(yourPatch).norm, strength);
  const near = nearestStrongest(yourPatch);
  // Your strongest patch is the page's default reference (null).
  const yourReference = yourPatch === main ? null : yourPatch;
  // Below Level 3 a patch rarely meets the selection target in training (WARNED_BELOW): the library patch's button leads.
  const libraryLeads = near !== null && yourBand < WARNED_BELOW;
  const counts = [0, 0, 0, 0];
  for (const index of ownByStrength) counts[bandIndex(token(index).norm, strength)]++;

  const choosePatch = (index: number) => {
    setPicked(index);
    onChoose(index === main ? null : index);
  };
  return (
    <section className="picture-here" aria-labelledby="picture-here-title">
      {head}
      <div className="picture-here-counts">
        <span>{text.yourPatches(ownByStrength.length)}</span>
        <StrengthCounts counts={counts} />
      </div>
      <div className="picture-here-pair">
        <figure className="picture-here-picture" style={{ "--band": BAND_COLOURS[yourBand] } as CSSProperties}>
          <div className="picture-here-frame">
            <PatchMap src={uploadUrl} name={text.mapName} lit={lit.patches} scale={lit.scale}
              chosen={token(yourPatch).slot - PATCH_SLOT_OFFSET} choosable={(cell) => ownAtCell.has(cell)}
              onPoint={(cell) => onHover(cell === null ? null : ownAtCell.get(cell) ?? null)}
              onChoose={(cell) => choosePatch(ownAtCell.get(cell)!)} />
          </div>
          <figcaption>{text.yours} · <BandChip band={yourBand} /></figcaption>
          {onTrain && (
            <button type="button" className={libraryLeads ? "button" : "button primary"} onClick={() => onTrain(yourReference)}>{text.trainYours}</button>
          )}
        </figure>
        <span className="picture-here-arrow" aria-hidden="true">{near && yourBand < STRONGEST ? "→" : ""}</span>
        <figure className="picture-here-picture" style={{ "--band": BAND_COLOURS[STRONGEST] } as CSSProperties}
          onMouseEnter={() => near && onHover(near.index)} onMouseLeave={() => onHover(null)}>
          {near ? (
            <>
              <div className="picture-here-frame"><TokenPicture point={token(near.index)} large /></div>
              <figcaption>{text.library} · <BandChip band={STRONGEST} /> · {text.mostSimilar}</figcaption>
              {onTrain && (
                <button type="button" className={libraryLeads ? "button primary" : "button"} onClick={() => onTrain(near.index)}>{text.trainLibrary}</button>
              )}
            </>
          ) : <p className="picture-here-empty">{text.noLibrary}</p>}
        </figure>
      </div>
      <button type="button" className="link-control picture-here-plot" onClick={onShowInPlot}>{text.showInPlot}</button>
    </section>
  );
}

/** Your patches lit by response magnitude, the strongest brightest, as a response view draws them. */
function litPatches(points: readonly CloudToken[]): { patches: TokenResponses; scale: number } {
  const norm = new Array<number>(CELLS).fill(0);
  const gated = new Array<boolean>(CELLS).fill(false);
  for (const point of points) {
    const cell = point.slot - PATCH_SLOT_OFFSET;
    norm[cell] = point.norm;
    gated[cell] = true;
  }
  return { patches: { norm, gated }, scale: Math.max(0, ...points.map((point) => point.norm)) };
}
