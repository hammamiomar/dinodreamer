import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { RELEASE_LOCATION } from "../app/config";
import type { MaterialRequestOrigin, MaterialRequestPicture } from "../app/material-request";
import type { MaterialRequest } from "../recipe";
import { announceKept } from "../replay/keep-material";
import { readSubmittedMaterials } from "../features/gallery/publish-records";
import { keepMaterial } from "../storage/materials";
import { methodReadsTokens, readFigureMaterial, type FigureMaterialFile, type FigureMethod, type FigureTargetSet } from "../materials/material-file";
import type { ReleaseLocation } from "../synthesis/protocol";
import { SAMPLE_EVERY_TICKS, sampledAccent } from "../ui/sampled-accent";
import { GrowClient } from "./client";
import { continuationChange, type ContinuationSource } from "./continuation";
import { SIDE } from "./figure-recipe";
import { NO_RECORD, markSaved, recordEvent, resultOutcome, type GrowRecord } from "./grow-view";
import type { MaterialKind } from "./material-kind";
import { methodLayers, type TokenDepth } from "./train-method";
import { sameTargetSet } from "./target-set";
import type { GrowEvent, TrainLadder } from "./protocol";
import { clearRunOnPageHide, noteInterruptedRun, runMemory, type BatchSize } from "./batch-size";

export { SIDE };

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
  /** The saved definition a run continues, or null for a new automaton. */
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
  /** Reading ladder for a held set-method run: each step's picture, own loss, and kept step; null otherwise. */
  ladder: TrainLadder | null;
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
  pixels_N4: Uint8ClampedArray<ArrayBuffer>;
  tick: number;
}

/** The worker's commands, as the store gives them (client.ts). */
export interface TrainRunClient {
  start: GrowClient["start"];
  stop(): void;
  resumeTraining(): void;
  restart(): void;
  keep(): void;
  keepAtStep(step: number): void;
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
  /** The ids of the files this browser sent to the gallery: a sent file's step is closed (stepChoiceOpen). */
  sentMaterialIds(): ReadonlySet<string>;
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
  /**
   * For a held set-method run, keep the automaton at another step of its reading ladder under the
   * same file id and loop the live grid to that step. Ignored when the step is absent, already
   * kept, or already submitted to the gallery from this browser.
   */
  keepAtStep(step: number): void;
  /** Damage stamps on the live grid, [x, y, radius] in cells. */
  brush(stamps: [number, number, number][]): void;
  /** The Train page tells the store while it shows this run. */
  showOnPage(shown: boolean): void;
}

export const IDLE_TRAIN_RUN: TrainRunState = {
  record: NO_RECORD,
  settings: null,
  files: new Map(),
  sampled: null,
  keepFailure: null,
  shownOnPage: false,
  ladder: null,
};

export function createTrainRun(dependencies: TrainRunDependencies): TrainRun {
  let state: TrainRunState = IDLE_TRAIN_RUN;
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
    if (event.type === "ladder") {
      update({ ladder: event.ladder });
      return;
    }
    if (event.type === "material") keep(event.file);
    if (event.type === "phase") {
      // The trainer holds its memory while it loads, trains and measures; not while the live grid only runs.
      const training = event.phase === "loading" || event.phase === "training" || event.phase === "finishing";
      if (training) dependencies.runRecord.started(runBatch);
      else dependencies.runRecord.ended();
      // A ladder belongs to the held rule it was read from: training changes the rule, and a new keep reads a new ladder.
      if (training && state.ladder !== null) update({ ladder: null });
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

  const resetResources = () => {
    dependencies.runRecord.ended();
    client?.dispose();
    client = null;
    live = null;
    sampledAt = -1;
    notifyLive();
    setTokens = null;
    setMap(null);
  };

  const clear = () => {
    resetResources();
    update({ record: NO_RECORD, settings: null, sampled: null, files: new Map(), keepFailure: null, ladder: null });
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
      resetResources();
      // A continuation trains at its definition's batch size.
      runBatch = settings.continuation?.batch ?? settings.batch;
      update({
        record: { ...NO_RECORD, active: true },
        settings: { ...settings, batch: runBatch, request },
        sampled: null,
        files: new Map(),
        keepFailure: null,
        ladder: null,
      });
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
    keepAtStep(step) {
      const { ladder, record } = state;
      const kept = resultOutcome(record);
      if (!client || !ladder || !kept || step === ladder.kept || !ladder.steps.some((each) => each.tick === step)) return;
      if (dependencies.sentMaterialIds().has(kept.id)) return;
      client.keepAtStep(step);
    },
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

let siteTrainRun: TrainRun | null = null;

/**
 * Lazily initialize the browser-wide run store and pagehide crash tracking on first use,
 * so importing pure helpers from this module causes no window or storage side effects.
 */
function ensureTrainRun(): TrainRun {
  if (siteTrainRun === null) {
    noteInterruptedRun();
    clearRunOnPageHide();
    siteTrainRun = createTrainRun({
      createClient: (onEvent) => new GrowClient(onEvent),
      keep: async (file) => {
        await keepMaterial(file);
        announceKept("train");
      },
      release: RELEASE_LOCATION,
      runRecord: runMemory,
      sentMaterialIds: () => new Set(Object.keys(readSubmittedMaterials())),
    });
  }
  return siteTrainRun;
}

/** The site's shared Train run store. */
export const trainRun: TrainRun = {
  state: () => ensureTrainRun().state(),
  subscribe: (listener) => ensureTrainRun().subscribe(listener),
  live: () => ensureTrainRun().live(),
  subscribeLive: (listener) => ensureTrainRun().subscribeLive(listener),
  map: () => ensureTrainRun().map(),
  setTokens: () => ensureTrainRun().setTokens(),
  subscribeMap: (listener) => ensureTrainRun().subscribeMap(listener),
  start: (request, settings) => ensureTrainRun().start(request, settings),
  end: () => ensureTrainRun().end(),
  stop: () => ensureTrainRun().stop(),
  resumeTraining: () => ensureTrainRun().resumeTraining(),
  restart: () => ensureTrainRun().restart(),
  keep: () => ensureTrainRun().keep(),
  keepAtStep: (step) => ensureTrainRun().keepAtStep(step),
  brush: (stamps) => ensureTrainRun().brush(stamps),
  showOnPage: (shown) => ensureTrainRun().showOnPage(shown),
};

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

/** A held set-method run's reading ladder (TrainLadder): null for basis-group mean, while training and before a run ends. */
export function useTrainLadder(): TrainLadder | null {
  return useSyncExternalStore(trainRun.subscribe, () => trainRun.state().ladder);
}

/** The live grid's tick, re-rendering with each frame: for the line that counts the steps. */
export function useTrainTick(): number | null {
  return useSyncExternalStore(trainRun.subscribeLive, () => trainRun.live()?.tick ?? null);
}

/** Puts a live-grid picture (SIDE × SIDE RGBA bytes) on the canvas without copying the buffer. */
export function drawCells(canvas: HTMLCanvasElement | null, pixels_N4: Uint8ClampedArray<ArrayBuffer>): void {
  canvas?.getContext("2d")?.putImageData(new ImageData(pixels_N4, SIDE, SIDE), 0, 0);
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
