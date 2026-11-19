// A published automaton growing in a field, tiled because its grid is a torus, and the canvas is
// the brush. The runtime is the Automata page's (replay/stage-session.ts, figure-replay.ts,
// replay-loop.ts); this surface has no toolbar. One replay fills the field at one tile per field
// height: its canvas repeats the grid (figure-replay.ts, `tiled`). It plays from the material's
// own seed or a recorded state and, where requested, regrows from the next seed at `regrowAtTick`. The
// poster, tiled the same way, is the field's background: it shows until the replay shows, and
// alone when there is no material to run (no WebGPU, reduced motion, or the file not yet loaded).
// Children hang on the field: the home's picture and label. The field reads its line's colour
// from the replay (--sampled).
//
// A field that carries its cells (the home's entrance) keeps them when it is given another
// automaton: the relay (home-relay.ts). A replay holds one rule, so the next automaton's replay
// starts on the field's second canvas from the shown cells, and the canvases trade places at its
// first frame. Both canvases then show the same cells, so there is no cut.

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent, type ReactNode } from "react";
import { fill, SITE_WORDS } from "../../app/site-words";
import { createFigureReplay, type FigureReplay, type FigureReplayState } from "../../replay/figure-replay";
import { FIGURE_SHADERS } from "../../replay/figure-shaders";
import { REPLAY_DEFAULT_SPEED } from "../../replay/replay-loop";
import { openStageSession, type StageSession } from "../../replay/stage-session";
import { figurePlayback, type FigureMaterial } from "../../materials/material-file";
import { SAMPLE_EVERY_TICKS, sampledAccent } from "../../ui/sampled-accent";
import { canvasPixelRatio, pageScale } from "../../ui/page-scale";
import { materialFileUrl } from "../gallery/material-gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { nextSeed, REGROW_AT_TICK, strokeOnTorus, tiledCanvas } from "./home-material";
import { cellsForGrids, FLAT_CHECK_EVERY_TICKS, gridsOf, pictureSpread, startsAgain } from "./home-relay";
import "./home-material.css";

const WORDS = SITE_WORDS.home;
/** The brush's radius in cells of a 128-cell grid: the Automata page's default brush. */
const BRUSH_RADIUS = 12;
/** Why an automaton is a still: the browser cannot grow it, or the visitor asked for no motion. */
export type HomeStill = "no-webgpu" | "reduced-motion" | null;

/** The field's size in page pixels, and its cells' size: one tile of `side` cells per field height. */
function fieldSize(field: HTMLElement, side: number): { width: number; height: number; cell: number } {
  const box = field.getBoundingClientRect();
  const scale = pageScale(field);
  const width = box.width / scale;
  const height = box.height / scale;
  return { width, height, cell: height / side };
}

/** A tick at every patch boundary (16 cells) along the field's top and bottom edges, outside the cells. */
function PatchTicks({ pitch }: { pitch: number }) {
  const pattern = useId();
  return (
    <>
      {(["top", "bottom"] as const).map((edge) => (
        <svg key={edge} className={`home-field-ticks home-field-ticks-${edge}`} aria-hidden="true">
          <defs>
            <pattern id={`${pattern}-${edge}`} width={pitch} height="6" patternUnits="userSpaceOnUse">
              <line x1="0.5" x2="0.5" y1="0" y2="6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${pattern}-${edge})`} />
        </svg>
      ))}
    </>
  );
}

/** One automaton's replay on one of the field's canvases. */
interface FieldRun {
  readonly entry: MaterialEntry;
  readonly canvas: HTMLCanvasElement;
  readonly session: StageSession;
  /** The replay's canvas pixels per cell, for the brush. */
  scale: number;
  /** The run grows from another automaton's cells, so it watches for a flat field (home-relay.ts, startsAgain). */
  carried: boolean;
  /** The run's cells are going to a relay: it is paused, takes no brush and is not woken by the window. */
  handingOver: boolean;
  close(): void;
}

