import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { RELEASE_LOCATION } from "../app/config";
import type { MaterialRequestOrigin, MaterialRequestPicture } from "../app/material-request";
import type { MaterialRequest } from "../recipe";
import { announceKept } from "../replay/keep-material";
import { keepMaterial } from "../storage/materials";
import { methodReadsTokens, readFigureMaterial, type FigureMaterialFile, type FigureMethod, type FigureTargetSet } from "../materials/material-file";
import type { ReleaseLocation } from "../synthesis/protocol";
import { SAMPLE_EVERY_TICKS, sampledAccent } from "../ui/sampled-accent";
import { GrowClient } from "./client";
import { continuationChange, type ContinuationSource } from "./continuation";
import { NO_RECORD, markSaved, recordEvent, type GrowRecord } from "./grow-view";
import type { MaterialKind } from "./material-kind";
import { methodLayers, type TokenDepth } from "./train-method";
import { sameTargetSet } from "./target-set";
import type { GrowEvent } from "./protocol";
import { clearRunOnPageHide, noteInterruptedRun, runMemory, type BatchSize } from "./batch-size";

// One site-wide Train run owns the worker, saved files and live grid. The page and corner tray
// are views of the same store, so navigation does not end training. Frames have separate listeners
// to avoid re-rendering the views on every frame.

/** What a run started with. Another target, kind, method or stop rule is another material. */
export interface GrowSettings {
  /** The target it trains toward: a page shows the run only for this target (sameTarget). */
  request: MaterialRequest;
  kind: MaterialKind;
  /** What it compares the canvas with (train-method.ts). A continuation trains by its definition's own method. */
  method: FigureMethod;
  /** A token method's depth (train-method.ts); ignored by the basis-group methods. */
  depth: TokenDepth;
  /** A set method's target set, as the page resolved and showed it (target-set.ts); null otherwise and for a continuation. */
  set: FigureTargetSet | null;
  /** Who chose the request's points: the visitor, or Train for /train?block=N. The way back to Train restores it. */
  origin: MaterialRequestOrigin;
  stopAtFirstFire: boolean;
  /** The saved definition a run continues (Train resume, case 2), or null for a new automaton. */
  continuation: ContinuationSource | null;
  /** The visitor's picture the target's patch is on, if it is theirs: the way back to Train shows it again. */
  picture: MaterialRequestPicture | null;
  /** Grids per optimizer update (batch-size.ts). A continuation trains at its definition's own. */
  batch: BatchSize;
}

/** A kept file Keep could not save on this device, so the views offer it as a download. */
export interface KeepFailure {
  file: FigureMaterialFile;
  message: string;
}

/** Everything a view shows of the run, except its live grid. */
export interface TrainRunState {
  record: GrowRecord;
  settings: GrowSettings | null;
  files: ReadonlyMap<string, FigureMaterialFile>;
  /** The live grid's colour, sampled every SAMPLE_EVERY_TICKS ticks: the frame's line once it has fired. */
  sampled: string | null;
  keepFailure: KeepFailure | null;
  /** The Train page shows this run, so the corner tray need not (trayShown). */
  shownOnPage: boolean;
}

/**
 * The latest reading of the shown grid for the live map: each patch's code in the group's space (192
 * values, patch t at [3t, 3t + 3)) and which of the 64 patches select the group, at a tick of an update.
 * The worker's "map" events give it while training, its readings at other times.
 */
export interface LiveMap {
  patchCodes: Float32Array;
  selectedPatches: Uint8Array;
  tick: number;
  completed: number;
}

/**
 * A set method's target set as the live map draws it: each token's code in the patch codes' space (N × 3,
 * token n at [3n, 3n + 3)) and its picture's index in the set. The worker sends it once the set is prepared.
 */
export interface TrainSetTokens {
  codes: Float32Array;
  tokenPictures: Uint16Array;
}

/** The live grid's latest picture: SIDE × SIDE RGBA bytes, one pixel per cell. */
export interface LiveCells {
  pixels_N4: Uint8ClampedArray;
  tick: number;
}

