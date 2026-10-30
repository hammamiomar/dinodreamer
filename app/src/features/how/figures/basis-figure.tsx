// Act 2's figure: the basis collection on the followed patch. Where the basis sits (a drawing),
// the 32 selected groups in the field with their responses, the group's cloud with this patch's
// point, the token rebuilt group by group, and how the collection was trained. One component
// across the act's sections, so the reading of the patch is loaded once.
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useLibrary } from "../../../app/library-session";
import { fill, SITE_WORDS } from "../../../app/site-words";
import { AtlasCloudFigure } from "../../../ui/atlas-cloud-figure";
import { DictionaryField } from "../../../ui/dictionary-field";
import { LibraryImage } from "../../../ui/library-image";
import { Slider } from "../../../ui/slider";
import { useLoaded } from "../../../ui/use-loaded";
import { basisGroupPath, PANEL_OPENED } from "../../look/basis-group-panel";
import { BasisGroupLinkLabel } from "../../../ui/basis-group-link-label";
import { BAND_NAMES, STRENGTH_BANDS } from "../../look/strength-bands";
import { loadFeaturizerPasses, type FeaturizerPassesRecord } from "../featurizer-passes-source";
import { explainedEnergy, residualCurve, winnerIndex } from "../bsf-math";
import { useReportFacts } from "../how-facts";
import { formatValue } from "../how-figures";
import { tokenName } from "../how-names";
import { PREFIX, WINNERS } from "../how-shapes";
import { HOW_PICTURE } from "../how-source";
import { useSourced } from "../use-sourced";
import { loadHowStory, useHowSource } from "./figure-data";
import { BasisSchematic } from "./basis-schematic";
import { FigureCaption } from "./figure-caption";
import { FigureReadout } from "./figure-readout";
import "./figures.css";

const WORDS = SITE_WORDS.how.figures;
export type BasisMode = "basis-place" | "selection" | "cloud" | "rebuild" | "basis-training";
/** The maximum number of pictures sampled from the cloud's strongest level. */
const STRONGEST_SHOWN = 6;

export function BasisFigure({ mode }: { mode: BasisMode }) {
  const library = useLibrary();
  const opened = useHowSource();
  const source = opened.status === "ready" ? opened.source : null;
  const report = useReportFacts();

  // The followed patch through the collection: its 32 groups in rank order, their responses, the frames.
  const reading = useSourced(source, async (current) => {
    const gate = await current.gate(HOW_PICTURE.patch);
    const frames = await Promise.all([...gate.blocks].map((block) => current.frame(block)));
    return { gate, frames, curve: residualCurve(gate.calibrated, gate.codes, frames, gate.gain) };
  });
  const read = reading.status === "ready" ? reading.value : null;
  const cloud = useLoaded("cloud", () => library.atlasCloud(HOW_PICTURE.block));
  const story = useLoaded("story", loadHowStory);
  const training = useLoaded(mode === "basis-training" ? "training" : null, () => (mode === "basis-training" ? loadFeaturizerPasses() : null));

  useEffect(() => {
    if (read) report({ rank: winnerIndex(read.gate.blocks, HOW_PICTURE.block) + 1, explained: Math.round(100 * explainedEnergy(read.curve[WINNERS]!)) });
  }, [read, report]);
  useEffect(() => {
    if (cloud.status === "ready") report({ patches: cloud.value.wins.toLocaleString("en-US") });
  }, [cloud, report]);
  useEffect(() => {
    if (story.status === "ready") report({ level: STRENGTH_BANDS.indexOf(story.value.anchor.band) + 1 });
  }, [story, report]);
  useEffect(() => {
    if (training.status === "ready" && training.value) report({ pass1: training.value.passes[0]!.loss.total.toFixed(3), pass3: training.value.passes[training.value.passes.length - 1]!.loss.total.toFixed(3) });
  }, [training, report]);

  const dependencies = {
    "basis-place": [],
    selection: [opened, reading],
    cloud: [cloud, story],
    rebuild: [opened, reading],
    "basis-training": [training],
  }[mode];
  const failed = dependencies.find((result) => result.status === "failed");
  return (
    <div className="how-basis" data-mode={mode}>
      {mode === "basis-place" && <BasisSchematic />}
      {mode === "selection" && <Selection read={read} />}
      {mode === "cloud" && (
        <Cloud cloud={cloud.status === "ready" ? cloud.value : null} point={story.status === "ready" ? story.value.anchor : null} />
      )}
      {mode === "rebuild" && <Rebuild curve={read?.curve ?? null} />}
      {mode === "basis-training" && training.status === "ready" && training.value && <Training record={training.value} />}
      {failed && <p className="how-caption" role="alert">{fill(SITE_WORDS.how.failed, { message: failed.message })}</p>}
    </div>
  );
}

