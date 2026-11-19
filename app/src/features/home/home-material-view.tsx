// A published automaton growing in a field, tiled because its grid is a torus, and the canvas is
// the brush. The runtime is the Automata page's (replay/stage-session.ts, figure-replay.ts,
// replay-loop.ts); this surface has no toolbar. One replay fills the field at one tile per field
// height: its canvas repeats the grid (figure-replay.ts, `tiled`). It plays from the material's
// own seed or a recorded state and, where requested, regrows from the next seed at `regrowAtTick`. The
// poster, tiled the same way, is the field's background: it shows until the replay shows, and
// alone when there is no material to run (no WebGPU, reduced motion, or the file not yet loaded).
// Children hang on the field: the home's picture and label. The field reads its line's colour
// from the replay (--sampled).

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { fill, SITE_WORDS } from "../../app/site-words";
import { createFigureReplay, type FigureReplayState } from "../../replay/figure-replay";
import { FIGURE_SHADERS } from "../../replay/figure-shaders";
import { REPLAY_DEFAULT_SPEED } from "../../replay/replay-loop";
import { openStageSession, type StageSession } from "../../replay/stage-session";
import { figurePlayback, type FigureMaterial } from "../../materials/material-file";
import { SAMPLE_EVERY_TICKS, sampledAccent } from "../../ui/sampled-accent";
import { canvasPixelRatio, pageScale } from "../../ui/page-scale";
import { materialFileUrl } from "../gallery/material-gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { nextSeed, REGROW_AT_TICK, strokeOnTorus, tiledCanvas } from "./home-material";
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

