import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { fill, SITE_WORDS } from "../app/site-words";
import type { MaterialEntry } from "../features/gallery/material-index";
import { fetchPublishedMaterial, materialFileUrl } from "../features/gallery/material-gallery";
import { figurePlayback, PICTURE_SIDES, strengthStatistic, type FigureMaterial } from "../materials/material-file";
import { kindLine } from "../features/playground/playground";
import { MaterialMetadata, metadataRows } from "./material-metadata";
import { kindWords } from "../features/home/home-material";
import { BAND_NAMES, STRENGTH_BANDS } from "../features/look/strength-bands";
import { downloadBlob } from "../ui/files";
import { MaterialFrame } from "../ui/material-frame";
import { Select } from "../ui/select";
import { Slider } from "../ui/slider";
import { SAMPLE_EVERY_TICKS, sampledAccent } from "../ui/sampled-accent";
import { createFigureReplay } from "./figure-replay";
import { FIGURE_SHADERS } from "./figure-shaders";
import { KeepMaterial, KeepWord } from "./keep-material";
import { MaterialExports } from "./material-exports";
import { continueTrainingPath, growVariationPath } from "./published-material";
import { REPLAY_DEFAULT_SPEED, REPLAY_SPEEDS, speedLabel } from "./replay-loop";
import { openStageSession, type StageSession } from "./stage-session";
import { checkVideoPlan, recordReplayVideo, videoFileName } from "./replay-video";
import { DownloadIcon, OptionsIcon, PauseIcon, PlayIcon } from "./stage-icons";
import { ResetMark } from "../ui/reset-mark";
import { useMediaMatch } from "../ui/media-match";
import "./material-stage.css";
import { pagePointer } from "../ui/page-scale";

/** The speed slider's steps are REPLAY_SPEEDS (¼x to 8x); a material starts at the players' default. */
const NORMAL_SPEED = REPLAY_SPEEDS.indexOf(REPLAY_DEFAULT_SPEED);
/**
 * Desktop zooms use whole CSS pixels per picture pixel. The stage takes the largest zoom that
 * fits its column. On a phone, the Automata canvas fills the column so the drawing area stays
 * large enough to use. Neither display size changes the simulation grid or the backing canvas.
 */
export const ZOOMS = [1, 2, 3, 4, 5, 6, 7, 8];
/**
 * Brush sizes are radii in steps of 4 CSS pixels, a cell of a 128-cell grid at 4 px per cell; the
 * brush keeps its size on screen when the grid or the zoom changes. Its ring is a cursor only: every
 * visible change on the canvas is the cells themselves.
 */
const BRUSH = { min: 2, max: 32, start: 12, step: 1 };
const BRUSH_STEP_PX = 4;
/** The speed slider's ticks: one at each speed. The brush slider's: every 8 cells of radius. */
const SPEED_TICKS = REPLAY_SPEEDS.map((_, index) => index);
const BRUSH_TICKS = [8, 16, 24, 32];
/** The wheel's travel, in deltaY, for one brush step: about one notch of a mouse wheel. */
const WHEEL_STEP_DELTA = 80;
const CANVAS_PIXELS = 512;
/** Cells along a patch's side: the frame's ticks fall every 16 cells. */
const CELLS_PER_PATCH = 16;
/** Video defaults: 10 seconds from tick 0 at 30 frames a second, one tick per frame. */
const VIDEO = { fromTick: 0, seconds: 10, fps: 30, ticksPerFrame: 1 };
const WORDS = SITE_WORDS.stage;
/** The instrument's words (the Playground's): its readouts, quiet words and button. */
const INSTRUMENT_WORDS = SITE_WORDS.playground;
/** The instrument's tick counter: "1,240", written straight into its element on every frame. */
const TICKS = new Intl.NumberFormat("en-US");

/**
 * The zoom the stage shows: the largest that fits the cells' room, at least 1. `room` is the width
 * the cells can take, in page pixels. On a page scaled to 1.25 (ui/page-scale.ts) zoom 4 and 8 give
 * whole screen pixels per picture pixel and the others a quarter more or less; the stage keeps the
 * largest fitting zoom all the same, since a whole-pixel one would halve it.
 */
export function stageZoom(pictureSide: number, room: number): number {
  const fitting = ZOOMS.filter((zoom) => pictureSide * zoom <= room);
  return fitting.length > 0 ? fitting[fitting.length - 1]! : ZOOMS[0];
}