type Reading = { gate: { blocks: Uint16Array; norms: Float32Array }; curve: number[] };

/** How far from a lit square, in squares, the pointer still takes it: a square is a few pixels. */
const FIELD_SNAP = 4;

/** The field of 16,384 groups with the patch's 32 lit, and the 32 responses as bars; hover joins them, a click opens the group. */
function Selection({ read }: { read: Reading | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const report = useReportFacts();
  const [hovered, setHovered] = useState<number | null>(null);
  const blocks = read ? [...read.gate.blocks] : [];
  const chosen = hovered ?? HOW_PICTURE.block;
  useEffect(() => { report({ litGroup: chosen }); }, [chosen, report]);
  const open = (block: number) => navigate(`${basisGroupPath(location.pathname, location.search, block)}${location.hash}`, { state: PANEL_OPENED, preventScrollReset: true });
  const largest = read ? Math.max(...read.gate.norms) : 1;
  const rank = read ? winnerIndex(read.gate.blocks, chosen) : -1;
  const ranks = blocks.map((_, index) => fill(WORDS.rankReadout.rankValue, { rank: index + 1 }));
  const magnitudes = read ? [...read.gate.norms].map(formatValue) : [];
  return (
    <div className="how-pair how-selection">
      <figure className="how-pane">
        <div className="how-visual">
          <DictionaryField lit={blocks} chosen={chosen} className="how-field" snapToLit={FIELD_SNAP} onHover={(block) => setHovered(block !== null && blocks.includes(block) ? block : null)} onPick={(block) => blocks.includes(block) && open(block)} />
        </div>
        <figcaption className="how-caption">{fill(WORDS.fieldCaption, { patch: tokenName(PREFIX + HOW_PICTURE.patch), group: HOW_PICTURE.block })}</figcaption>
      </figure>
      <div className="how-pane how-measurements">
        <FigureReadout rows={[
          {
            value: read ? chosen : "—",
            label: WORDS.rankReadout.group,
            reserve: blocks,
          },
          {
            value: ranks[rank] ?? "—",
            label: WORDS.rankReadout.rank,
            reserve: ranks,
          },
          {
            value: magnitudes[rank] ?? "—",
            label: WORDS.rankReadout.magnitude,
            reserve: magnitudes,
          },
        ]} />
        <ol className="how-response-bars" aria-label={WORDS.barsName}>
          {blocks.map((block, at) => (
            <li key={block} data-lit={block === chosen || undefined}>
              <button type="button" aria-label={fill(WORDS.openGroup, { group: block })} onPointerEnter={() => setHovered(block)} onPointerLeave={() => setHovered(null)} onFocus={() => setHovered(block)} onBlur={() => setHovered(null)} onClick={() => open(block)}>
                <BasisGroupLinkLabel block={block} />
                <span className="how-response-bar" style={{ width: `${(100 * read!.gate.norms[at]!) / largest}%` }} />
              </button>
            </li>
          ))}
        </ol>
        <p className="how-caption">{WORDS.barsCaption}</p>
      </div>
    </div>
  );
}

/** The group's cloud with this patch lit, and samples from its strongest response level. */
function Cloud({ cloud, point }: {
  cloud: { points: AtlasCloudPoints; ring: number; wins: number; pictures: ReadonlyArray<{ imageId: number; slot: number; band: number }> } | null;
  point: { atlasPoint: readonly [number, number]; band: string } | null;
}) {
  const library = useLibrary();
  const strongest = cloud ? cloud.pictures.filter((picture) => picture.band === 3).slice(0, STRONGEST_SHOWN) : [];
  return (
    <div className="how-cloud">
      <div className="how-visual">
        <div className="how-cloud-figure">
          {cloud && point && (
            <AtlasCloudFigure
              cloud={cloud}
              lit={point.atlasPoint}
              label={<FigureReadout rows={[{
                value: <span className={`band ${point.band}`}>{BAND_NAMES[STRENGTH_BANDS.indexOf(point.band as (typeof STRENGTH_BANDS)[number])]}</span>,
                label: WORDS.cloudThis,
              }]} />}
            />
          )}
        </div>
      </div>
      <p className="how-caption">
        {cloud ? fill(WORDS.cloudCaption, { group: HOW_PICTURE.block, drawn: cloud.points.length.toLocaleString("en-US"), patches: cloud.wins.toLocaleString("en-US") }) : " "}
      </p>
      {strongest.length > 0 && (
        <figure className="how-pane how-strongest">
          <ul className="how-tiles">
            {strongest.map((picture) => {
              const cell = picture.slot - PREFIX;
              return (
                <li key={`${picture.imageId}-${picture.slot}`} className="how-tile">
                  <LibraryImage src={library.thumbnailUrl(picture.imageId)} alt="" width={64} height={64} loading="lazy" />
                  <span aria-hidden="true" style={{ left: `${((cell % 16) / 16) * 100}%`, top: `${(Math.floor(cell / 16) / 16) * 100}%` }} />
                </li>
              );
            })}
          </ul>
          <figcaption className="how-caption">{WORDS.strongestCaption}</figcaption>
        </figure>
      )}
    </div>
  );
}
type AtlasCloudPoints = ReadonlyArray<{ x: number; y: number; band: 0 | 1 | 2 | 3 }>;

/** The token's energy explained as the 32 groups are added, with a slider that adds them one at a time. */
function Rebuild({ curve }: { curve: number[] | null }) {
  const [count, setCount] = useState(WINNERS);
  const chartWidth = 576;
  const chartHeight = 224;
  const margin = { left: 40, right: 16, top: 16, bottom: 32 };
  const x = (at: number) => margin.left + (at / WINNERS) * (chartWidth - margin.left - margin.right);
  const y = (value: number) => margin.top + (1 - value) * (chartHeight - margin.top - margin.bottom);
  const path = curve ? curve.map((value, at) => `${at === 0 ? "M" : "L"}${x(at).toFixed(1)} ${y(explainedEnergy(value)).toFixed(1)}`).join(" ") : "";
  const explained = curve?.map((energy) => `${Math.round(100 * explainedEnergy(energy))}%`) ?? [];
  return (
    <div className="how-rebuild">
      <svg className="how-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={WORDS.rebuildCaption}>
        <line className="how-chart-axis" x1={margin.left} x2={chartWidth - margin.right} y1={y(0)} y2={y(0)} />
        <line className="how-chart-axis" x1={margin.left} x2={margin.left} y1={y(1)} y2={y(0)} />
        <text className="how-chart-label" x={margin.left - 8} y={y(1) + 4} textAnchor="end">1</text>
        <text className="how-chart-label" x={margin.left - 8} y={y(0) + 4} textAnchor="end">0</text>
        <text className="how-chart-label" x={x(0)} y={chartHeight - 8} textAnchor="middle">0</text>
        <text className="how-chart-label" x={x(WINNERS)} y={chartHeight - 8} textAnchor="middle">32</text>
        {curve && <path className="how-chart-line" d={path} />}
        {curve && <line className="how-chart-mark" x1={x(count)} x2={x(count)} y1={y(1)} y2={y(0)} />}
        {curve && <circle className="how-chart-dot" cx={x(count)} cy={y(explainedEnergy(curve[count]!))} r={4} />}
      </svg>
      <Slider label={WORDS.groupsAdded} value={count} min={0} max={WINNERS} valueText={fill(WORDS.groupsValue, { count })} onChange={setCount} />
      <FigureReadout rows={[
        {
          value: count,
          label: WORDS.rebuildReadout.count,
          reserve: [WINNERS],
        },
        {
          value: explained[count] ?? "—",
          label: WORDS.rebuildReadout.explained,
          reserve: explained,
        },
      ]} />
      <p className="how-caption">{WORDS.rebuildCaption}</p>
    </div>
  );
}

/** The column beside the field: the remainder chart and the pass slider. */
const PASSES_CHART_WIDTH = 320;
const PASSES_CHART_HEIGHT = 224;

/**
 * The featurizer learning, as this patch saw it: after each training pass, the 32 groups
 * the patch selected under that pass's checkpoint, and the remainder as they are added back.
 */
function Training({ record }: { record: FeaturizerPassesRecord }) {
  const passes = record.passes;
  const [shown, setShown] = useState<number | null>(null);
  const chosen = shown ?? passes.length;
  const current = passes[chosen - 1] ?? null;
  const final = passes[passes.length - 1] ?? null;
  const readings = passes.map((pass) => ({
    explained: `${Math.round(100 * explainedEnergy(pass.curve[WINNERS]!))}%`,
    kept: final ? pass.groups.filter((group) => final.groups.includes(group)).length : 0,
    loss: pass.loss.total.toFixed(3),
  }));
  const reading = readings[chosen - 1];
  const captionReserve = [fill(WORDS.passFieldCaption, {
    patch: tokenName(PREFIX + HOW_PICTURE.patch),
    pass: passes.length,
    group: HOW_PICTURE.block,
  })];
  const chartHeight = PASSES_CHART_HEIGHT;
  const margin = { left: 40, right: 16, top: 16, bottom: 32 };
  const x = (at: number) => margin.left + (at / WINNERS) * (PASSES_CHART_WIDTH - margin.left - margin.right);
  const y = (value: number) => margin.top + (1 - value) * (chartHeight - margin.top - margin.bottom);
  const path = (curve: number[]) => curve.map((value, at) => `${at === 0 ? "M" : "L"}${x(at).toFixed(1)} ${y(explainedEnergy(value)).toFixed(1)}`).join(" ");
  // The chosen pass's curve is drawn last, over the others.
  const drawn = [...passes].sort((a, b) => Number(a.pass === chosen) - Number(b.pass === chosen));
  return (
    <div className="how-pair how-training">
      <figure className="how-pane">
        <div className="how-visual">
          <DictionaryField lit={current?.groups ?? []} chosen={current && record && current.groups.includes(record.block) ? record.block : null} className="how-field" />
        </div>
        <FigureCaption reserve={captionReserve}>
          {fill(WORDS.passFieldCaption, { patch: tokenName(PREFIX + HOW_PICTURE.patch), pass: chosen, group: HOW_PICTURE.block })}
        </FigureCaption>
      </figure>
      <div className="how-pane how-measurements">
        <svg className="how-chart" viewBox={`0 0 ${PASSES_CHART_WIDTH} ${chartHeight}`} role="img" aria-label={WORDS.passesCaption}>
          <line className="how-chart-axis" x1={margin.left} x2={PASSES_CHART_WIDTH - margin.right} y1={y(0)} y2={y(0)} />
          <line className="how-chart-axis" x1={margin.left} x2={margin.left} y1={y(1)} y2={y(0)} />
          <text className="how-chart-label" x={margin.left - 8} y={y(1) + 4} textAnchor="end">1</text>
          <text className="how-chart-label" x={margin.left - 8} y={y(0) + 4} textAnchor="end">0</text>
          <text className="how-chart-label" x={x(0)} y={chartHeight - 8} textAnchor="middle">0</text>
          <text className="how-chart-label" x={x(WINNERS)} y={chartHeight - 8} textAnchor="middle">32</text>
          {drawn.map((entry) => <path key={entry.pass} className="how-chart-line" data-faint={entry.pass !== chosen || undefined} d={path(entry.curve)} />)}
          {current && <circle className="how-chart-dot" cx={x(WINNERS)} cy={y(explainedEnergy(current.curve[WINNERS]!))} r={4} />}
        </svg>
        <Slider label={WORDS.passSlider} value={chosen} min={1} max={Math.max(1, passes.length)} valueText={fill(WORDS.passValue, { pass: chosen, total: passes.length })} onChange={setShown} />
        <FigureReadout rows={[
          {
            value: chosen,
            label: WORDS.passReadout.pass,
            reserve: passes.map((pass) => pass.pass),
          },
          {
            value: reading?.explained ?? "—",
            label: WORDS.passReadout.explained,
            reserve: readings.map((entry) => entry.explained),
          },
          {
            value: reading?.kept ?? "—",
            label: WORDS.passReadout.kept,
            reserve: readings.map((entry) => entry.kept),
          },
          {
            value: reading?.loss ?? "—",
            label: WORDS.passReadout.loss,
            reserve: readings.map((entry) => entry.loss),
          },
        ]} />
        <p className="how-caption">{WORDS.passesCaption}</p>
      </div>
    </div>
  );
}
