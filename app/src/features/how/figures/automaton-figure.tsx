// Act 3's figure: the automaton of group 4009 from its record (automaton-record.ts) and its published
// definition. Growing live beside one cell opened; its two scales; the signal that trains it (its
// picture read by DINO into the group's space); its training, update by update; the global reading
// beside the local rule; and, for the results, the group's published automata.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useLibrary } from "../../../app/library-session";
import { fill, SITE_WORDS } from "../../../app/site-words";
import { FIRE_KEY, fires } from "../../../replay/figure-reference";
import { AtlasCloudFigure } from "../../../ui/atlas-cloud-figure";
import { ResetMark } from "../../../ui/reset-mark";
import { Slider } from "../../../ui/slider";
import { useLoaded } from "../../../ui/use-loaded";
import { useMaterialIndex, usePublishedMaterial } from "../../gallery/material-gallery";
import { materialsOfBlock } from "../../gallery/material-index";
import { HomeMaterial, type HomeStill } from "../../home/home-material-view";
import { STORY_FOLDER } from "../training-story";
import { usePrefersReducedMotion } from "../../landing/motion";
import { BlockMaterials } from "../../look/block-materials";
import { automatonCellAtPatch, detectorPictures, gridPixels, imagePixels, stretchedCoarsePixels } from "../automaton-math";
import { loadAutomatonRecord, type AutomatonGrid, type AutomatonRecord } from "../automaton-record";
import { projectBasis } from "../basis-math";
import { attentionRow, attentionShares, splitKeys } from "../dino-math";
import { useReportFacts } from "../how-facts";
import { figureCellAt, PictureWithPatches, useFigureCanvas } from "../how-figures";
import { cellName, tokenName } from "../how-names";
import { LAYERS, PATCHES, PREFIX, WIDTH } from "../how-shapes";
import { HOW_PICTURE } from "../how-source";
import { CHANNELS, neighbourhood, PERCEPTION_FILTERS } from "../nca-math";
import { useSourced } from "../use-sourced";
import { HOW_AUTOMATON, loadHowStory } from "./figure-data";
import { FigureCaption } from "./figure-caption";
import { FigureReadout } from "./figure-readout";
import "../../look/look.css";
import "./figures.css";

const WORDS = SITE_WORDS.how.figures;
export type AutomatonMode = "cells" | "scales" | "signal" | "updates" | "local-global" | "kinds";
/** The patch of the grown picture the local-global section opens on: row 8, column 9, near the middle. */
const DEFAULT_PATCH = 7 * 16 + 8;

export function AutomatonFigure({ mode }: { mode: AutomatonMode }) {
  const record = useLoaded("automaton", loadAutomatonRecord);
  const index = useMaterialIndex();
  const entry = index.status === "ready" ? materialsOfBlock(index.index, HOW_PICTURE.block).find((candidate) => candidate.id === HOW_AUTOMATON) ?? null : null;
  const ready = record.status === "ready" ? record.value : null;
  return (
    <div className="how-automaton" data-mode={mode}>
      {mode === "cells" && <Cells record={ready} entry={entry} />}
      {mode === "scales" && ready && <Scales record={ready} />}
      {mode === "signal" && ready && <Signal record={ready} />}
      {mode === "updates" && ready && <Updates record={ready} />}
      {mode === "local-global" && ready && <LocalGlobal record={ready} />}
      {mode === "kinds" && (
        <div className="how-kinds">
          <BlockMaterials block={HOW_PICTURE.block} index={index} />
          <div className="how-doors">
            <Link className="button primary" to="/train">{WORDS.trainDoor}</Link>
            <Link className="button" to="/index">{WORDS.indexDoor}</Link>
          </div>
        </div>
      )}
      {record.status === "failed" && <p className="how-caption" role="alert">{fill(SITE_WORDS.how.failed, { message: record.message })}</p>}
    </div>
  );
}