/** The brush radius after `notches` wheel steps over the stage (positive: larger), by the Brush slider's step, held to its ends. */
export function brushAfterWheel(brush: number, notches: number): number {
  return Math.min(BRUSH.max, Math.max(BRUSH.min, brush + notches * BRUSH.step));
}

/** "12002 · strongest, mean · seed 1" → "strongest, mean · seed 1": the block is said once. An automaton without a title is named by its kind. */
export function variationName(entry: MaterialEntry): string {
  const prefix = `${entry.block} · `;
  if (entry.title === "") return kindLine(entry);
  return entry.title.startsWith(prefix) ? entry.title.slice(prefix.length) : entry.title;
}

/** The stored value's words on the quiet line, by what the rule's settings say it holds. */
const READING_STRENGTH_WORDS = {
  "projection-on-target": WORDS.readingStrength,
  "projection-on-main-direction": WORDS.readingMainDirection,
  "median-magnitude": WORDS.readingMedian,
  unknown: WORDS.readingRecorded,
} as const;

/**
 * One quiet line: the reference patch the automaton was trained toward, then what it reached. The
 * response level names that one patch only; the stored value is a projection or a median over the
 * grid's measured patches in units of the median selected response magnitude m, and the levels are
 * cut on single patches, so an automaton that met the selection target can read Level 1 on them.
 * The measurement is the stored value in m under its name, the selection fraction and whether the
 * selection target was met.
 */
export function readingLine(entry: MaterialEntry): string {
  return [fill(WORDS.readingBlock, { block: entry.block }), recipeWord(entry.recipe), ...readingParts(entry)].join(" · ");
}

/** The quiet line's measurement: the reference patch's level, the stored value, the selection fraction, the target. */
function readingParts(entry: MaterialEntry): string[] {
  const band = BAND_NAMES[STRENGTH_BANDS.indexOf(entry.band)];
  const parts = [fill(WORDS.readingToward, { band })];
  const strengthWords = READING_STRENGTH_WORDS[strengthStatistic(entry.experiment, entry.measurementDirection)];
  if (entry.strength !== null) parts.push(fill(strengthWords, { strength: entry.strength.toFixed(2) }));
  if (entry.winnerFraction !== null) {
    const wins = entry.region === "centre-4x4" ? WORDS.readingCentreWins : WORDS.readingWins;
    parts.push(fill(wins, { percent: Math.round(entry.winnerFraction * 100) }));
  }
  parts.push(entry.fired ? WORDS.fired : WORDS.didNotFire);
  return parts;
}

