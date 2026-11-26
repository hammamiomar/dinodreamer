import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { fill, SITE_WORDS } from "../app/site-words";
import type { MaterialEntry } from "../features/gallery/material-index";
import { fetchPublishedMaterial, materialFileUrl } from "../features/gallery/material-gallery";
import { figurePlayback, PICTURE_SIDES, strengthStatistic, type FigureMaterial } from "../materials/material-file";
import { kindLine, tileName } from "../features/automata/kind-line";
import { useManifoldFocus } from "../ground/manifold-focus";
import { MakerCard } from "./maker-card";
import { MaterialMetadata, metadataRows } from "./material-metadata";
import { BAND_NAMES, STRENGTH_BANDS } from "../features/look/strength-bands";
import { downloadBlob } from "../ui/files";
import { MaterialFrame } from "../ui/material-frame";
import { Select } from "../ui/select";
import { Slider } from "../ui/slider";
import { SAMPLE_EVERY_TICKS, sampledAccent } from "../ui/sampled-accent";
import { createFigureReplay } from "./figure-replay";
import { FIGURE_SHADERS } from "./figure-shaders";
import { KeepWord } from "./keep-material";
import { MaterialExports } from "./material-exports";
import { growVariationPath } from "./published-material";
import { REPLAY_DEFAULT_SPEED, REPLAY_SPEEDS, speedLabel } from "./replay-loop";
import { openStageSession, type StageSession } from "./stage-session";
import { checkVideoPlan, recordReplayVideo, videoFileName } from "./replay-video";
import { PauseIcon, PlayIcon } from "./stage-icons";
import { makerLine, ownTitle } from "./material-facts";
import { PublishPanel, PublishWord } from "../features/gallery/publish-material";
import { ResetMark } from "../ui/reset-mark";
import { useMediaMatch } from "../ui/media-match";
import { assertUnsigned32 } from "../decode";
import { BRUSH, brushAfterWheel, recipeWord, stageZoom, variationNameFor, ZOOMS } from "./material-stage-view";
import "./material-stage.css";
import { pagePointer } from "../ui/page-scale";

export { brushAfterWheel, recipeWord, stageZoom, ZOOMS };

/** The speed slider's steps are REPLAY_SPEEDS (¼x to 8x); a material starts at the players' default. */
const NORMAL_SPEED = REPLAY_SPEEDS.indexOf(REPLAY_DEFAULT_SPEED);
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