/** Draw a grid in the CSS-sized canvas. The backing resolution is set by useFigureCanvas. */
function drawPixels(context: CanvasRenderingContext2D, pixels: Uint8ClampedArray<ArrayBuffer>, side: number, size: number) {
  const source = new OffscreenCanvas(side, side);
  source.getContext("2d")!.putImageData(new ImageData(pixels, side, side), 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, size, size);
}

/** Pixels in a stack layer. CSS owns its square; the observer only redraws its backing pixels. */
function PixelCanvas({ pixels, side, className }: { pixels: Uint8ClampedArray<ArrayBuffer>; side: number; className?: string }) {
  const canvas = useFigureCanvas((context, width) => drawPixels(context, pixels, side, width), [pixels, side]);
  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}

/** A picture of a grid with one cell marked; pointer coordinates follow the displayed box. */
function PixelGrid({ pixels, side, marked, onHover, onPick, label }: {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  side: number;
  marked: number | null;
  onHover?: (cell: number | null) => void;
  onPick?: (cell: number) => void;
  label: string;
}) {
  const canvas = useFigureCanvas((context, width) => {
    drawPixels(context, pixels, side, width);
    if (marked !== null) {
      const cell = width / side;
      context.strokeStyle = "#efece8";
      context.lineWidth = 1;
      context.strokeRect((marked % side) * cell - 1.5, Math.floor(marked / side) * cell - 1.5, cell + 3, cell + 3);
    }
  }, [pixels, side, marked]);
  return (
    <canvas ref={canvas} className="how-grid" role="img" aria-label={label}
      onPointerMove={onHover && ((event) => onHover(figureCellAt(event, side)))}
      onPointerLeave={onHover && (() => onHover(null))}
      onClick={onPick && ((event) => {
        const cell = figureCellAt(event, side);
        if (cell !== null) onPick(cell);
      })} />
  );
}

/** A grid's own colours with one cell marked. */
function GridCanvas({ grid, marked, onHover, onPick, label }: {
  grid: AutomatonGrid;
  marked: number | null;
  onHover?: (cell: number | null) => void;
  onPick?: (cell: number) => void;
  label: string;
}) {
  const pixels = useMemo(() => gridPixels(grid), [grid]);
  return <PixelGrid pixels={pixels} side={grid.side} marked={marked} onHover={onHover} onPick={onPick} label={label} />;
}

function Neighbourhood({ grid, cell, size }: { grid: AutomatonGrid; cell: number; size: number }) {
  const values = neighbourhood(grid.state, grid.side, cell);
  const colour = (at: number) => {
    const byte = (channel: number) => Math.round(255 * Math.min(1, Math.max(0, values[at * CHANNELS + channel]! + 0.5)));
    return `rgb(${byte(0)} ${byte(1)} ${byte(2)})`;
  };
  return (
    <div className="how-neighbourhood" style={{ width: size, height: size }} aria-hidden="true">
      {Array.from({ length: 9 }, (_, at) => <span key={at} style={{ background: colour(at) }} data-centre={at === 4 || undefined} />)}
    </div>
  );
}

/** A detector's 3 × 3 stencil, its weights written in the cells. */
function Stencil({ kernel }: { kernel: readonly number[] }) {
  return (
    <div className="how-stencil-grid" aria-hidden="true">
      {kernel.map((weight, at) => (
        <span key={at} data-sign={weight > 0 ? "+" : weight < 0 ? "-" : undefined}>{weight === 0 ? "·" : weight < 0 ? `−${-weight}` : weight}</span>
      ))}
    </div>
  );
}