/** What a field has running: the shown automaton's run and, during a relay, the next automaton's on the other canvas. */
interface FieldRuns {
  shown: FieldRun | null;
  next: FieldRun | null;
  /** Counts relays, and closings, so that a relay overtaken while it awaits the GPU stops. */
  relays: number;
}

interface RunRequest {
  /** The field the run's canvas fills, which it measures and watches. */
  area: HTMLElement;
  canvas: HTMLCanvasElement;
  entry: MaterialEntry;
  material: FigureMaterial;
  /** Cells to grow from: a recorded state, or the last automaton's cells in a relay. Absent: the automaton's own start. */
  cells?: FigureReplayState;
  carried: boolean;
  speed: number;
  stepsPerSecond: number | undefined;
  drawRatio: number;
  regrowAtTick: number;
  /** The field is in the window, and the page asks for play: the run grows only while both hold. */
  visible: MutableRefObject<boolean>;
  requestedPlaying: MutableRefObject<boolean>;
  onFirstFrame: (run: FieldRun) => void;
  onAccent: (accent: string) => void;
  onMessage: (message: string) => void;
  /** The replay failed before its first frame: the browser has no usable WebGPU adapter. */
  onNoReplay: () => void;
}

/**
 * A replay of the request's automaton, filling the field at its size and following it: the cells
 * (or its own seed), the next seed each time the regrow tick comes, the line's colour read every
 * SAMPLE_EVERY_TICKS, and for carried cells the flat-field check. Out of the window the loop
 * pauses, so a field costs nothing unseen.
 */
function openFieldRun(request: RunRequest): FieldRun {
  const { area, canvas, entry, material, visible, requestedPlaying } = request;
  const side = entry.side;
  const size = () => {
    const { width, height, cell } = fieldSize(area, side);
    return tiledCanvas(width, height, cell, canvasPixelRatio(area, request.drawRatio));
  };
  const first = size();
  let seed = entry.seed;
  let framed = false;
  let sampledAt = -1;
  let flatCheckedAt = -1;
  let spreadBefore: number | null = null;
  const session = openStageSession(
    (signal) => createFigureReplay(
      { canvas, side, seed, initialState: request.cells, scale: first.scale, tiled: first, ...figurePlayback(material.file), onDeviceLost: request.onMessage, signal },
      { values: material.values, fireRate: material.file.rule.fireRate },
      FIGURE_SHADERS,
    ),
    {
      speed: request.speed,
      stepsPerSecond: request.stepsPerSecond,
      playing: requestedPlaying.current,
      onFrame: (tick) => {
        if (!framed) {
          framed = true;
          request.onFirstFrame(run);
        }
        const { replay, loop } = session;
        if (!replay || !loop) return;
        // The line's colour, read back from the replay every SAMPLE_EVERY_TICKS ticks (ui/sampled-accent.ts).
        const due = Math.floor(tick / SAMPLE_EVERY_TICKS);
        if (due !== sampledAt) {
          sampledAt = due;
          loop.hold(() => replay.readPixels()).then((pixels_N4) => request.onAccent(sampledAccent(pixels_N4, replay.pictureSide)), () => {});
        }
        // Another automaton's cells that this rule leaves flat: it starts again from its own start.
        const flatDue = Math.floor(tick / FLAT_CHECK_EVERY_TICKS);
        if (run.carried && flatDue !== flatCheckedAt) {
          flatCheckedAt = flatDue;
          loop.hold(() => replay.readPixels()).then((pixels_N4) => {
            const spread = pictureSpread(pixels_N4);
            if (run.carried && startsAgain(spreadBefore, spread)) {
              run.carried = false;
              session.reseed(seed);
            }
            spreadBefore = spread;
          }, () => {});
        }
        if (tick >= request.regrowAtTick) {
          seed = nextSeed(seed);
          session.reseed(seed);
        }
      },
      onError: (error) => (framed ? request.onMessage(String(error)) : request.onNoReplay()),
    },
  );
  const resized = new ResizeObserver(() => {
    const next = size();
    run.scale = next.scale;
    const { replay, loop } = session;
    if (!replay || !loop) return;
    // Resizing clears the canvas. The held update also requests a redraw while paused.
    void loop.hold(async () => {
      if (session.replay !== replay) return;
      replay.setScale(next.scale);
      replay.setTiled(next);
    }).catch((error: unknown) => {
      if (session.replay === replay) request.onMessage(String(error));
    });
  });
  const watched = new IntersectionObserver(([seen]) => {
    visible.current = seen?.isIntersecting ?? true;
    if (!run.handingOver) session.setPlaying(visible.current && requestedPlaying.current);
  });
  const run: FieldRun = {
    entry,
    canvas,
    session,
    scale: first.scale,
    carried: request.carried,
    handingOver: false,
    close() {
      resized.disconnect();
      watched.disconnect();
      session.close();
    },
  };
  resized.observe(area);
  watched.observe(area);
  return run;
}