/** "12002 · strongest, mean · seed 1" → "strongest, mean · seed 1": the block is said once. An automaton without a title is named by its kind. */
export function variationName(entry: MaterialEntry): string {
  return variationNameFor(entry, kindLine);
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

/** The panel open under the quiet words: none, or the one the visitor asked for. */
type StagePanel = "none" | "publish" | "video" | "export" | "options";
/** The address's fragment that opens the Export panel from Home. */
export const EXPORT_FRAGMENT = "#export";

/**
 * One automaton on Automata's stage: the cells large in their frame, which is the brush, with the
 * maker's title and name in its corner; the playback bar under it; then the step, the quiet words
 * (Save or Publish, Video, Export, Options), each with its panel, and "Train a variation". The page
 * supplies the basis group heading. Saved automata play the visitor's own through their own
 * `source`, and offer Publish (`publishable`).
 */
export function MaterialStage({ entry, source = PUBLISHED_SOURCE, publishable = false, ownerActions, notice, gridNote }: {
  entry: MaterialEntry;
  source?: MaterialSource;
  /** The automaton is the visitor's own, saved on this device: the quiet words offer Publish. */
  publishable?: boolean;
  /** The lower frame label for the selected grid size, in cells per side. */
  gridNote?: (side: number) => ReactNode;
  /** The owner's actions (the owner mode, features/owner/): a block in the readouts column, over the quiet words. */
  ownerActions?: ReactNode;
  /** The page's line under the bar (the owner mode's result of an action), on its own line beside the stage's message; null for none yet. */
  notice?: string | null;
}) {
  const fillsMobileStage = useMediaMatch("(max-width: 640px)");
  const [material, setMaterial] = useState<FigureMaterial | null>(null);
  const [sampled, setSampled] = useState<string | null>(null);
  useManifoldFocus(entry.block, sampled);
  // A token method's layers, from the loaded file when it is this entry's: "Train a variation" keeps its depth.
  const loadedLayers = material && material.file.id === entry.materialId ? material.file.recipe.settings.layers : undefined;
  // The grid is chosen by its picture width, so a 2 px material shows at the size of the others.
  const [pictureSide, setPictureSide] = useState<128 | 256>(128);
  const pixelsPerCell = material ? figurePlayback(material.file).pixelsPerCell : 1;
  const side = pictureSide / pixelsPerCell;
  const [seed, setSeed] = useState(entry.seed);
  const [seedText, setSeedText] = useState(String(entry.seed));
  // A material plays as soon as it is chosen, from its start.
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(NORMAL_SPEED);
  // The largest zoom that fits; the room is measured from the frame's column.
  const [room, setRoom] = useState(0);
  const zoom = stageZoom(pictureSide, room);
  const [brush, setBrush] = useState(BRUSH.start);
  const hovering = useRef(false);
  const [panel, setPanel] = useState<StagePanel>(useLocation().hash === EXPORT_FRAGMENT ? "export" : "none");
  const [video, setVideo] = useState(VIDEO);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState("");
  const [replayStatus, setReplayStatus] = useState<"opening" | "ready" | "failed">("opening");
  // The brush ring element is positioned directly through a ref on pointermove to avoid 60–120 Hz React re-renders.
  const ringElement = useRef<HTMLSpanElement>(null);
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
    let current = true;
    setMaterial(null);
    setSampled(null);
    setMessage("");
    setReplayStatus("opening");
    setRecording(false);
    setSeed(entry.seed);
    setSeedText(String(entry.seed));
    source.load(entry).then((loaded) => { if (current) setMaterial(loaded); })
      .catch((error: unknown) => { if (current) { setMessage(String(error)); setReplayStatus("failed"); setPlaying(false); } });
    return () => { current = false; };
  }, [entry.id, entry.tick, entry.fileRevision, source]);

  useEffect(() => {
    if (!material || !canvas.current) return;
    const target = canvas.current;
    // The stage's one coloured line (--sampled) is the material's mean colour, read back from the
    // replay every SAMPLE_EVERY_TICKS ticks while the loop holds still (a recording owns the replay
    // meanwhile, so it waits); a new material or a reset reads at its first frame.
    let sampledAt = -1;
    let framed = false;
    const onFrame = (tick: number) => {
      if (!framed) {
        framed = true;
        setReplayStatus("ready");
      }
      if (tickOutput.current) tickOutput.current.textContent = TICKS.format(tick);
      const due = Math.floor(tick / SAMPLE_EVERY_TICKS);
      const { replay, loop } = session;
      if (due === sampledAt || live.current.recording || !replay || !loop) return;
      sampledAt = due;
      loop.hold(() => replay.readPixels()).then(
        (pixels_N4) => {
          if (runtime.current === session) {
            const accent = sampledAccent(pixels_N4, replay.pictureSide);
            stageElement.current?.style.setProperty("--sampled", accent);
            setSampled(accent);
          }
        },
        () => {},
      );
    };
    // A replay that fails before its first frame did not start in this browser: plain words, and the
    // saved image stays. A failure after that is the replay's own, said as it is.
    const fail = (error: unknown) => {
      if (!framed) console.warn("The replay did not start:", error);
      setMessage(framed ? String(error) : WORDS.noReplay);
      setReplayStatus("failed");
      setPlaying(false);
    };
    const session = openStageSession(
      (signal) => createFigureReplay(
        { canvas: target, side, seed, scale: CANVAS_PIXELS / side, ...figurePlayback(material.file), onDeviceLost: fail, signal },
        { values: material.values, fireRate: material.file.rule.fireRate }, FIGURE_SHADERS,
      ),
      { speed: REPLAY_SPEEDS[live.current.speed], playing: live.current.playing, onFrame, onError: fail },
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
  }, []);

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
  }, [entry.id]);

  const loop = () => runtime.current?.loop ?? undefined;
  const togglePlay = () => {
    const next = !playing;
    runtime.current?.setPlaying(next);
    setPlaying(next);
  };
  // Reset: back to tick 0 of the current seed, the material's start.
  const reset = (from = seed) => {
    try {
      assertUnsigned32(from, "Seed");
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
  const hideRing = () => {
    const ring = ringElement.current;
    if (ring) ring.dataset.visible = "false";
  };
  const moveBrush = (event: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = cellAt(event);
    const ring = ringElement.current;
    if (ring) {
      const pointer = pagePointer(event, event.currentTarget.parentElement!);
      ring.style.left = `${pointer.x}px`;
      ring.style.top = `${pointer.y}px`;
      ring.dataset.visible = "true";
    }
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

  const togglePanel = (next: StagePanel) => setPanel(panel === next ? "none" : next);
  const maker = { title: entry.title, credit: entry.credit };
  // A title is the maker's when it differs from the definition's own name, so the line waits for the file.
  const madeBy = material ? makerLine(maker, material.file) : "";
  const stopped = recording || replayStatus === "failed";
  const controls = <div className="stage-controls" role="toolbar" aria-label={WORDS.controls}>
    <button type="button" className="stage-icon" onClick={togglePlay} disabled={stopped} aria-label={playing ? WORDS.pause : WORDS.play}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
    <button type="button" className="stage-icon stage-reset reset-control" onClick={() => reset()} disabled={stopped} aria-label={WORDS.resetName} title={WORDS.resetName}><ResetMark /></button>
    <Slider label={WORDS.speed} value={speed} min={0} max={REPLAY_SPEEDS.length - 1} ticks={SPEED_TICKS}
      valueText={speedLabel(REPLAY_SPEEDS[speed])} disabled={stopped} onChange={chooseSpeed} />
    <Slider label={WORDS.brush} value={brush} min={BRUSH.min} max={BRUSH.max} ticks={BRUSH_TICKS}
      valueText={String(brush)} keyShortcuts="[ ]" onChange={setBrush} />
  </div>;

  const panels = <>
    {panel === "publish" && material && <div className="stage-panel" role="group" aria-label={SITE_WORDS.publish.word}>
      <PublishPanel key={material.file.id} file={material.file} onClose={() => setPanel("none")} />
    </div>}
    {panel === "video" && <div className="stage-panel" role="group" aria-label={WORDS.video}>
      <div className="stage-fields">
        <label>{WORDS.fromTick}<input type="number" min={0} step={1} value={video.fromTick} onChange={(event) => setVideo({ ...video, fromTick: Number(event.target.value) })} /></label>
        <label>{WORDS.seconds}<input type="number" min={1} max={120} step={1} value={video.seconds} onChange={(event) => setVideo({ ...video, seconds: Number(event.target.value) })} /></label>
        <label>{WORDS.framesPerSecond}<input type="number" min={1} max={60} step={1} value={video.fps} onChange={(event) => setVideo({ ...video, fps: Number(event.target.value) })} /></label>
        <label>{WORDS.ticksPerFrame}<input type="number" min={1} max={8} step={1} value={video.ticksPerFrame} onChange={(event) => setVideo({ ...video, ticksPerFrame: Number(event.target.value) })} /></label>
      </div>
      <button type="button" className="button" onClick={() => void record()} disabled={stopped}>{fill(WORDS.record, { seconds: video.seconds })}</button>
    </div>}
    {panel === "export" && material && <div className="stage-panel" role="group" aria-label={INSTRUMENT_WORDS.export}>
      <MaterialExports material={material} maker={maker} onError={setMessage} />
    </div>}
    {panel === "options" && <div className="stage-panel" role="group" aria-label={WORDS.options}>
      <div className="stage-fields">
        <label>{WORDS.seed}<input type="number" min={0} max={4294967295} step={1} value={seedText} onChange={(event) => setSeedText(event.target.value)} /></label>
        <button type="button" className="button" disabled={stopped} onClick={() => reset(Number(seedText))}>{WORDS.growFromSeed}</button>
        <label>{WORDS.grid}<Select value={pictureSide} onChange={(event) => setPictureSide(Number(event.target.value) as 128 | 256)}>
          {PICTURE_SIDES.map((pixels) => <option key={pixels} value={pixels}>{fill(WORDS.gridOption, { cells: pixels / pixelsPerCell })}</option>)}</Select></label>
      </div>
      {/* The automaton's metadata (material-metadata.tsx), read here on request, never on the stage or a tile. */}
      {material && <MaterialMetadata rows={metadataRows(entry, material.file.training.updates, ownTitle(entry.title, material.file))} />}
    </div>}
  </>;

  // A quiet word that opens its panel under the line, and closes it again.
  const panelWord = (name: StagePanel, words: string) => (
    <button type="button" className="stage-word" aria-expanded={panel === name} onClick={() => togglePanel(name)}>{words}</button>
  );
  const dot = <span aria-hidden="true">·</span>;

  // The material in its frame, in a box as wide as the frame's column: the box is what the zoom fits.
  // The page names the basis group over the frame; the frame's corner names who made the automaton.
  const framed = <div className="stage-fit" ref={fitBox}>
    <MaterialFrame patches={side / CELLS_PER_PATCH} label={madeBy || undefined} note={gridNote?.(side) ?? fill(WORDS.frameGrid, { side })}>
      <div className="stage-canvas"
        onPointerEnter={() => { hovering.current = true; }} onPointerLeave={() => { hovering.current = false; hideRing(); }}
        ref={view}>
        <canvas ref={canvas} width={CANVAS_PIXELS} height={CANVAS_PIXELS} style={{ width: canvasSize, height: canvasSize, visibility: replayStatus === "ready" ? "visible" : "hidden" }}
          aria-label={fill(WORDS.canvasName, { title: entry.title })}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const { x, y } = cellAt(event); last.current = { x, y }; }}
          onPointerMove={moveBrush} onPointerUp={() => { last.current = null; }} onPointerCancel={() => { last.current = null; }} />
        {replayStatus !== "ready" && <img className="stage-poster" src={source.poster(entry)} alt={entry.title} />}
        {replayStatus === "ready" && <span ref={ringElement} className="stage-ring" style={{ width: ringSize, height: ringSize }} aria-hidden="true" />}
        {replayStatus === "opening" && <span className="stage-loading">{fill(WORDS.loading, { name: variationName(entry) })}</span>}
      </div>
    </MaterialFrame>
  </div>;

  return <section ref={stageElement} className="material-stage" aria-label={entry.title}>
    <div className="stage-instrument">
      {framed}
      <aside className="stage-readouts" aria-label={INSTRUMENT_WORDS.readoutsName}>
        {!ownerActions && (
          <MakerCard
            block={entry.block}
            title={material ? entry.title : ""}
            definitionName={material?.file.name ?? entry.materialId}
            credit={entry.credit}
            detail={tileName(entry).rule}
            updates={material?.file.training.updates ?? null}
            published={!publishable}
          />
        )}
        {/* A panel opens below the frame; the step stays in its line. */}
        <dl>
          <dt className="label">{INSTRUMENT_WORDS.tick}</dt><dd><output ref={tickOutput}>0</output></dd>
        </dl>
        {panels}
        {ownerActions && <div className="stage-owner">{ownerActions}</div>}
        <div className="stage-actions">
          <p className="stage-words">
            {material && source.keepable(entry) && <><KeepWord key={entry.id} material={material} entryId={entry.id} className="stage-word" />{dot}</>}
            {material && publishable && <><PublishWord key={entry.id} file={material.file} expanded={panel === "publish"} onToggle={() => togglePanel("publish")} className="stage-word" />{dot}</>}
            {panelWord("video", WORDS.video)}
            {dot}
            {panelWord("export", INSTRUMENT_WORDS.export)}
            {dot}
            {panelWord("options", INSTRUMENT_WORDS.options)}
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