/** The worker's commands, as the store gives them (client.ts). */
export interface TrainRunClient {
  start: GrowClient["start"];
  stop(): void;
  resumeTraining(): void;
  restart(): void;
  keep(): void;
  brush(stamps: [number, number, number][]): void;
  dispose(): void;
}

/** What the store needs from outside: the worker, Keep, the release and the tab's record of a run. Tests give their own. */
export interface TrainRunDependencies {
  createClient(onEvent: (event: GrowEvent) => void): TrainRunClient;
  keep(file: FigureMaterialFile): Promise<void>;
  release: ReleaseLocation;
  /** Whether a run is training now, so a page that goes down mid-run can be told from one the person left (batch-size.ts). */
  runRecord: Pick<typeof runMemory, "started" | "ended" | "deviceLost">;
}

export interface TrainRun {
  state(): TrainRunState;
  subscribe(listener: () => void): () => void;
  live(): LiveCells | null;
  subscribeLive(listener: () => void): () => void;
  /** The live map's latest reading, with its own listeners, as the frames have. */
  map(): LiveMap | null;
  /** A set method's run's target set for the live map, kept and cleared with the map, heard by the map's listeners. */
  setTokens(): TrainSetTokens | null;
  subscribeMap(listener: () => void): () => void;
  /** Starts a new run; a running one ends first. Files it kept stay kept. */
  start(request: MaterialRequest, settings: Omit<GrowSettings, "request">): void;
  /** Ends the worker; the views show the start again. Files already kept stay in Keep. */
  end(): void;
  /** Stops training now: the rule of this moment is kept as the final one and the trainer is held. */
  stop(): void;
  /** Trains the held run on (Resume). */
  resumeTraining(): void;
  /** After a run whose last update did not meet the selection target: trains the next seed. */
  restart(): void;
  /** After such a run: holds its final rule as the result, as a run that has ended. */
  keep(): void;
  /** Damage stamps on the live grid, [x, y, radius] in cells. */
  brush(stamps: [number, number, number][]): void;
  /** The Train page tells the store while it shows this run. */
  showOnPage(shown: boolean): void;
}

/** Cells along a side of the live grid: the worker's pictures are SIDE × SIDE, one pixel per cell. */
export const SIDE = 128;

const IDLE: TrainRunState = { record: NO_RECORD, settings: null, files: new Map(), sampled: null, keepFailure: null, shownOnPage: false };