function closeRuns(runs: FieldRuns): void {
  runs.relays++;
  runs.next?.close();
  runs.shown?.close();
  runs.next = null;
  runs.shown = null;
}

/** The cells a replay shows, with its coarse grid if it has one. */
async function readCells(replay: FigureReplay, coarse: boolean): Promise<FigureReplayState> {
  const fine = await replay.readState();
  return coarse ? { tick: replay.tick, fine, coarse: await replay.readCoarseState() } : { tick: replay.tick, fine };
}

/**
 * The relay: the shown run's cells go to `entry`'s rule on the other canvas (home-relay.ts,
 * cellsForGrids). The shown run stops while its cells are read and the next replay is made; at the
 * next run's first frame, which draws those cells one tick on, the canvases trade places and the
 * shown run closes. A turn during a relay replaces the relay that has not yet shown, and a turn back
 * to the shown automaton gives it up. Before the shown run has drawn there are no cells: the next
 * automaton starts from its own start.
 */
async function relayTo(
  runs: FieldRuns,
  entry: MaterialEntry,
  canvases: [HTMLCanvasElement, HTMLCanvasElement],
  field: {
    /** A run of `entry` on `canvas`, from `cells` when there are cells to carry, else from its own start. */
    open: (canvas: HTMLCanvasElement, cells: FigureReplayState | null, onFirstFrame: (run: FieldRun) => void) => FieldRun;
    /** Whether a run grows now: the field is in the window and the page asks for play. */
    growing: () => boolean;
    onShown: (entry: MaterialEntry) => void;
  },
): Promise<void> {
  const from = runs.shown!;
  runs.next?.close();
  runs.next = null;
  const relay = ++runs.relays;
  if (from.entry.id === entry.id) {
    from.handingOver = false;
    from.session.setPlaying(field.growing());
    return;
  }
  const { replay, loop } = from.session;
  let cells: FigureReplayState | null = null;
  if (replay && loop) {
    from.handingOver = true;
    from.session.setPlaying(false);
    try {
      cells = cellsForGrids(await loop.hold(() => readCells(replay, gridsOf(from.entry).coarse)), gridsOf(from.entry), gridsOf(entry));
    } catch {
      // The shown replay stopped (its own error says why): the next automaton starts from its own start.
      cells = null;
    }
    if (runs.relays !== relay) return;
  }
  const spare = from.canvas === canvases[0] ? canvases[1] : canvases[0];
  runs.next = field.open(spare, cells, (next) => {
    if (runs.next !== next) return;
    // The trade is made on the elements, in this task, so the page never paints both canvases hidden.
    next.canvas.dataset.shown = "";
    delete from.canvas.dataset.shown;
    from.close();
    runs.shown = next;
    runs.next = null;
    field.onShown(next.entry);
  });
}