export function HomeMaterial({
  entry,
  material,
  initialState,
  playing = true,
  posterUrl = materialFileUrl(entry, "poster.png"),
  speed = REPLAY_DEFAULT_SPEED,
  drawRatio = Number.POSITIVE_INFINITY,
  posterWhileRunning = true,
  brush = true,
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
  /** The most device pixels per CSS pixel the canvas is drawn at: 1 for a field the size of the window, whose cells are 2 CSS px or more. */
  drawRatio?: number;
  /** Whether the poster stays under a running replay. False opens on black and the growth, with no flash of the grown image first; the poster returns when there is no material to run or the replay has stopped. */
  posterWhileRunning?: boolean;
  /** Whether the canvas is the brush. False where the page wants the growth watched, not touched. */
  brush?: boolean;
  /** The replay failed before its first frame: the browser has no usable WebGPU adapter, so the poster stays. */
  onNoReplay: () => void;
  /** The tick the replay regrows from the next seed at; a page that wants the growth alone, not the dissolve, shortens it, and one with its own reset passes Infinity. */
  regrowAtTick?: number;
  /** What hangs on the field, over the cells: the home's picture and label. */
  children?: ReactNode;
}) {
  const field = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<StageSession | null>(null);
  const visible = useRef(true);
  const requestedPlaying = useRef(playing);
  requestedPlaying.current = playing;
  /** The replay's canvas pixels per cell, for the brush. */
  const pixelsPerCell = useRef(1);
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState("");
  const [accent, setAccent] = useState<string | null>(null);
  // The cells' size on the screen: whole device pixels per cell (tiledCanvas), so the poster, the
  // ticks and the replay agree; unknown until the field is measured.
  const [cellPixels, setCellPixels] = useState<number | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  // The page's callback, read when the replay fails: a new function on a render must not restart the replay.
  const noReplay = useRef(onNoReplay);
  noReplay.current = onNoReplay;
  const side = entry.side;

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

  // A replay from the recorded state or the reading's seed; the next seed each time the regrow
  // tick comes. Out of the window the loop pauses, so a field costs nothing unseen.
  useEffect(() => {
    setLive(false);
    setMessage("");
    if (!material || !canvas.current || !field.current) return;
    const target = canvas.current;
    const area = field.current;
    const size = () => {
      const { width, height, cell } = fieldSize(area, side);
      return tiledCanvas(width, height, cell, canvasPixelRatio(area, drawRatio));
    };
    const first = size();
    pixelsPerCell.current = first.scale;
    let seed = entry.seed;
    let framed = false;
    visible.current = true;
    let sampledAt = -1;
    const session = openStageSession(
      (signal) => createFigureReplay(
        { canvas: target, side, seed, initialState, scale: first.scale, tiled: first, ...figurePlayback(material.file), onDeviceLost: setMessage, signal },
        { values: material.values, fireRate: material.file.rule.fireRate },
        FIGURE_SHADERS,
      ),
      {
        speed,
        playing: requestedPlaying.current,
        onFrame: (tick) => {
          if (!framed) setLive(true);
          framed = true;
          // The line's colour, read back from the replay every SAMPLE_EVERY_TICKS ticks (ui/sampled-accent.ts).
          const due = Math.floor(tick / SAMPLE_EVERY_TICKS);
          const { replay, loop } = session;
          if (due !== sampledAt && replay && loop) {
            sampledAt = due;
            loop.hold(() => replay.readPixels()).then((pixels_N4) => setAccent(sampledAccent(pixels_N4, replay.pictureSide)), () => {});
          }
          if (tick >= regrowAtTick) {
            seed = nextSeed(seed);
            session.loop?.reseed(seed);
          }
        },
        // A replay that never drew a frame is a browser without a usable WebGPU adapter: the poster stays, and the page says so.
        onError: (error) => (framed ? setMessage(String(error)) : noReplay.current()),
      },
    );
    runtime.current = session;
    const resized = new ResizeObserver(() => {
      const next = size();
      pixelsPerCell.current = next.scale;
      const { replay, loop } = session;
      if (!replay || !loop) return;
      // Resizing clears the canvas. The held update also requests a redraw while paused.
      void loop.hold(async () => {
        if (session.replay !== replay) return;
        replay.setScale(next.scale);
        replay.setTiled(next);
      }).catch((error: unknown) => {
        if (session.replay === replay) setMessage(String(error));
      });
    });
    resized.observe(area);
    const watched = new IntersectionObserver(([seen]) => {
      visible.current = seen?.isIntersecting ?? true;
      session.setPlaying(visible.current && requestedPlaying.current);
    });
    watched.observe(area);
    return () => {
      resized.disconnect();
      watched.disconnect();
      session.close();
      if (runtime.current === session) runtime.current = null;
    };
  }, [material, side, entry.seed, initialState, speed, drawRatio, regrowAtTick]);

  useEffect(() => {
    runtime.current?.setPlaying(playing && visible.current);
  }, [playing]);

  // The canvas is the brush: a drag stamps soft discs along its path; holding still stamps nothing.
  // Places are in cells of the repeated grid, not yet wrapped (strokeOnTorus wraps each segment).
  const cellAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = event.currentTarget.width / box.width / pixelsPerCell.current;
    return { x: (event.clientX - box.left) * ratio, y: (event.clientY - box.top) * ratio };
  };
  const stroke = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.buttons === 0 || !last.current) return;
    const next = cellAt(event);
    const { x0, y0, x1, y1 } = strokeOnTorus(last.current, next, side);
    runtime.current?.loop?.stroke(x0, y0, x1, y1, (BRUSH_RADIUS * side) / 128);
    last.current = next;
  };

  const tile = cellPixels === null ? undefined : `${side * cellPixels}px`;
  // A replay that has stopped (a lost device) gives the poster back under its message.
  const poster = !material || posterWhileRunning || message !== "";
  return (
    <div className="home-material" style={accent ? ({ "--sampled": accent } as CSSProperties) : undefined}>
      <div
        ref={field}
        className="home-field"
        data-live={(live && message === "") || undefined}
        data-brush={brush || undefined}
        style={{ backgroundImage: poster ? `url(${posterUrl})` : undefined, backgroundSize: tile && `${tile} ${tile}` }}
      >
        {cellPixels !== null && <PatchTicks pitch={16 * cellPixels} />}
        {material && (
          <canvas
            ref={canvas}
            aria-label={fill(brush ? WORDS.canvasLabel : WORDS.canvasStill, { block: entry.block })}
            onPointerDown={brush ? (event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              last.current = cellAt(event);
            } : undefined}
            onPointerMove={brush ? stroke : undefined}
            onPointerUp={brush ? () => { last.current = null; } : undefined}
            onPointerCancel={brush ? () => { last.current = null; } : undefined}
          />
        )}
      </div>
      {children}
      {message && <p className="home-material-note" role="status">{message}</p>}
    </div>
  );
}
