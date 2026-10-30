// Act 1's figure: the picture with its patches beside what the model sees (the patches coloured
// by their tokens' main directions), and the attention of the followed patch by layer. One
// component for both sections, so the picture and the followed patch carry over.
import { useEffect, useMemo, useState } from "react";
import { useLibrary } from "../../../app/library-session";
import { fill, SITE_WORDS } from "../../../app/site-words";
import { cssColour } from "../../../ui/css-colour";
import { Slider } from "../../../ui/slider";
import { attentionRow, attentionShares, neighbourhoodOf, sharePercents, splitKeys } from "../dino-math";
import { useReportFacts } from "../how-facts";
import { figureCellAt, PictureWithPatches, useFigureCanvas } from "../how-figures";
import { tokenName } from "../how-names";
import { LAYERS, PATCHES, PREFIX } from "../how-shapes";
import { HOW_PICTURE } from "../how-source";
import { useSourced } from "../use-sourced";
import { useHowSource } from "./figure-data";
import { principalColours } from "./token-colours";
import { FigureCaption } from "./figure-caption";
import "./figures.css";

const WORDS = SITE_WORDS.how.figures;
const ALL_LAYERS = Array.from({ length: LAYERS }, (_, index) => index + 1);

export function DinoFigure({ mode }: { mode: "patches" | "attention" }) {
  const library = useLibrary();
  const opened = useHowSource();
  const source = opened.status === "ready" ? opened.source : null;
  const report = useReportFacts();
  const followed = HOW_PICTURE.patch;
  const [hovered, setHovered] = useState<number | null>(null);
  const [layer, setLayer] = useState(LAYERS);
  const patch = hovered ?? followed;

  const final = useSourced(source, (current) => current.final());
  const colours = useMemo(() => (final.status === "ready" ? principalColours(final.value) : null), [final]);
  const attention = useSourced(mode === "attention" ? source : null, (current) => current.attention(layer - 1), [layer]);
  const everyLayer = useSourced(mode === "attention" ? source : null, (current) => Promise.all(ALL_LAYERS.map((at) => current.attention(at - 1))));

  const row = attention.status === "ready" ? attentionRow(attention.value.attention, attention.value.heads, PREFIX + patch, "mean") : null;
  const heat = row ? splitKeys(row).patches : null;
  const heatScale = heat ? Math.max(...heat) : 1;
  const shares = row ? sharePercents(attentionShares(row, patch)) : null;
  const sharesByLayer = useMemo(
    () => (everyLayer.status === "ready" ? everyLayer.value.map((weights) => attentionShares(attentionRow(weights.attention, weights.heads, PREFIX + followed, "mean"), followed)) : null),
    [everyLayer, followed],
  );
  const outsideByLayer = sharesByLayer?.map((share) => share.outside) ?? null;
  useEffect(() => {
    const last = sharesByLayer?.[LAYERS - 1];
    if (!last) return;
    // The page's sentence quotes the same percentages as the shares under the slider.
    const { outside, prefix } = sharePercents(last);
    report({ outside, prefix });
  }, [sharesByLayer, report]);
  const neighbourhood = neighbourhoodOf(patch);

  const src = library.previewUrl(HOW_PICTURE.imageId);
  const alt = fill(WORDS.pictureAlt, { image: HOW_PICTURE.imageId });
  // Two-digit coordinates and the last layer reserve the longest numerical labels.
  const captionPatch = tokenName(PREFIX + PATCHES - 1);
  const captionReserve = mode === "patches"
    ? [fill(WORDS.following, { patch: captionPatch }), WORDS.coloursCaption]
    : [fill(WORDS.attentionCaption, { patch: captionPatch, layer: LAYERS })];
  const failed = [opened, final, attention, everyLayer].find((result) => result.status === "failed");
  return (
    <div className="how-dino" data-mode={mode} data-ready={colours ? "" : undefined}>
      <div className="how-pair">
        <figure className="how-pane">
          {/* The attention heat is the followed patch's own; an outline on it would read as a selection. Its 3 × 3 neighbourhood is boxed instead. */}
          <div className="how-visual">
            <div className="how-picture-wrap">
              <PictureWithPatches src={src} heat={mode === "attention" ? heat : null} heatScale={heatScale} pinned={mode === "attention" ? null : followed} inspected={hovered} onHover={setHovered} alt={alt} />
              {mode === "attention" && (
                <span className="how-neighbourhood-box" aria-hidden="true" style={{
                  left: `${neighbourhood.column * 100 / 16}%`, top: `${neighbourhood.row * 100 / 16}%`,
                  width: `${neighbourhood.columns * 100 / 16}%`, height: `${neighbourhood.rows * 100 / 16}%`,
                }} />
              )}
            </div>
          </div>
          <FigureCaption reserve={captionReserve}>
            {mode === "patches" ? fill(WORDS.following, { patch: tokenName(PREFIX + patch) }) : fill(WORDS.attentionCaption, { patch: tokenName(PREFIX + patch), layer })}
          </FigureCaption>
        </figure>
        {mode === "patches" ? (
          <figure className="how-pane">
            <div className="how-visual">
              <ColourMap colours={colours} pinned={followed} inspected={hovered} onHover={setHovered} />
            </div>
            <FigureCaption reserve={captionReserve}>{WORDS.coloursCaption}</FigureCaption>
          </figure>
        ) : (
          <div className="how-pane how-attention-side">
            <Slider label={WORDS.layer} value={layer} min={1} max={LAYERS} ticks={ALL_LAYERS} valueText={fill(WORDS.layerValue, { layer })} onChange={setLayer} />
            <AttentionShares percents={shares} />
            <div className="how-bars" role="img" aria-label={WORDS.byLayer}>
              {ALL_LAYERS.map((at) => (
                <button type="button" key={at} data-lit={at === layer || undefined} style={{ height: `${outsideByLayer ? Math.max(2, Math.round(100 * outsideByLayer[at - 1]!)) : 2}%` }} aria-label={fill(WORDS.layerValue, { layer: at })} onClick={() => setLayer(at)} />
              ))}
            </div>
            <div className="how-bars-axis" aria-hidden="true">
              {ALL_LAYERS.map((at) => <span key={at} data-lit={at === layer || undefined}>{at}</span>)}
            </div>
            <p className="how-caption">{WORDS.byLayer} {WORDS.layerAxis} 1 to 12.</p>
          </div>
        )}
      </div>
      {failed && <p className="how-caption" role="alert">{fill(SITE_WORDS.how.failed, { message: failed.message })}</p>}
    </div>
  );
}