export function HomeMaterial({
  entry,
  material,
  initialState,
  playing = true,
  posterUrl = materialFileUrl(entry, "poster.png"),
  speed = REPLAY_DEFAULT_SPEED,
  stepsPerSecond,
  drawRatio = Number.POSITIVE_INFINITY,
  posterWhileRunning = true,
  brush = true,
  carryCells = false,
  onNoReplay,
  regrowAtTick = REGROW_AT_TICK,
  children,
}: {
  entry: MaterialEntry;
  /** The material to run on the poster, or null to show the poster alone. */
  material: FigureMaterial | null;
  initialState?: FigureReplayState;
  /** Prepare and draw a recorded state while paused; advance only while its section is shown. */
  playing?: boolean;
  /** A recorded state's picture must match the grids that replace it. */
  posterUrl?: string;
  /** Ticks per drawn frame (replay-loop.ts): 1/2 holds each tick for two frames, for small players on a phone. */
  speed?: number;
  /** Ticks per second instead of `speed` (replay-loop.ts): the same pace on a 60, 120 or 144 Hz screen. */
  stepsPerSecond?: number;
  /** The most device pixels per CSS pixel the canvas is drawn at: 1 for a field the size of the window, whose cells are 2 CSS px or more. */
  drawRatio?: number;
  /** Whether the poster stays under a running replay. False opens on black and the growth, with no flash of the grown image first; the poster returns when there is no material to run or the replay has stopped. */
  posterWhileRunning?: boolean;
  /** Whether the canvas is the brush. False where the page wants the growth watched, not touched. */
  brush?: boolean;
  /**
   * Whether another automaton's material takes over the running cells (the relay, home-relay.ts)
   * instead of starting from its own start. Its other settings are fixed for the field's life.
   */
  carryCells?: boolean;
  /** The replay failed before its first frame: the browser has no usable WebGPU adapter, so the poster stays. */
  onNoReplay: () => void;
  /** The tick the replay regrows from the next seed at; a page that wants the growth alone, not the dissolve, shortens it, and one with its own reset passes Infinity. */
  regrowAtTick?: number;
  /** What hangs on the field, over the cells: the home's picture and label. */
  children?: ReactNode;
}) {
  const field = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const spareCanvas = useRef<HTMLCanvasElement>(null);
  const runs = useRef<FieldRuns>({ shown: null, next: null, relays: 0 });
  const visible = useRef(true);
  const requestedPlaying = useRef(playing);
  requestedPlaying.current = playing;
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState("");
  const [accent, setAccent] = useState<string | null>(null);
  // The automaton whose cells the field shows: during a relay, still the last one.
  const [shownEntry, setShownEntry] = useState(entry);
  const onField = carryCells && material ? shownEntry : entry;
  // The cells' size on the screen: whole device pixels per cell (tiledCanvas), so the poster, the
  // ticks and the replay agree; unknown until the field is measured.
  const [cellPixels, setCellPixels] = useState<number | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  // The page's callback, read when the replay fails: a new function on a render must not restart the replay.
  const noReplay = useRef(onNoReplay);
  noReplay.current = onNoReplay;
  // The entry the next run starts, read in the effect below: the run follows its material, side and seed, not the object.
  const requestedEntry = useRef(entry);
  requestedEntry.current = entry;
  const side = onField.side;

  useLayoutEffect(() => {
    const area = field.current;
    if (!area) return;
    const measure = () => {
      const { width, height, cell } = fieldSize(area, side);
      const ratio = canvasPixelRatio(area, drawRatio);
      setCellPixels(tiledCanvas(width, height, cell, ratio).scale / ratio);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [side, drawRatio]);

  // A replay of the material; in a field that carries its cells, a relay from the shown run.
  useEffect(() => {
    const relaying = carryCells && material !== null && runs.current.shown !== null;
    if (!relaying) {
      setLive(false);
      setMessage("");
    }
    const area = field.current;
    const target = canvas.current;
    if (!material || !area || !target) return;
    const next = requestedEntry.current;
    const request = (on: HTMLCanvasElement, cells: FigureReplayState | undefined, carried: boolean, onFirstFrame: (run: FieldRun) => void): RunRequest => ({
      area,
      canvas: on,
      entry: next,
      material,
      cells,
      carried,
      speed,
      stepsPerSecond,
      drawRatio,
      regrowAtTick,
      visible,
      requestedPlaying,
      onFirstFrame,
      onAccent: setAccent,
      onMessage: setMessage,
      onNoReplay: () => noReplay.current(),
    });
    const spare = spareCanvas.current;
    if (relaying && spare) {
      void relayTo(runs.current, next, [target, spare], {
        open: (on, cells, onFirstFrame) => openFieldRun(request(on, cells ?? undefined, cells !== null, onFirstFrame)),
        growing: () => visible.current && requestedPlaying.current,
        onShown: (entry) => {
          setShownEntry(entry);
          setLive(true);
        },
      });
      return;
    }
    closeRuns(runs.current);
    visible.current = true;
    if (carryCells) target.dataset.shown = "";
    runs.current.shown = openFieldRun(request(target, initialState, false, () => setLive(true)));
    setShownEntry(next);
    // A field that carries its cells keeps its runs for the next material; the effects below close them.
    return carryCells ? undefined : () => closeRuns(runs.current);
  }, [material, entry.side, entry.seed, initialState, speed, stepsPerSecond, drawRatio, regrowAtTick, carryCells]);

  useEffect(() => {
    if (!material) closeRuns(runs.current);
  }, [material]);

  useEffect(() => () => closeRuns(runs.current), []);

  useEffect(() => {
    for (const run of [runs.current.shown, runs.current.next]) {
      if (run && !run.handingOver) run.session.setPlaying(playing && visible.current);
    }
  }, [playing]);

  // The canvas is the brush: a drag stamps soft discs along its path; holding still stamps nothing.
  // Places are in cells of the repeated grid, not yet wrapped (strokeOnTorus wraps each segment).
  const cellAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = event.currentTarget.width / box.width / (runs.current.shown?.scale ?? 1);
    return { x: (event.clientX - box.left) * ratio, y: (event.clientY - box.top) * ratio };
  };
  const stroke = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.buttons === 0 || !last.current) return;
    const next = cellAt(event);
    const { x0, y0, x1, y1 } = strokeOnTorus(last.current, next, side);
    const shown = runs.current.shown;
    if (shown && !shown.handingOver) shown.session.loop?.stroke(x0, y0, x1, y1, (BRUSH_RADIUS * side) / 128);
    last.current = next;
  };

  const tile = cellPixels === null ? undefined : `${side * cellPixels}px`;
  // A replay that has stopped (a lost device) gives the poster back under its message.
  const poster = !material || posterWhileRunning || message !== "";
  const canvasProps = {
    "aria-label": fill(brush ? WORDS.canvasLabel : WORDS.canvasStill, { block: onField.block }),
    onPointerDown: brush ? (event: PointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      last.current = cellAt(event);
    } : undefined,
    onPointerMove: brush ? stroke : undefined,
    onPointerUp: brush ? () => { last.current = null; } : undefined,
    onPointerCancel: brush ? () => { last.current = null; } : undefined,
  };
  return (
    <div className="home-material" style={accent ? ({ "--sampled": accent } as CSSProperties) : undefined}>
      <div
        ref={field}
        className="home-field"
        data-live={(live && message === "") || undefined}
        data-brush={brush || undefined}
        data-carry={carryCells || undefined}
        style={{ backgroundImage: poster ? `url(${posterUrl})` : undefined, backgroundSize: tile && `${tile} ${tile}` }}
      >
        {cellPixels !== null && <PatchTicks pitch={16 * cellPixels} />}
        {material && <canvas ref={canvas} {...canvasProps} />}
        {/* The relay's second canvas: the next automaton starts on it, hidden, from the shown cells. */}
        {material && carryCells && <canvas ref={spareCanvas} {...canvasProps} />}
      </div>
      {children}
      {message && <p className="home-material-note" role="status">{message}</p>}
    </div>
  );
}
