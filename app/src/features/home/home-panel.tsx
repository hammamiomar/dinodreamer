// The home's panel (home-page.tsx): what the right side shows for each beat of the scroll, one layer
// per beat, cross-faded, each figure following the beat's progress (home-scroll.ts). The entrance and
// the end run the automaton (home-material-view.tsx); the three beats between show the How page's
// recorded hibiscus thread with figures of their own (features/how/): the followed patch's attention
// by layer, the basis group's cloud arriving level by level, and the training's readouts.

import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLibrary } from "../../app/library-session";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { AtlasCloud } from "../../library/atlas-cloud";
import type { FigureMaterial } from "../../materials/material-file";
import { AtlasCloudFigure, CLOUD_VIEW } from "../../ui/atlas-cloud-figure";
import { pageScale } from "../../ui/page-scale";
import type { MaterialEntry } from "../gallery/material-index";
import { AUTOMATON_RECORD_FOLDER, type AutomatonState } from "../how/automaton-record";
import { attentionRow, attentionShares, neighbourhoodOf, splitKeys } from "../how/dino-math";
import { useHowSource } from "../how/figures/figure-data";
import { PictureWithPatches } from "../how/how-figures";
import { LAYERS, PREFIX } from "../how/how-shapes";
import { HOW_PICTURE } from "../how/how-source";
import { fires, STORY_FOLDER, type StoryRecord } from "../how/training-story";
import { useSourced } from "../how/use-sourced";
import { BAND_NAMES, STRENGTH_BANDS } from "../look/strength-bands";
import { HomeMaterial, type HomeStill } from "./home-material-view";
import { frameAt, HOME_BEATS, layerAt, levelsArrived, type HomeBeat } from "./home-scroll";

const WORDS = SITE_WORDS.home;
/**
 * The end's automaton regrows from the next seed at this tick, past the reading's 600 while the image
 * is at its best and before it can dissolve, as the How page's players do. The entrance's never
 * regrows by itself: its reset is the visitor's (home-page.tsx).
 */
const END_REGROW_AT_TICK = 800;
/** The window-sized field draws at one device pixel per CSS pixel: its cells are 2 CSS px or more, and the fan stays off. */
const FIELD_DRAW_RATIO = 1;
/** A figure's largest side: four times the 128 px grid, so a patch and a cell are whole pixels. */
const FIGURE_SIDE_MAX = 512;
/** The room the header takes over the panel's top once it has slid in, and the room a figure's captions take under it. */
const HEADER_ROOM = 64;
const CAPTION_ROOM = 160;
const ALL_LAYERS = Array.from({ length: LAYERS }, (_, index) => index + 1);

interface Room {
  width: number;
  height: number;
}