export function createTrainRun(dependencies: TrainRunDependencies): TrainRun {
  let state: TrainRunState = IDLE;
  let live: LiveCells | null = null;
  let client: TrainRunClient | null = null;
  let sampledAt = -1;
  /** The batch size the current run trains at. */
  let runBatch: BatchSize = 4;
  const listeners = new Set<() => void>();
  const liveListeners = new Set<() => void>();
  let map: LiveMap | null = null;
  let setTokens: TrainSetTokens | null = null;
  const mapListeners = new Set<() => void>();
  const notifyMap = () => {
    for (const listener of mapListeners) listener();
  };
  const setMap = (next: LiveMap | null) => {
    map = next;
    notifyMap();
  };

  const update = (change: Partial<TrainRunState>) => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  const notifyLive = () => {
    for (const listener of liveListeners) listener();
  };

  /** A kept file goes into Keep at once: a run takes minutes, so it is never only in this tab. */
  const keep = (sent: FigureMaterialFile) => {
    let file: FigureMaterialFile;
    try {
      file = readFigureMaterial(sent).file;
    } catch (error) {
      update({ record: { ...state.record, failure: String(error) } });
      return;
    }
    const settings = state.settings;
    update({ files: new Map(state.files).set(file.id, file) });
    dependencies.keep(file).then(
      () => { if (state.settings === settings) update({ record: markSaved(state.record, file.id) }); },
      (error: unknown) => { if (state.settings === settings) update({ keepFailure: { file, message: String(error) } }); },
    );
  };

  const onEvent = (event: GrowEvent) => {
    if (event.type === "live") {
      const { pixels, tick } = event.frame;
      live = { pixels_N4: pixels, tick };
      const due = Math.floor(tick / SAMPLE_EVERY_TICKS);
      if (due !== sampledAt) {
        sampledAt = due;
        update({ sampled: sampledAccent(pixels, SIDE) });
      }
      notifyLive();
      return;
    }
    if (event.type === "map") {
      const { patchCodes, selectedPatches, tick, completed } = event;
      setMap({ patchCodes, selectedPatches, tick, completed });
      return;
    }
    if (event.type === "set") {
      setTokens = { codes: event.codes, tokenPictures: event.tokenPictures };
      notifyMap();
      return;
    }
    if (event.type === "reading") {
      const { patchCodes, selectedPatches, tick, completed } = event.reading;
      setMap({ patchCodes, selectedPatches, tick, completed });
    }
    if (event.type === "material") keep(event.file);
    if (event.type === "phase") {
      // The trainer holds its memory while it loads, trains and measures; not while the live grid only runs.
      const training = event.phase === "loading" || event.phase === "training" || event.phase === "finishing";
      if (training) dependencies.runRecord.started(runBatch);
      else dependencies.runRecord.ended();
    }
    if (event.type === "error") {
      if (event.deviceLost) dependencies.runRecord.deviceLost(runBatch);
      else dependencies.runRecord.ended();
      client?.dispose();
      client = null;
      update({ record: { ...recordEvent(state.record, event), active: false } });
      return;
    }
    const previous = state.record;
    const record = recordEvent(previous, event);
    if (record === previous) return;
    update({ record });
  };

  const clear = () => {
    dependencies.runRecord.ended();
    client?.dispose();
    client = null;
    live = null;
    sampledAt = -1;
    update({ record: NO_RECORD, settings: null, sampled: null, files: new Map(), keepFailure: null });
    notifyLive();
    setTokens = null;
    setMap(null);
  };

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    live: () => live,
    subscribeLive(listener) {
      liveListeners.add(listener);
      return () => liveListeners.delete(listener);
    },
    map: () => map,
    setTokens: () => setTokens,
    subscribeMap(listener) {
      mapListeners.add(listener);
      return () => mapListeners.delete(listener);
    },
    start(request, settings) {
      clear();
      // A continuation trains at its definition's batch size.
      runBatch = settings.continuation?.batch ?? settings.batch;
      update({ files: new Map(), keepFailure: null, settings: { ...settings, batch: runBatch, request }, record: { ...NO_RECORD, active: true } });
      dependencies.runRecord.started(runBatch);
      try {
        // Events of a run that has ended are not this run's.
        const created = dependencies.createClient((event) => {
          if (client === created) onEvent(event);
        });
        client = created;
        // A continuation records what it changed.
        const source = settings.continuation;
        const continuation = source && request.anchor ? { source, change: continuationChange(source, settings.kind.start, request.anchor) } : undefined;
        created.start({
          request, release: dependencies.release, kind: settings.kind, method: settings.method, layers: methodLayers(settings.method, settings.depth),
          set: settings.continuation ? null : settings.set, batch: runBatch, stopAtFirstFire: settings.stopAtFirstFire,
          ...(continuation ? { continuation } : {}),
        });
      } catch (error) {
        onEvent({ type: "error", message: String(error) });
      }
    },
    end: clear,
    stop: () => client?.stop(),
    resumeTraining: () => client?.resumeTraining(),
    restart: () => client?.restart(),
    keep: () => client?.keep(),
    brush: (stamps) => client?.brush(stamps),
    showOnPage(shown) {
      if (state.shownOnPage !== shown) update({ shownOnPage: shown });
    },
  };
}

/**
 * Whether the page's choices describe another run than the held one: another kind, method, token depth,
 * target set, stop rule, continuation or batch size. Then Train starts that run; otherwise Resume trains
 * the held one on.
 */
export function changedFromRun(
  run: GrowSettings, chosen: Pick<GrowSettings, "kind" | "method" | "depth" | "set" | "stopAtFirstFire" | "continuation" | "batch">,
): boolean {
  return run.kind.rule !== chosen.kind.rule
    || run.kind.start !== chosen.kind.start
    || run.method !== chosen.method
    || (methodReadsTokens(chosen.method) && run.depth !== chosen.depth)
    || !sameTargetSet(run.set, chosen.set)
    || run.stopAtFirstFire !== chosen.stopAtFirstFire
    || run.continuation?.id !== chosen.continuation?.id
    || run.batch !== chosen.batch;
}

