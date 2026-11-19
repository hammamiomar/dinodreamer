// The How page's automaton, recorded once (engine/tools/prepare_how_automaton_replay.mjs,
// prepare_how_records.py --grown, prepare_how_automaton_history.py): the replay of the featured
// two-scale automaton of group 4009 to its reading's tick, its picture, DINO's reading of that
// picture in the recorded formats act 1 uses (recorded.ts), and the training run's history. The
// rule itself is the published definition, fetched as the player fetches it.
import { RELEASE_LOCATION } from "../../app/config";
import { fill, SITE_WORDS } from "../../app/site-words";
import { fetchPublishedMaterialById } from "../gallery/material-gallery";
import { recordedSource, releaseDictionary, type DictionaryFiles, type HowSource } from "./how-source";
import { decodeGrid, readRecord } from "./recorded";

export const AUTOMATON_RECORD_FOLDER = "/how/training/automaton-4009/";

export interface AutomatonReplay {
  definition: string;
  block: number;
  layout: string;
  side: number;
  coarseSide: number;
  seed: number;
  tick: number;
  fireRate: number;
  ruleSha256: string;
  /** The patch the rule was trained toward: its response vector k and the group's median magnitude m. */
  anchor: { code: [number, number, number]; norm: number; slot: number; imageId?: number };
  medianNorm: number;
  reading: { strength: number | null; winnerFraction: number | null; side: number; seed: number; tick: number };
  training: { seed: number; updates: number };
}

export interface AutomatonHistory {
  run: string;
  /** [update, loss, overflow] at every optimizer update. */
  updates: [number, number, number][];
  /** [update, selection fraction at step 600, median response magnitude in m] at every readout. */
  readouts: [number, number, number][];
}

export interface AutomatonGrid { side: number; tick: number; seed: number; state: Float32Array }

export interface AutomatonState {
  replay: AutomatonReplay;
  fine: AutomatonGrid;
  coarse: AutomatonGrid;
}

export interface AutomatonRecord extends AutomatonState {
  history: AutomatonHistory;
  /** The two-scale rule's 17,088 values: the coarse rule first (7,776), then the fine rule with 80 inputs. */
  rule: Float32Array;
  /** The picture the grids make, 128 px, and the 256 px one DINO read. */
  picture: { small: string; large: string };
  /** DINO's reading of the 256 px picture: attention per layer, final tokens, addresses. */
  reading: HowSource;
  /** The released collection's calibration and basis matrices, for projecting the picture's tokens. */
  dictionary: DictionaryFiles;
}

const WORDS = SITE_WORDS.how;

async function binary(name: string): Promise<ArrayBuffer> {
  const response = await fetch(`${AUTOMATON_RECORD_FOLDER}${name}`);
  if (!response.ok) throw new Error(fill(WORDS.automatonRecordReadFailed, { status: response.status }));
  return response.arrayBuffer();
}

async function json<T>(name: string, check: (value: unknown) => T): Promise<T> {
  const response = await fetch(`${AUTOMATON_RECORD_FOLDER}${name}`);
  if (!response.ok) throw new Error(fill(WORDS.automatonRecordReadFailed, { status: response.status }));
  return check(await response.json());
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readReplay(value: unknown): AutomatonReplay {
  const replay = value as AutomatonReplay;
  const sound = replay && typeof replay.definition === "string" && finite(replay.side) && finite(replay.coarseSide)
    && finite(replay.seed) && finite(replay.tick) && finite(replay.fireRate) && finite(replay.medianNorm)
    && Array.isArray(replay.anchor?.code) && replay.anchor.code.length === 3 && replay.anchor.code.every(finite);
  if (!sound) throw new Error(WORDS.automatonRecordInvalid);
  return replay;
}

function readHistory(value: unknown): AutomatonHistory {
  const history = value as AutomatonHistory;
  const row = (entry: unknown) => Array.isArray(entry) && entry.length === 3 && entry.every(finite);
  if (!history || typeof history.run !== "string" || !Array.isArray(history.updates) || !history.updates.every(row) || !Array.isArray(history.readouts) || !history.readouts.every(row)) {
    throw new Error(WORDS.automatonRecordInvalid);
  }
  return history;
}

let loadedState: Promise<AutomatonState> | null = null;

/** Home needs the recorded state without the training history or DINO readings. */
export function loadAutomatonState(): Promise<AutomatonState> {
  return (loadedState ??= (async () => {
    const replay = await json("replay.json", readReplay);
    const suffix = String(replay.tick).padStart(3, "0");
    const [fine, coarse] = await Promise.all([
      binary(`grid-fine-${suffix}.bin`).then(decodeGrid),
      binary(`grid-coarse-${suffix}.bin`).then(decodeGrid),
    ]);
    if (fine.side !== replay.side || coarse.side !== replay.coarseSide
      || [fine, coarse].some((grid) => grid.seed !== replay.seed || grid.tick !== replay.tick)) {
      throw new Error(WORDS.automatonRecordInvalid);
    }
    return { replay, fine, coarse };
  })().catch((error: unknown) => {
    loadedState = null;
    throw error;
  }));
}

let loaded: Promise<AutomatonRecord> | null = null;

/** The record, read once per page. */
export function loadAutomatonRecord(): Promise<AutomatonRecord> {
  return (loaded ??= (async () => {
    const { replay, fine, coarse } = await loadAutomatonState();
    const [history, dino, material] = await Promise.all([
      json("history.json", readHistory),
      json("record.json", readRecord),
      fetchPublishedMaterialById(replay.definition),
    ]);
    const dictionary = releaseDictionary(RELEASE_LOCATION);
    return {
      dictionary,
      replay,
      history,
      fine,
      coarse,
      rule: material.values,
      picture: { small: `${AUTOMATON_RECORD_FOLDER}picture-${replay.side}.png`, large: `${AUTOMATON_RECORD_FOLDER}picture-256.png` },
      reading: recordedSource(0, dino, dictionary, AUTOMATON_RECORD_FOLDER),
    };
  })().catch((error: unknown) => {
    loaded = null;
    throw error;
  }));
}