/** The panel's size in CSS pixels, followed as the window changes; zeros before the first measure. */
function usePanelRoom(panel: RefObject<HTMLElement | null>): Room {
  const [room, setRoom] = useState<Room>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const scale = pageScale(element);
      const width = box.width / scale;
      const height = box.height / scale;
      setRoom((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [panel]);
  return room;
}

const whole16 = (value: number) => Math.floor(value / 16) * 16;

/** A square figure's side in the panel, in whole 16s: the room less a module each side and the captions, 128 at least. */
function figureSide(room: Room): number {
  if (room.width <= 0) return 256;
  return Math.max(128, Math.min(FIGURE_SIDE_MAX, whole16(room.width - 128), whole16(room.height - HEADER_ROOM - CAPTION_ROOM)));
}

/** The cloud's width: its drawing is 9 : 7, so the room's height counts at that ratio. */
function cloudWidth(room: Room): number {
  if (room.width <= 0) return 448;
  const byHeight = ((room.height - HEADER_ROOM - CAPTION_ROOM) * CLOUD_VIEW.width) / CLOUD_VIEW.height;
  return Math.max(256, Math.min(CLOUD_VIEW.width, whole16(room.width - 128), whole16(byHeight)));
}

/** An automaton to run: its index entry and its file, null until the file has loaded. */
export interface Shown {
  entry: MaterialEntry;
  material: FigureMaterial | null;
}

export function HomePanel({ beat, progress, prefetch, still, entrance, thread, recordedState, reset, story, cloud, onNoReplay }: {
  beat: HomeBeat;
  /** How far the beat's figure has played, 0 to 1. */
  progress: number;
  /** The reader has scrolled: the beats' heavier files load now, before their figures show. */
  prefetch: boolean;
  still: HomeStill;
  /** The automaton on the entrance: the visit's, from the featured pool, with no picture shown beside it. */
  entrance: Shown | null;
  /** The thread's automaton, basis group 4009's, at the end. */
  thread: Shown | null;
  recordedState: AutomatonState | null;
  /** How many times the visitor has reset the entrance's automaton: each reset grows it again from noise. */
  reset: number;
  story: StoryRecord | null;
  cloud: AtlasCloud | null;
  onNoReplay: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const room = usePanelRoom(panel);
  const side = figureSide(room);
  const at = HOME_BEATS.indexOf(beat);
  // A figure holds its start before its beat and its end after it, so a cross-fade shows the right
  // state; within its beat it plays (home-page.tsx, useBeatPlay).
  const progressOf = (own: HomeBeat) => {
    const index = HOME_BEATS.indexOf(own);
    return index === at ? progress : index < at ? 1 : 0;
  };
  const initialState = useMemo(() => recordedState ? {
    tick: recordedState.replay.tick,
    fine: recordedState.fine.state,
    coarse: recordedState.coarse.state,
  } : undefined, [recordedState]);
  return (
    <div ref={panel} className="home-panel">
      <div className="home-layer home-layer-live" data-shown={beat === "entrance" || undefined}>
        {entrance && (
          <HomeMaterial key={`${entrance.entry.id}-${reset}`} entry={entrance.entry} material={beat === "entrance" && !still ? entrance.material : null} posterWhileRunning={false} drawRatio={FIELD_DRAW_RATIO} regrowAtTick={Number.POSITIVE_INFINITY} onNoReplay={onNoReplay} />
        )}
      </div>
      <div className="home-layer home-layer-figure" data-shown={beat === "model" || undefined}>
        <ModelFigure side={side} progress={progressOf("model")} prefetch={prefetch} />
      </div>
      <div className="home-layer home-layer-figure" data-shown={beat === "basis" || undefined}>
        <BasisFigure room={room} progress={progressOf("basis")} cloud={cloud} story={story} />
      </div>
      <div className="home-layer home-layer-figure" data-shown={beat === "automaton" || undefined}>
        <TrainingFigure side={side} progress={progressOf("automaton")} story={story} />
      </div>
      <div className="home-layer home-layer-live" data-shown={beat === "end" || undefined}>
        {thread && (
          <HomeMaterial
            entry={thread.entry}
            material={!still && initialState ? thread.material : null}
            initialState={initialState}
            playing={beat === "end"}
            posterUrl={`${AUTOMATON_RECORD_FOLDER}picture-128.png`}
            drawRatio={FIELD_DRAW_RATIO}
            regrowAtTick={END_REGROW_AT_TICK}
            onNoReplay={onNoReplay}
          />
        )}
      </div>
    </div>
  );
}

/** The hibiscus under the patch grid, the followed patch's attention laid over it at the layer the beat has reached. */
function ModelFigure({ side, progress, prefetch }: { side: number; progress: number; prefetch: boolean }) {
  const library = useLibrary();
  const opened = useHowSource();
  const source = opened.status === "ready" && prefetch ? opened.source : null;
  const layers = useSourced(source, (current) => Promise.all(ALL_LAYERS.map((layer) => current.attention(layer - 1))));
  const layer = layerAt(progress, LAYERS);
  const weights = layers.status === "ready" ? layers.value[layer - 1]! : null;
  const row = weights ? attentionRow(weights.attention, weights.heads, PREFIX + HOW_PICTURE.patch, "mean") : null;
  const heat = row ? splitKeys(row).patches : null;
  const heatScale = heat ? Math.max(...heat) : 1;
  const shares = row ? attentionShares(row, HOW_PICTURE.patch) : null;
  const box = neighbourhoodOf(HOW_PICTURE.patch);
  const patch = side / 16;
  return (
    <figure className="home-figure" style={{ width: side }}>
      {/* The attention heat is the followed patch's own; its 3 × 3 neighbourhood is boxed, as on the How page. */}
      <div className="home-picture" style={{ width: side, height: side }}>
        <PictureWithPatches src={library.previewUrl(HOW_PICTURE.imageId)} side={side} heat={heat} heatScale={heatScale} pinned={heat ? null : HOW_PICTURE.patch} alt={WORDS.pictureAlt} />
        <span className="home-neighbourhood" aria-hidden="true" style={{ left: box.column * patch, top: box.row * patch, width: box.columns * patch, height: box.rows * patch }} />
      </div>
      <figcaption className="home-caption">
        <span>{fill(WORDS.layerLine, { layer })}</span>
        {shares && <span>{fill(WORDS.outsideLine, { outside: Math.round(100 * shares.outside) })}</span>}
      </figcaption>
    </figure>
  );
}

/** Basis group 4009's cloud, its levels arriving in order as the beat goes, then the followed patch's point. */
function BasisFigure({ room, progress, cloud, story }: { room: Room; progress: number; cloud: AtlasCloud | null; story: StoryRecord | null }) {
  const width = cloudWidth(room);
  const height = Math.round((width * CLOUD_VIEW.height) / CLOUD_VIEW.width);
  const band = story?.anchor.band ?? null;
  return (
    <figure className="home-figure" style={{ width }}>
      <div className="home-cloud" data-arrived={levelsArrived(progress)} style={{ width, height }}>
        {cloud && story && band && (
          <AtlasCloudFigure
            cloud={cloud}
            lit={story.anchor.atlasPoint}
            label={<>{WORDS.cloudLabel} · <span className={`band ${band}`}>{BAND_NAMES[STRENGTH_BANDS.indexOf(band)]}</span></>}
          />
        )}
      </div>
      <figcaption className="home-caption">
        {cloud && <span>{fill(WORDS.cloudLine, { group: HOW_PICTURE.block, patches: cloud.wins.toLocaleString("en-US") })}</span>}
      </figcaption>
    </figure>
  );
}

/** The training's readouts, one every 25 updates to the first fire, the frame chosen by the beat's progress. */
function TrainingFigure({ side, progress, story }: { side: number; progress: number; story: StoryRecord | null }) {
  const frames = story?.training.frames ?? [];
  const shown = frameAt(progress, frames.length);
  const frame = frames[shown] ?? null;
  const fired = frame !== null && shown === frames.length - 1 && fires(frame);
  return (
    <figure className="home-figure" style={{ width: side }}>
      {/* The strip moves by whole frames under a window one frame wide; nothing scales or transforms the cells. */}
      <div className="home-strip" style={{ width: side, height: side }}>
        {story && (
          // The research run's readouts (app/public/story/), not a library picture.
          <img src={`${STORY_FOLDER}${story.training.strip}`} alt="" style={{ width: frames.length * side, height: side, left: -shown * side }} />
        )}
      </div>
      <figcaption className="home-caption">
        {frame && <span>{fill(fired ? WORDS.firedLine : WORDS.readoutLine, { update: frame.update, strength: frame.strength.toFixed(2), wins: Math.round(100 * frame.winnerFraction) })}</span>}
      </figcaption>
    </figure>
  );
}