/** The grid through the four fixed detectors, a picture each with its stencil and name; the followed cell is marked in all four. */
function DetectorPictures({ grid, marked, onHover }: { grid: AutomatonGrid; marked: number | null; onHover: (cell: number | null) => void }) {
  const pictures = useMemo(() => detectorPictures(grid), [grid]);
  return (
    <div className="how-detectors">
      <div className="how-detector-pictures">
        {PERCEPTION_FILTERS.map((filter, k) => (
          <div key={filter.name} className="how-detector-picture">
            <PixelGrid pixels={pictures[k]!} side={grid.side} marked={marked} onHover={onHover} label={fill(WORDS.detectorPictureName, { detector: WORDS.detectors[filter.name] })} />
            <Stencil kernel={filter.kernel} />
            <span className="how-caption">{WORDS.detectors[filter.name]}{filter.divisor > 1 && ` ${fill(WORDS.detectorDivisor, { divisor: filter.divisor })}`}</span>
          </div>
        ))}
      </div>
      <p className="how-caption">{WORDS.detectorPicturesCaption}</p>
    </div>
  );
}

/**
 * The automaton growing live beside its rule: its coarse grid through the four fixed detectors.
 * Hover marks the same cell in every picture. The player has no brush and never regrows by
 * itself; a button grows it again.
 */
function Cells({ record, entry }: { record: AutomatonRecord | null; entry: ReturnType<typeof materialsOfBlock>[number] | null }) {
  const reduced = usePrefersReducedMotion();
  const [noReplay, setNoReplay] = useState(false);
  const [grown, setGrown] = useState(0);
  const still: HomeStill = !("gpu" in navigator) || noReplay ? "no-webgpu" : reduced ? "reduced-motion" : null;
  const material = usePublishedMaterial(still ? null : entry ?? null);
  const grid = record?.coarse ?? null;
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="how-pair">
      <figure className="how-pane how-player">
        <div className="how-visual">
          {entry ? <HomeMaterial key={grown} entry={entry} material={material.status === "ready" ? material.value : null} brush={false} regrowAtTick={Number.POSITIVE_INFINITY} onNoReplay={() => setNoReplay(true)} /> : <div className="how-colors" />}
        </div>
        <figcaption className="how-caption">{fill(WORDS.cellsPlayerCaption, { group: HOW_PICTURE.block })}</figcaption>
        {entry && !still && (
          <button type="button" className="how-regrow reset-control" aria-label={SITE_WORDS.home.resetAutomaton} title={SITE_WORDS.home.resetAutomaton} onClick={() => setGrown((count) => count + 1)}>
            <ResetMark />
          </button>
        )}
      </figure>
      <div className="how-pane how-rule">
        {grid && <DetectorPictures grid={grid} marked={hovered} onHover={setHovered} />}
        <p className="how-caption">{WORDS.cellCaption}</p>
      </div>
    </div>
  );
}

/** The grids stack by themselves this long after the section opens. */
const STACK_AFTER_MS = 900;

/**
 * The two grids at step 600 as a stack: the fine grid at the base, the coarse grid lifted above it at
 * its own cell size, or stretched over the fine grid with the image, their sum, on top. A click lifts
 * the grids apart or stacks them again; with reduced motion they begin stacked and move at once.
 */