/**
 * Whether a page's request is the target a run trains toward: the same basis group and mode, the
 * same reference patch (its picture, its place, its code, its level), and the same continued
 * definition. A page shows the run only for its own target; any other target is a new run.
 */
export function sameTarget(run: GrowSettings, request: MaterialRequest | null, continuation: ContinuationSource | null): boolean {
  if (request === null || (run.continuation?.id ?? null) !== (continuation?.id ?? null)) return false;
  if (run.request === request) return true;
  if (run.request.block !== request.block || (run.request.mode ?? "fill") !== (request.mode ?? "fill")) return false;
  const a = run.request.anchor;
  const b = request.anchor;
  if (!a || !b) return a === b;
  const sameImage = a.source === "upload" ? b.source === "upload" : b.source === "library" && a.imageId === b.imageId;
  return sameImage && a.slot === b.slot && a.band === b.band && a.code.every((value, axis) => value === b.code[axis]);
}

/**
 * Whether the corner tray shows the run: while it trains, waits or holds its result, or has failed,
 * and no page shows it; over a basis group panel it shows even on Train, whose page the panel
 * covers. Never on the image editor's pages, whose own dock holds that corner.
 */
export function trayShown(state: Pick<TrainRunState, "record" | "shownOnPage">, pathname: string, panelOpen: boolean): boolean {
  const alive = state.record.active || state.record.failure !== "";
  if (!alive || pathname === "/create" || pathname.startsWith("/create/")) return false;
  return !state.shownOnPage || panelOpen;
}

// A run the page went down in (a phone's browser ends a page that takes too much memory) leaves the
// tab's fallback to batch size 1; a page the person leaves clears the record first.
noteInterruptedRun();
clearRunOnPageHide();

/** The site's one run. */
export const trainRun: TrainRun = createTrainRun({
  createClient: (onEvent) => new GrowClient(onEvent),
  keep: async (file) => {
    await keepMaterial(file);
    announceKept("train");
  },
  release: RELEASE_LOCATION,
  runRecord: runMemory,
});

/** The run as views show it; re-renders on each change of its record, choices, files or tray state, not on its frames. */
export function useTrainRun(): TrainRunState {
  return useSyncExternalStore(trainRun.subscribe, trainRun.state);
}

/** The live map's latest reading (LiveMap), re-rendering with each; null before the first or with no run. */
export function useTrainMap(): LiveMap | null {
  return useSyncExternalStore(trainRun.subscribeMap, trainRun.map);
}

/** A set method's run's target set for the live map (TrainSetTokens); null for basis-group mean and with no run. */
export function useTrainSet(): TrainSetTokens | null {
  return useSyncExternalStore(trainRun.subscribeMap, trainRun.setTokens);
}

/** The live grid's tick, re-rendering with each frame: for the line that counts the steps. */
export function useTrainTick(): number | null {
  return useSyncExternalStore(trainRun.subscribeLive, () => trainRun.live()?.tick ?? null);
}

/** Puts a live-grid picture (SIDE × SIDE RGBA bytes) on the canvas. */
export function drawCells(canvas: HTMLCanvasElement | null, pixels_N4: Uint8ClampedArray): void {
  canvas?.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(pixels_N4), SIDE, SIDE), 0, 0);
}

/** Draws the run's live grid on a SIDE × SIDE canvas while `drawing`: the latest picture at once, then each new one. */
export function useLiveCells(canvas: RefObject<HTMLCanvasElement | null>, drawing: boolean): void {
  useEffect(() => {
    if (!drawing) return;
    const draw = () => {
      const cells = trainRun.live();
      if (cells) drawCells(canvas.current, cells.pixels_N4);
    };
    draw();
    return trainRun.subscribeLive(draw);
  }, [canvas, drawing]);
}