const SHARE_PARTS = ["outside", "inside", "prefix"] as const;

/** Where the patch's attention goes at the shown layer: one bar split into the three shares, then a row for each. */
function AttentionShares({ percents }: { percents: ReturnType<typeof sharePercents> | null }) {
  return (
    <div className="how-shares">
      <div className="how-shares-bar" aria-hidden="true">
        {SHARE_PARTS.map((part) => <span key={part} data-part={part} style={{ flexGrow: percents?.[part] ?? 0 }} />)}
      </div>
      <ul className="how-shares-list">
        {SHARE_PARTS.map((part) => (
          <li key={part} data-part={part}>
            <span className="how-shares-value">{percents ? fill(WORDS.shares.value, { share: percents[part] }) : "—"}</span>
            <span className="how-shares-label">{WORDS.shares[part]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The 256 patches as coloured squares with the reader's grid, the pinned and inspected patches outlined. */
function ColourMap({ colours, pinned, inspected, onHover }: {
  colours: Uint8ClampedArray | null;
  pinned: number;
  inspected: number | null;
  onHover: (patch: number | null) => void;
}) {
  const canvas = useFigureCanvas((context, side) => {
    const cell = side / 16;
    if (colours) {
      for (let patch = 0; patch < 256; patch++) {
        context.fillStyle = `rgb(${colours[patch * 3]} ${colours[patch * 3 + 1]} ${colours[patch * 3 + 2]})`;
        context.fillRect((patch % 16) * cell, Math.floor(patch / 16) * cell, cell, cell);
      }
    }
    context.strokeStyle = "rgb(0 0 0 / 0.35)";
    context.lineWidth = 1;
    for (let line = 1; line < 16; line++) {
      const at = Math.round(line * cell) + 0.5;
      context.beginPath();
      context.moveTo(at, 0);
      context.lineTo(at, side);
      context.moveTo(0, at);
      context.lineTo(side, at);
      context.stroke();
    }
    const outline = (index: number, colour: string) => {
      context.strokeStyle = colour;
      context.strokeRect((index % 16) * cell + 0.5, Math.floor(index / 16) * cell + 0.5, cell - 1, cell - 1);
    };
    if (inspected !== null && inspected !== pinned) outline(inspected, "rgb(255 255 255 / 0.6)");
    outline(pinned, cssColour("--ink", "#efece8"));
  }, [colours, pinned, inspected]);
  return (
    <div className="how-picture how-colors" data-ready={colours ? "" : undefined}
      onPointerMove={(event) => onHover(figureCellAt(event, 16))} onPointerLeave={() => onHover(null)}>
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}