function Scales({ record }: { record: AutomatonRecord }) {
  const reduce = usePrefersReducedMotion();
  const [stacked, setStacked] = useState(reduce);
  useEffect(() => {
    if (reduce) {
      setStacked(true);
      return;
    }
    const timer = window.setTimeout(() => setStacked(true), STACK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [reduce]);
  const fine = useMemo(() => gridPixels(record.fine), [record.fine]);
  const coarse = useMemo(() => gridPixels(record.coarse), [record.coarse]);
  const stretched = useMemo(() => stretchedCoarsePixels(record.coarse, record.fine.side), [record.coarse, record.fine.side]);
  const image = useMemo(() => imagePixels(record.fine, record.coarse), [record.fine, record.coarse]);
  return (
    <figure className="how-pane how-stack-figure">
      <div className="how-visual">
        <button type="button" className="how-stack" onClick={() => setStacked(!stacked)} aria-label={WORDS.stackName} data-stacked={stacked ? "" : undefined}>
          <div className="how-stack-layer how-stack-fine">
            <PixelCanvas pixels={fine} side={record.fine.side} />
          </div>
          <div className="how-stack-layer how-stack-coarse">
            <PixelCanvas pixels={coarse} side={record.coarse.side} />
            <PixelCanvas className="how-stack-stretched" pixels={stretched} side={record.fine.side} />
          </div>
          <div className="how-stack-layer how-stack-image">
            <PixelCanvas pixels={image} side={record.fine.side} />
          </div>
          <span className="how-stack-label how-stack-coarse-label">{WORDS.stackCoarseLabel}</span>
          <span className="how-stack-label how-stack-fine-label">{WORDS.stackFineLabel}</span>
          <span className="how-stack-label how-stack-image-label">{WORDS.stackImageLabel}</span>
        </button>
      </div>
      <FigureCaption reserve={[WORDS.stackCaptionStacked, WORDS.stackCaptionApart]}>
        {stacked ? WORDS.stackCaptionStacked : WORDS.stackCaptionApart}
      </FigureCaption>
    </figure>
  );
}

/**
 * The training signal: the grown image read by DINO and the featurizer exactly as the hibiscus was,
 * its 256 patches projected into the group's cloud beside the target, with a line from their
 * projected mean to that target. Hover a patch of the image to find its point.
 */
function Signal({ record }: { record: AutomatonRecord }) {
  const reading = record.reading;
  const tokens = useSourced(reading, (source) => source.final());
  const frame = useSourced(reading, (source) => source.frame(HOW_PICTURE.block));
  const calibration = useLoaded("calibration", () => record.dictionary.calibration());
  const library = useLibrary();
  const cloud = useLoaded("cloud", () => library.atlasCloud(HOW_PICTURE.block));
  const story = useLoaded("story", loadHowStory);
  const [hovered, setHovered] = useState<number | null>(null);
  const target = record.replay.anchor.code;
  const m = record.replay.medianNorm;
  const landed = useMemo(() => {
    if (tokens.status !== "ready" || frame.status !== "ready" || calibration.status !== "ready" || story.status !== "ready") return null;
    const { mean, scale } = calibration.value;
    const [a1, a2] = story.value.anchor.atlasPlane;
    const place = (code: readonly number[]): readonly [number, number] => [
      code[0]! * a1[0] + code[1]! * a1[1] + code[2]! * a1[2],
      code[0]! * a2[0] + code[1]! * a2[1] + code[2]! * a2[2],
    ];
    const codes: [number, number, number][] = [];
    for (let patch = 0; patch < 256; patch++) {
      const at = (PREFIX + patch) * WIDTH;
      const calibrated = Float32Array.from({ length: WIDTH }, (_, channel) => scale * (tokens.value[at + channel]! - mean[channel]!));
      codes.push(projectBasis(calibrated, frame.value));
    }
    const average = [0, 1, 2].map((axis) => codes.reduce((sum, code) => sum + code[axis]!, 0) / codes.length);
    return {
      points: codes.map(place),
      mean: place(average),
      distance: Math.hypot(...average.map((value, axis) => value - target[axis]!)) / m,
    };
  }, [tokens, frame, calibration, story, target, m]);
  const failed = [tokens, frame, calibration, cloud, story].find((result) => result.status === "failed");
  if (failed) return <p className="how-caption" role="alert">{fill(SITE_WORDS.how.failed, { message: failed.message })}</p>;
  const distance = landed?.distance.toFixed(2);
  const spaceCaption = fill(WORDS.spaceCaption, { group: HOW_PICTURE.block });
  const captionReserve = [WORDS.grownCaption, spaceCaption];
  return (
    <div className="how-pair">
      <figure className="how-pane">
        <div className="how-visual">
          <PictureWithPatches src={record.picture.large} pinned={null} inspected={hovered} onHover={setHovered} alt={WORDS.grownCaption} />
        </div>
        <FigureCaption reserve={captionReserve}>{WORDS.grownCaption}</FigureCaption>
      </figure>
      <figure className="how-pane">
        <div className="how-visual">
          <div className="how-cloud-figure">
            {cloud.status === "ready" && story.status === "ready" && (
              <AtlasCloudFigure
                cloud={cloud.value}
                lit={story.value.anchor.atlasPoint}
                label={WORDS.targetLabel}
                landed={landed ? { points: landed.points, mean: landed.mean, marked: hovered } : null}
                meanLabel={WORDS.meanLabel}
                distanceLabel={distance ? {
                  text: fill(WORDS.signalDistance, { distance }),
                  description: fill(WORDS.signalLine, { distance }),
                } : undefined}
              />
            )}
          </div>
        </div>
        <FigureCaption reserve={captionReserve}>{spaceCaption}</FigureCaption>
      </figure>
    </div>
  );
}

/** The training strip, one readout at a time, beside the loss at every update and the readouts' selection. */
function Updates({ record }: { record: AutomatonRecord }) {
  const story = useLoaded("story", loadHowStory);
  const report = useReportFacts();
  const frames = story.status === "ready" ? story.value.training.frames : [];
  const [at, setAt] = useState<number | null>(null);
  const shown = at ?? Math.max(0, frames.length - 1);
  const frame = frames[shown] ?? null;
  const readings = frames.map((entry) => ({
    selection: fill(WORDS.updateReadout.selectionValue, { wins: Math.round(100 * entry.winnerFraction) }),
    strength: fill(WORDS.updateReadout.strengthValue, { strength: entry.strength.toFixed(2) }),
  }));
  const reading = readings[shown];
  useEffect(() => {
    const last = frames[frames.length - 1];
    if (last) report({ update: last.update, wins: Math.round(100 * last.winnerFraction) });
  }, [frames, report]);
  const chartWidth = 512;
  const chartHeight = 192;
  const margin = { left: 40, right: 40, top: 12, bottom: 24 };
  const updates = record.history.updates;
  const lastUpdate = updates[updates.length - 1]?.[0] ?? 1;
  const topLoss = Math.max(...updates.map((row) => row[1]));
  const x = (update: number) => margin.left + ((update - 1) / Math.max(1, lastUpdate - 1)) * (chartWidth - margin.left - margin.right);
  const yLoss = (loss: number) => margin.top + (1 - loss / topLoss) * (chartHeight - margin.top - margin.bottom);
  const ySelection = (share: number) => margin.top + (1 - share) * (chartHeight - margin.top - margin.bottom);
  const path = updates.map((row, index) => `${index === 0 ? "M" : "L"}${x(row[0]).toFixed(1)} ${yLoss(row[1]).toFixed(1)}`).join(" ");
  if (story.status === "failed") return <p className="how-caption" role="alert">{fill(SITE_WORDS.how.failed, { message: story.message })}</p>;
  return (
    <div className="how-updates">
      <div className="how-pair">
        <figure className="how-pane how-update-frames">
          <div className="how-visual">
            <div className="how-strip">
              {story.status === "ready" && (
                <img src={`${STORY_FOLDER}${story.value.training.strip}`} alt="" style={{ width: `${frames.length * 100}%`, height: "100%", left: `${-shown * 100}%` }} />
              )}
            </div>
          </div>
          {frames.length > 1 && (
            <Slider label={WORDS.updateSlider} value={shown} min={0} max={frames.length - 1} ticks={frames.map((_, index) => index)} valueText={String(frame?.update ?? "")} onChange={setAt} />
          )}
          <figcaption className="how-caption">{WORDS.stripCaption}</figcaption>
        </figure>
        <div className="how-pane">
          <svg className="how-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={WORDS.lossCaption}>
            <line className="how-chart-axis" x1={margin.left} x2={chartWidth - margin.right} y1={yLoss(0)} y2={yLoss(0)} />
            <text className="how-chart-label" x={margin.left - 6} y={yLoss(topLoss) + 4} textAnchor="end">{topLoss.toFixed(1)}</text>
            <text className="how-chart-label" x={margin.left - 6} y={yLoss(0) + 4} textAnchor="end">0</text>
            <text className="how-chart-label" x={chartWidth - margin.right + 6} y={ySelection(1) + 4}>100%</text>
            <text className="how-chart-label" x={chartWidth - margin.right + 6} y={ySelection(0) + 4}>0%</text>
            <text className="how-chart-label" x={x(1)} y={chartHeight - 6} textAnchor="middle">1</text>
            <text className="how-chart-label" x={x(lastUpdate)} y={chartHeight - 6} textAnchor="middle">{lastUpdate}</text>
            <path className="how-chart-line" d={path} />
            {record.history.readouts.map((row) => <circle key={row[0]} className="how-chart-dot" cx={x(row[0])} cy={ySelection(row[1])} r={2.5} data-fire={row[1] >= 0.9 || undefined} />)}
            {frame && <line className="how-chart-mark" x1={x(frame.update)} x2={x(frame.update)} y1={margin.top} y2={yLoss(0)} />}
          </svg>
          <p className="how-caption">{WORDS.lossCaption}</p>
        </div>
      </div>
      <FigureReadout rows={[
        {
          value: reading?.selection ?? "—",
          label: WORDS.updateReadout.selection,
          reserve: readings.map((entry) => entry.selection),
        },
        {
          value: reading?.strength ?? "—",
          label: WORDS.updateReadout.strength,
          reserve: readings.map((entry) => entry.strength),
        },
      ]} />
    </div>
  );
}

/** Where one patch of the grown picture reads from, beside the cell at that place and its eight neighbours. */
function LocalGlobal({ record }: { record: AutomatonRecord }) {
  const [kept, setKept] = useState(DEFAULT_PATCH);
  const [hovered, setHovered] = useState<number | null>(null);
  const patch = hovered ?? kept;
  const attention = useSourced(record.reading, (source) => source.attention(LAYERS - 1));
  const row = attention.status === "ready" ? attentionRow(attention.value.attention, attention.value.heads, PREFIX + patch, "mean") : null;
  const heat = row ? splitKeys(row).patches : null;
  const shares = row ? attentionShares(row, patch) : null;
  const cell = automatonCellAtPatch(patch, record.fine.side);
  const captionReserve = [
    fill(WORDS.heatCaption, { patch: tokenName(PREFIX + PATCHES - 1), outside: 100 }),
    WORDS.cellsCaption,
  ];
  if (attention.status === "failed") return <p className="how-caption" role="alert">{fill(SITE_WORDS.how.failed, { message: attention.message })}</p>;
  return (
    <div className="how-pair">
      <figure className="how-pane">
        <div className="how-visual">
          <PictureWithPatches src={record.picture.large} heat={heat} heatScale={heat ? Math.max(...heat) : 1} pinned={kept} inspected={hovered} onHover={setHovered} onPick={setKept} alt={WORDS.grownCaption} />
        </div>
        <FigureCaption reserve={captionReserve}>
          {fill(WORDS.heatCaption, { patch: tokenName(PREFIX + patch), outside: shares ? Math.round(100 * shares.outside) : "—" })}
        </FigureCaption>
      </figure>
      <figure className="how-pane how-cell-detail">
        <div className="how-cell-row">
          <GridCanvas grid={record.fine} marked={cell} label={WORDS.fineCaption} />
          <div className="how-cell-side">
            <Neighbourhood grid={record.fine} cell={cell} size={96} />
          </div>
        </div>
        <FigureReadout rows={[{
          value: cellName(cell, record.fine.side),
          label: fires(record.fine.seed, record.fine.tick, cell, record.replay.fireRate, FIRE_KEY) ? WORDS.cellFires : WORDS.cellHolds,
          reserve: [cellName(record.fine.side ** 2 - 1, record.fine.side)],
        }]} />
        <FigureCaption reserve={captionReserve}>{WORDS.cellsCaption}</FigureCaption>
      </figure>
    </div>
  );
}