/** The recipe as the stage names it: its name without the date, "figure-seeded-2026-10-23" -> "figure-seeded". */
export function recipeWord(recipe: string): string {
  return recipe.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

/** Where the stage gets a material's file and poster, and whether Keep applies: the published library unless a page supplies another source. */
export interface MaterialSource {
  load: (entry: MaterialEntry) => Promise<FigureMaterial>;
  poster: (entry: MaterialEntry) => string;
  keepable: (entry: MaterialEntry) => boolean;
}
export const PUBLISHED_SOURCE: MaterialSource = {
  load: fetchPublishedMaterial,
  poster: (entry) => materialFileUrl(entry, "poster.png"),
  keepable: () => true,
};

/**
 * "page" puts the variation's name and reading above the frame, with other materials beside it.
 * "instrument" is Automata's stage: playback controls, step, actions and option panels below
 * the frame. The page supplies the basis group heading.
 */
export type StageLayout = "page" | "instrument";

/**
 * A block's published materials on one stage: the selected material grows large, the canvas is
 * the brush, and the block's other materials wait beside it as thumbnails. Given one material (the
 * owner's view), the stage has no thumbnails. The Playground's Yours group plays the visitor's own
 * kept materials through its own `source`.
 */
export function MaterialStage({ entries, source = PUBLISHED_SOURCE, layout = "page", ownerActions, notice, gridNote }: {
  entries: MaterialEntry[];
  source?: MaterialSource;
  layout?: StageLayout;
  /** The lower frame label for the selected grid size, in cells per side. */
  gridNote?: (side: number) => ReactNode;
  /** The instrument's owner actions (the owner mode, features/owner/): a block in the readouts column, over Export and Options. */
  ownerActions?: ReactNode;
  /** The page's line under the bar (the owner mode's result of an action), on its own line beside the stage's message; null for none yet. */
  notice?: string | null;
}) {
  const fillsMobileStage = useMediaMatch("(max-width: 640px)") && layout === "instrument";
  const [selectedId, setSelectedId] = useState(entries[0]?.id);
  const entry = entries.find((candidate) => candidate.id === selectedId) ?? entries[0];
  const [material, setMaterial] = useState<FigureMaterial | null>(null);
  // A token method's layers, from the loaded file when it is this entry's: "Train a variation" keeps its depth.
  const loadedLayers = material && entry && material.file.id === entry.materialId ? material.file.recipe.settings.layers : undefined;
  // The grid is chosen by its picture width, so a 2 px material shows at the size of the others.
  const [pictureSide, setPictureSide] = useState<128 | 256>(128);
  const pixelsPerCell = material ? figurePlayback(material.file).pixelsPerCell : 1;
  const side = pictureSide / pixelsPerCell;
  const [seed, setSeed] = useState(entry?.seed ?? 1);
  const [seedText, setSeedText] = useState(String(entry?.seed ?? 1));
  // A material plays as soon as it is chosen, from its start; with reduced motion it waits for Play.
  const startPlaying = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [playing, setPlaying] = useState(startPlaying);
  const [speed, setSpeed] = useState(NORMAL_SPEED);
  // The largest zoom that fits; the room is measured from the frame's column.
  const [room, setRoom] = useState(0);
  const zoom = stageZoom(pictureSide, room);
  const [brush, setBrush] = useState(BRUSH.start);
  const hovering = useRef(false);
  const [panel, setPanel] = useState<"none" | "downloads" | "options">("none");
  const [videoOpen, setVideoOpen] = useState(false);
  const [video, setVideo] = useState(VIDEO);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState("");
  const [replayStatus, setReplayStatus] = useState<"opening" | "ready" | "failed">("opening");
  // The brush ring's place in the canvas window; its size follows the brush and the zoom.
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const fitBox = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<StageSession | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const stageElement = useRef<HTMLElement>(null);
  const tickOutput = useRef<HTMLOutputElement>(null);
  const live = useRef({ playing, speed, recording });
  live.current = { playing, speed, recording };

  // The selected material's file, then a fresh replay from its reading's seed.
  useEffect(() => {
    if (!entry) return;
    let current = true;
    setMaterial(null);
    setMessage("");
    setReplayStatus("opening");
    setRecording(false);
    setSeed(entry.seed);
    setSeedText(String(entry.seed));
    source.load(entry).then((loaded) => { if (current) setMaterial(loaded); })
      .catch((error: unknown) => { if (current) { setMessage(String(error)); setReplayStatus("failed"); setPlaying(false); } });
    return () => { current = false; };
  }, [entry?.id, entry?.tick, entry?.fileRevision, source]);

  useEffect(() => {
    if (!material || !canvas.current) return;
    const target = canvas.current;
    // The stage's one coloured line (--sampled) is the material's mean colour, read back from the
    // replay every SAMPLE_EVERY_TICKS ticks while the loop holds still (a recording owns the replay
    // meanwhile, so it waits); a new material or a reset reads at its first frame.
    let sampledAt = -1;
    const onFrame = (tick: number) => {
      if (sampledAt === -1) setReplayStatus("ready");
      if (tickOutput.current) tickOutput.current.textContent = TICKS.format(tick);
      const due = Math.floor(tick / SAMPLE_EVERY_TICKS);
      const { replay, loop } = session;
      if (due === sampledAt || live.current.recording || !replay || !loop) return;
      sampledAt = due;
      loop.hold(() => replay.readPixels()).then(
        (pixels_N4) => {
          if (runtime.current === session) stageElement.current?.style.setProperty("--sampled", sampledAccent(pixels_N4, replay.pictureSide));
        },
        () => {},
      );
    };
    const session = openStageSession(
      (signal) => createFigureReplay(
        { canvas: target, side, seed, scale: CANVAS_PIXELS / side, ...figurePlayback(material.file), onDeviceLost: (message) => { setMessage(message); setReplayStatus("failed"); setPlaying(false); }, signal },
        { values: material.values, fireRate: material.file.rule.fireRate }, FIGURE_SHADERS,
      ),
      {
        speed: REPLAY_SPEEDS[live.current.speed], playing: live.current.playing, onFrame,
        onError: (error) => { setMessage(String(error)); setReplayStatus("failed"); setPlaying(false); },
      },
    );
    runtime.current = session;
    setMessage("");
    setReplayStatus("opening");
    return () => {
      session.close();
      if (runtime.current === session) runtime.current = null;
    };
  }, [material, side]);

  // [ and ] change the brush while the pointer is over the material or the stage has focus.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]") return;
      const inside = hovering.current || stageElement.current?.contains(document.activeElement);
      if (!inside || (event.target instanceof HTMLInputElement && event.target.type !== "range")) return;
      setBrush((current) => Math.min(BRUSH.max, Math.max(BRUSH.min, current + (event.key === "]" ? 2 : -2))));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // The cells' room: the frame's column less the frame's own room, measured whenever it changes.
  const hasEntry = entry !== undefined;
  useLayoutEffect(() => {
    const element = fitBox.current;
    if (!element) return;
    const measure = () => {
      const frame = element.querySelector<HTMLElement>(".frame");
      if (!frame) return;
      const style = getComputedStyle(frame);
      setRoom(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasEntry]);

  // The wheel over the stage sets the brush (up: larger), not the stage's size; the ring follows.
  useEffect(() => {
    const element = view.current;
    if (!element) return;
    let travelled = 0;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      travelled += event.deltaY;
      if (Math.abs(travelled) < WHEEL_STEP_DELTA) return;
      const notches = travelled < 0 ? 1 : -1;
      travelled = 0;
      setBrush((current) => brushAfterWheel(current, notches));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [entry?.id]);

  if (!entry) return null;
  const loop = () => runtime.current?.loop ?? undefined;
  const togglePlay = () => {
    const next = !playing;
    runtime.current?.setPlaying(next);
    setPlaying(next);
  };
  // Reset: back to tick 0 of the current seed, the material's start.
  const reset = (from = seed) => {
    try {
      if (!Number.isInteger(from) || from < 0 || from > 0xffffffff) throw new Error("Seed must be an unsigned 32-bit integer.");
      runtime.current?.reseed(from);
      setSeed(from);
      setMessage("");
    } catch (error) { setMessage(String(error)); }
  };
  const chooseSpeed = (index: number) => { setSpeed(index); runtime.current?.setSpeed(REPLAY_SPEEDS[index]); };

  // The canvas is the brush: a drag stamps soft discs along its path; holding still stamps nothing.
  const cellAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width * side, y: (event.clientY - box.top) / box.height * side };
  };
  // Phone interaction uses the available width; the simulation grid and backing canvas do not change.
  const canvasSize = fillsMobileStage && room > 0 ? Math.floor(room) : pictureSide * zoom;
  const brushCells = (brush * BRUSH_STEP_PX) / (canvasSize / side);
  const ringSize = 2 * brush * BRUSH_STEP_PX;
  const moveBrush = (event: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = cellAt(event);
    setRing(pagePointer(event, event.currentTarget.parentElement!));
    if (event.buttons === 0 || recording || !last.current) return;
    loop()?.stroke(last.current.x, last.current.y, x, y, brushCells);
    last.current = { x, y };
  };

  const record = async () => {
    const current = runtime.current;
    if (!current?.replay || !current.loop) return;
    const { replay, loop: frames } = current;
    const plan = { seed, fromTick: video.fromTick, toTick: video.fromTick + video.seconds * video.fps * video.ticksPerFrame, ticksPerFrame: video.ticksPerFrame, fps: video.fps };
    try { checkVideoPlan(plan); } catch (error) { setMessage(String(error)); return; }
    setRecording(true);
    setPanel("none");
    setMessage(fill(WORDS.recording, { seconds: video.seconds }));
    try {
      const result = await frames.hold(() => recordReplayVideo(replay, plan));
      downloadBlob(result.blob, videoFileName(entry.block, plan, result.extension));
      if (runtime.current === current) setMessage("");
    } catch (error) { if (runtime.current === current) setMessage(String(error)); } finally { if (runtime.current === current) setRecording(false); }
  };

  const instrument = layout === "instrument";
  const togglePanel = (next: "downloads" | "options") => setPanel(panel === next ? "none" : next);
  // A title of the person's own; a title copied from the file's name is the research run's, not shown.
  const ownTitle = material !== null && entry.title !== "" && entry.title !== material.file.name ? entry.title : "";
  const controls = <div className="stage-controls" role="toolbar" aria-label={WORDS.controls}>
    <button type="button" className="stage-icon" onClick={togglePlay} disabled={recording || replayStatus === "failed"} aria-label={playing ? WORDS.pause : WORDS.play}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
    <button type="button" className="stage-icon stage-reset reset-control" onClick={() => reset()} disabled={recording || replayStatus === "failed"} aria-label={WORDS.resetName} title={WORDS.resetName}><ResetMark /></button>
    <Slider label={WORDS.speed} value={speed} min={0} max={REPLAY_SPEEDS.length - 1} ticks={SPEED_TICKS}
      valueText={speedLabel(REPLAY_SPEEDS[speed])} disabled={recording || replayStatus === "failed"} onChange={chooseSpeed} />
    <Slider label={WORDS.brush} value={brush} min={BRUSH.min} max={BRUSH.max} ticks={BRUSH_TICKS}
      valueText={String(brush)} keyShortcuts="[ ]" onChange={setBrush} />
    {/* The instrument opens its panels from the readouts' quiet words. The stage's size follows the window: no zoom control. */}
    {!instrument && <>
      <span className="stage-zoom">
        <output aria-label={WORDS.pixelsPerCellName}>{fill(WORDS.pixelsPerCell, { pixels: canvasSize / side })}</output>
      </span>
      <span className="stage-menus">
        <button type="button" className="stage-icon" aria-expanded={panel === "downloads"} aria-label={WORDS.downloads} onClick={() => togglePanel("downloads")}><DownloadIcon /></button>
        <button type="button" className="stage-icon" aria-expanded={panel === "options"} aria-label={WORDS.options} onClick={() => togglePanel("options")}><OptionsIcon /></button>
      </span>
    </>}
  </div>;

  const panels = <>
    {panel === "downloads" && material && <div className="stage-panel" role="group" aria-label={WORDS.downloads}>
      {!instrument && source.keepable(entry) && <KeepMaterial key={entry.id} material={material} entryId={entry.id} />}
      <MaterialExports material={material} onError={setMessage} />
      <button type="button" className="button" onClick={() => void record()} disabled={recording || replayStatus === "failed"}>{fill(WORDS.video, { seconds: video.seconds })}</button>
      <button type="button" className="link-control" aria-expanded={videoOpen} onClick={() => setVideoOpen(!videoOpen)}>{WORDS.videoSettings}</button>
      {videoOpen && <div className="stage-fields">
        <label>{WORDS.fromTick}<input type="number" min={0} step={1} value={video.fromTick} onChange={(event) => setVideo({ ...video, fromTick: Number(event.target.value) })} /></label>
        <label>{WORDS.seconds}<input type="number" min={1} max={120} step={1} value={video.seconds} onChange={(event) => setVideo({ ...video, seconds: Number(event.target.value) })} /></label>
        <label>{WORDS.framesPerSecond}<input type="number" min={1} max={60} step={1} value={video.fps} onChange={(event) => setVideo({ ...video, fps: Number(event.target.value) })} /></label>
        <label>{WORDS.ticksPerFrame}<input type="number" min={1} max={8} step={1} value={video.ticksPerFrame} onChange={(event) => setVideo({ ...video, ticksPerFrame: Number(event.target.value) })} /></label>
      </div>}
    </div>}
    {panel === "options" && <div className="stage-panel" role="group" aria-label={WORDS.options}>
      <div className="stage-fields">
        <label>{WORDS.seed}<input type="number" min={0} max={4294967295} step={1} value={seedText} onChange={(event) => setSeedText(event.target.value)} /></label>
        <button type="button" className="button" disabled={recording || replayStatus === "failed"} onClick={() => reset(Number(seedText))}>{WORDS.growFromSeed}</button>
        <label>{WORDS.grid}<Select value={pictureSide} onChange={(event) => setPictureSide(Number(event.target.value) as 128 | 256)}>
          {PICTURE_SIDES.map((pixels) => <option key={pixels} value={pixels}>{fill(WORDS.gridOption, { cells: pixels / pixelsPerCell })}</option>)}</Select></label>
      </div>
      {/* The automaton's metadata (material-metadata.tsx), read here on request, never on the stage or a tile. */}
      {material && <MaterialMetadata rows={metadataRows(entry, material.file.training.updates, ownTitle)} />}
    </div>}
  </>;

  const thumbnails = <ul className="stage-thumbnails" aria-label={WORDS.thumbnails}>
    {entries.map((candidate) => <li key={candidate.id}>
      <button type="button" aria-pressed={candidate.id === entry.id} data-fired={candidate.fired || undefined}
        onClick={() => { if (candidate.id !== entry.id) { setSelectedId(candidate.id); setPlaying(startPlaying()); } }}>
        <img src={source.poster(candidate)} width={candidate.side} height={candidate.side} alt="" loading="lazy" />
        <span>{variationName(candidate)}</span>
      </button>
    </li>)}
  </ul>;

  // The material in its frame, in a box as wide as the frame's column: the box is what the zoom fits.
  // The instrument's page names the block over the frame, so its corner does not.
  const framed = <div className="stage-fit" ref={fitBox}>
    <MaterialFrame patches={side / CELLS_PER_PATCH}
      label={instrument ? undefined : fill(WORDS.frameLabel, { block: entry.block, kind: kindWords(entry) })}
      note={gridNote?.(side) ?? fill(WORDS.frameGrid, { side })}>
      <div className="stage-canvas"
        onPointerEnter={() => { hovering.current = true; }} onPointerLeave={() => { hovering.current = false; setRing(null); }}
        ref={view}>
        <canvas ref={canvas} width={CANVAS_PIXELS} height={CANVAS_PIXELS} style={{ width: canvasSize, height: canvasSize, visibility: replayStatus === "ready" ? "visible" : "hidden" }}
          aria-label={fill(WORDS.canvasName, { title: entry.title })}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const { x, y } = cellAt(event); last.current = { x, y }; }}
          onPointerMove={moveBrush} onPointerUp={() => { last.current = null; }} onPointerCancel={() => { last.current = null; }} />
        {replayStatus !== "ready" && <img className="stage-poster" src={source.poster(entry)} alt={entry.title} />}
        {replayStatus === "ready" && ring && <span className="stage-ring" style={{ left: ring.x, top: ring.y, width: ringSize, height: ringSize }} aria-hidden="true" />}
        {replayStatus === "opening" && <span className="stage-loading">{fill(WORDS.loading, { name: variationName(entry) })}</span>}
      </div>
    </MaterialFrame>
  </div>;

  if (instrument) {
    return <section ref={stageElement} className="material-stage" data-layout="instrument" aria-label={entry.title}>
      <div className="stage-instrument">
        {framed}
        <aside className="stage-readouts" aria-label={INSTRUMENT_WORDS.readoutsName}>
          {/* A panel opens below the frame; the step stays in its line. */}
          <dl>
            <dt className="label">{INSTRUMENT_WORDS.tick}</dt><dd><output ref={tickOutput}>0</output></dd>
          </dl>
          {panels}
          {ownerActions && <div className="stage-owner">{ownerActions}</div>}
          <div className="stage-actions">
            <p className="stage-words">
              {material && source.keepable(entry) && <><KeepWord key={entry.id} material={material} entryId={entry.id} className="stage-word" /><span aria-hidden="true">·</span></>}
              <button type="button" className="stage-word" aria-expanded={panel === "downloads"} onClick={() => togglePanel("downloads")}>{INSTRUMENT_WORDS.export}</button>
              <span aria-hidden="true">·</span>
              <button type="button" className="stage-word" aria-expanded={panel === "options"} onClick={() => togglePanel("options")}>{INSTRUMENT_WORDS.options}</button>
            </p>
            <Link className="button" to={growVariationPath(entry, loadedLayers)}>{INSTRUMENT_WORDS.growVariation}</Link>
          </div>
        </aside>
        {controls}
        {message && <p className="stage-message" role="status">{message}</p>}
        {/* Kept in place while the page gives a notice at all, so a result appearing moves nothing. */}
        {notice !== undefined && <p className="stage-message stage-notice" role="status">{notice}</p>}
      </div>
    </section>;
  }

  return <section ref={stageElement} className="material-stage" aria-label={WORDS.name}>
    <header className="stage-head">
      <h2>{variationName(entry)}</h2>
      <p>{readingLine(entry)} · {fill(WORDS.by, { credit: entry.credit || WORDS.anonymous })} · <Link to={growVariationPath(entry, loadedLayers)}>{WORDS.growAnother}</Link>
        {" · "}<Link to={continueTrainingPath(entry)}>{WORDS.continueTraining}</Link></p>
    </header>
    <div className="stage-body" data-single={entries.length === 1 || undefined}>
      <div className="stage-view">
        {framed}
        {controls}
        {panels}
        {message && <p className="stage-message" role="status">{message}</p>}
      </div>
      {entries.length > 1 && thumbnails}
    </div>
  </section>;
}
